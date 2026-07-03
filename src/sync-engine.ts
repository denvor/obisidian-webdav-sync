import { SyncSettings, SyncAction, FileState } from "./types";
import { WebdavClient } from "./webdav-client";
import { FileTracker } from "./file-tracker";
import { ConflictResolver } from "./conflict-resolver";
import { computeHash, normalizePath, shouldExclude } from "./utils";
import { Logger } from "./logger";
import { Vault, Notice } from "obsidian";

export type SyncProgressCallback = (current: number, total: number, message: string) => void;

/**
 * 同步引擎
 * 编排完整的同步流程：扫描 → 对比 → 冲突处理 → 执行 → 更新状态
 */
export class SyncEngine {
  private vault: Vault;
  private client: WebdavClient;
  private tracker: FileTracker;
  private resolver: ConflictResolver;
  private settings: SyncSettings;
  private logger: Logger;
  private abortFlag: boolean = false;
  private syncing: boolean = false;
  private onProgress: SyncProgressCallback | null = null;

  constructor(
    vault: Vault,
    client: WebdavClient,
    tracker: FileTracker,
    resolver: ConflictResolver,
    settings: SyncSettings,
    logger: Logger
  ) {
    this.vault = vault;
    this.client = client;
    this.tracker = tracker;
    this.resolver = resolver;
    this.settings = settings;
    this.logger = logger;
  }

  /**
   * 设置进度回调
   */
  setOnProgress(callback: SyncProgressCallback | null): void {
    this.onProgress = callback;
  }

  /**
   * 是否正在同步
   */
  isSyncing(): boolean {
    return this.syncing;
  }

  /**
   * 中止同步
   */
  abort(): void {
    this.abortFlag = true;
  }

  /**
   * 报告进度
   */
  private reportProgress(current: number, total: number, message: string): void {
    if (this.onProgress) {
      this.onProgress(current, total, message);
    }
  }

  /**
   * 执行完整同步流程
   */
  async sync(): Promise<{ success: boolean; message: string; actions: SyncAction[] }> {
    if (this.syncing) {
      return { success: false, message: "同步已在进行中", actions: [] };
    }

    this.syncing = true;
    this.abortFlag = false;
    const actions: SyncAction[] = [];
    let uploaded = 0, downloaded = 0, deletedRemote = 0, deletedLocal = 0, conflicted = 0;

    try {
      // 阶段1: 扫描本地文件
      this.reportProgress(0, 100, "扫描本地文件...");
      const localFiles = await this.scanLocal();
      if (this.abortFlag) throw new Error("同步已中止");

      // 阶段2: 列出远程文件
      this.reportProgress(0, 100, "列出远程文件...");
      const remoteFiles = await this.listRemote();
      if (this.abortFlag) throw new Error("同步已中止");

      // 阶段3: 对比
      this.reportProgress(0, 100, "对比文件变更...");
      // 从状态中清除被排除的文件（防止之前同步过的文件因添加排除规则而被删除）
      const excludePatterns = (this.settings.excludePatterns || "").split("\n").filter((p) => p.trim());
      const includePatterns = (this.settings.includePatterns || "").split("\n").filter((p) => p.trim());
      for (const path of this.tracker.getAllPaths()) {
        if (shouldExclude(path, excludePatterns, includePatterns)) {
          this.tracker.removeState(path);
        }
      }
      const comparison = this.tracker.compare(localFiles, remoteFiles);
      if (this.abortFlag) throw new Error("同步已中止");

      // 根据同步方向过滤操作
      const direction = this.settings.syncDirection;
      let {
        uploadPaths,
        downloadPaths,
        conflictPaths,
        deleteRemotePaths,
        deleteLocalPaths,
      } = comparison;

      if (direction === "upload_only") {
        downloadPaths = [];
        deleteLocalPaths = [];
        // 仅上传模式下冲突也仅上传
        conflictPaths = [];
      } else if (direction === "download_only") {
        uploadPaths = [];
        deleteRemotePaths = [];
        // 仅下载模式下冲突也仅下载
        conflictPaths = [];
      }

      // 阶段4: 处理冲突
      if (conflictPaths.length > 0) {
        this.reportProgress(0, 100, `处理 ${conflictPaths.length} 个冲突文件...`);
        const localMap = new Map(localFiles.map((f) => [f.path, f]));
        const remoteMap = new Map(remoteFiles.map((f) => [f.path, f]));

        const localTimes = new Map<string, number>();
        const remoteTimes = new Map<string, number>();
        const localContents = new Map<string, string>();

        for (const p of conflictPaths) {
          const lf = localMap.get(p);
          const rf = remoteMap.get(p);
          if (lf) localTimes.set(p, lf.mtime);
          if (rf && rf.mtime) remoteTimes.set(p, rf.mtime);
          // 读取本地文件内容用于冲突上传
          if (lf) {
            try {
              const content = await this.vault.adapter.read(p);
              localContents.set(p, content);
            } catch {
              this.logger.warn(`读取冲突文件内容失败: ${p}`);
            }
          }
        }

        const conflictActions = await this.resolver.resolve(
          conflictPaths,
          localTimes,
          remoteTimes,
          localContents
        );
        actions.push(...conflictActions);
        if (this.abortFlag) throw new Error("同步已中止");
      }

      // 阶段5: 执行操作
      const totalActions =
        uploadPaths.length +
        downloadPaths.length +
        deleteRemotePaths.length +
        deleteLocalPaths.length +
        actions.length;

      if (totalActions === 0) {
        this.reportProgress(100, 100, "所有文件已同步");
        this.syncing = false;
        return { success: true, message: "所有文件已是最新", actions: [] };
      }

      const result = await this.executeActions(
        uploadPaths,
        downloadPaths,
        deleteRemotePaths,
        deleteLocalPaths,
        actions,
        localFiles
      );

      // 阶段6: 更新状态
      await this.updateStates(
        uploadPaths,
        downloadPaths,
        deleteRemotePaths,
        deleteLocalPaths,
        conflictPaths,
        localFiles,
        remoteFiles,
        result.postUploadEtags,
        result.postDownloadMtimes
      );

      // 刷新远程文件状态：重新 PROPFIND，用服务器返回的真实 etag 覆盖状态
      if (uploadPaths.length > 0 || downloadPaths.length > 0 || conflictPaths.length > 0) {
        this.reportProgress(0, 0, "刷新远程文件状态...");
        try {
          const freshRemote = await this.listRemote();
          const freshMap = new Map(freshRemote.map((f) => [f.path, f]));
          for (const path of [...uploadPaths, ...downloadPaths, ...conflictPaths]) {
            const fresh = freshMap.get(path);
            if (fresh) {
              this.tracker.setState(path, {
                remoteMtime: fresh.mtime,
                remoteHash: fresh.etag,
                status: "synced",
              });
            }
          }
        } catch (err) {
          this.logger.warn(`刷新远程状态失败: ${err}`);
        }
      }
      await this.tracker.save();

      this.syncing = false;
      return {
        success: true,
        message: `同步完成: ↑${uploadPaths.length} 上传, ↓${downloadPaths.length} 下载, ⚠${conflictPaths.length} 冲突, ✕${deleteRemotePaths.length + deleteLocalPaths.length} 删除`,
        actions,
      };
    } catch (err) {
      this.syncing = false;
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg, actions };
    }
  }

  /**
   * 扫描本地文件
   */
  private async scanLocal(): Promise<{ path: string; mtime: number; hash: string }[]> {
    const allFiles = this.vault.getFiles();
    const result: { path: string; mtime: number; hash: string }[] = [];
    const includePatterns = (this.settings.includePatterns || "")
      .split("\n")
      .filter((p) => p.trim());
    const excludePatterns = (this.settings.excludePatterns || "")
      .split("\n")
      .filter((p) => p.trim());

    for (let i = 0; i < allFiles.length; i++) {
      if (this.abortFlag) throw new Error("同步已中止");

      const file = allFiles[i];
      if (shouldExclude(file.path, excludePatterns, includePatterns)) continue;

      this.reportProgress(i, allFiles.length, `扫描: ${file.path}`);

      try {
        const content = await this.vault.read(file);
        const hash = await computeHash(content);
        result.push({
          path: file.path,
          mtime: file.stat.mtime,
          hash,
        });
      } catch (err) {
        this.logger.warn(`读取文件失败 ${file.path}: ${err}`);
      }
    }

    return result;
  }

  /**
   * 列出远程文件
   */
  private async listRemote(): Promise<{ path: string; mtime: number | null; etag: string | null; isDirectory: boolean }[]> {
    try {
      // 如果远程存在子目录结构，需要递归
      return await this.client.listRecursive();
    } catch (err) {
      console.warn("递归列出远程文件失败，尝试单层:", err);
      // fallback 到单层列表
      return await this.client.list();
    }
  }

  /**
   * 执行同步操作
   */
  private async executeActions(
    uploadPaths: string[],
    downloadPaths: string[],
    deleteRemotePaths: string[],
    deleteLocalPaths: string[],
    conflictActions: SyncAction[],
    localFiles: { path: string; mtime: number; hash: string }[]
  ): Promise<{
    postUploadEtags: Map<string, string | null>;
    postDownloadMtimes: Map<string, number>;
  }> {
    const total =
      uploadPaths.length +
      downloadPaths.length +
      deleteRemotePaths.length +
      deleteLocalPaths.length +
      conflictActions.length;
    let completed = 0;
    const errors: string[] = [];
    // 收集操作后的真实值（避免上传/下载后状态不一致导致死循环）
    const postUploadEtags = new Map<string, string | null>();
    const postDownloadMtimes = new Map<string, number>();

    // 第一步：创建必要的远程目录
    const allDirs = new Set<string>();
    for (const p of [...uploadPaths, ...conflictActions.map((a) => a.path)]) {
      if (p.includes("/")) {
        allDirs.add(p.substring(0, p.lastIndexOf("/")));
      }
    }
    // 按深度排序，确保先创建父目录再创建子目录
    const sortedDirs = [...allDirs].sort((a, b) => a.split("/").length - b.split("/").length);
    for (const dir of sortedDirs) {
      if (this.abortFlag) throw new Error("同步已中止");
      try {
        await this.client.ensureDirectory(dir);
      } catch (err) {
        errors.push(`创建远程目录失败 ${dir}: ${err}`);
        this.logger.warn(`创建远程目录失败 ${dir}: ${err}`);
      }
    }
    if (this.abortFlag) throw new Error("同步已中止");

    // 创建本地目录（下载需要）
    for (const p of downloadPaths) {
      if (p.includes("/")) {
        const dir = p.substring(0, p.lastIndexOf("/"));
        await this.vault.adapter.mkdir(dir);
      }
    }

    // 上传文件
    for (const path of uploadPaths) {
      if (this.abortFlag) throw new Error("同步已中止");
      this.reportProgress(completed, total, `↑ 上传: ${path}`);
      try {
        const content = await this.vault.adapter.read(path);
        this.logger.info(`↑ 上传: ${path}`);
        const etag = await this.client.upload(path, content);
        postUploadEtags.set(path, etag);
      } catch (err) {
        errors.push(`↑ 上传失败 ${path}: ${err}`);
        this.logger.error(`↑ 上传失败 ${path}: ${err}`);
      }
      completed++;
    }

    // 下载文件
    for (const path of downloadPaths) {
      if (this.abortFlag) throw new Error("同步已中止");
      this.reportProgress(completed, total, `↓ 下载: ${path}`);
      try {
        const content = await this.client.download(path);
        this.logger.info(`↓ 下载: ${path}`);
        if (content !== undefined) {
          await this.vault.adapter.write(path, content);
          // 重新读取文件获得写入后的真实 mtime
          const file = this.vault.getAbstractFileByPath(path);
          if (file && "stat" in file) {
            postDownloadMtimes.set(path, (file as any).stat.mtime);
          }
        }
      } catch (err) {
        errors.push(`↓ 下载失败 ${path}: ${err}`);
        this.logger.error(`↓ 下载失败 ${path}: ${err}`);
      }
      completed++;
    }

    // 删除远程文件
    for (const path of deleteRemotePaths) {
      if (this.abortFlag) throw new Error("同步已中止");
      this.reportProgress(completed, total, `✕ 删除远程: ${path}`);
      try {
        await this.client.delete(path);
        this.logger.info(`✕ 删除远程: ${path}`);
      } catch (err) {
        errors.push(`✕ 删除远程失败 ${path}: ${err}`);
        this.logger.error(`✕ 删除远程失败 ${path}: ${err}`);
      }
      completed++;
    }

    // 删除本地文件
    for (const path of deleteLocalPaths) {
      if (this.abortFlag) throw new Error("同步已中止");
      this.reportProgress(completed, total, `✕ 删除本地: ${path}`);
      try {
        // 解码路径（状态文件中可能存有 URL 编码的旧路径）
        const decodedPath = decodeURIComponent(path);
        const file = this.vault.getAbstractFileByPath(decodedPath);
        if (file) {
          await this.vault.delete(file);
        }
        this.logger.info(`✕ 删除本地: ${path}`);
      } catch (err) {
        errors.push(`✕ 删除本地失败 ${path}: ${err}`);
        this.logger.error(`✕ 删除本地失败 ${path}: ${err}`);
      }
      completed++;
    }

    // 处理冲突
    for (const action of conflictActions) {
      if (this.abortFlag) throw new Error("同步已中止");
      this.reportProgress(completed, total, `⚠ 处理冲突: ${action.path}`);
      try {
        if (action.type === "conflict_upload") {
          this.logger.warn(`⚠ 冲突上传 ${action.path} → 远程旧文件备份为 ${action.backupPath}`);
          await this.resolver.executeConflictUpload(
            action.path,
            action.backupPath,
            action.content
          );
        } else if (action.type === "conflict_download") {
          this.logger.warn(`⚠ 冲突下载 ${action.path} → 本地旧文件备份为 ${action.backupPath}`);
          await this.resolver.executeConflictDownload(action.path, action.backupPath);
        }
      } catch (err) {
        errors.push(`⚠ 冲突处理失败 ${action.path}: ${err}`);
        this.logger.error(`⚠ 冲突处理失败 ${action.path}: ${err}`);
      }
      completed++;
    }

    // 一次性展示所有错误
    if (errors.length > 0) {
      this.logger.error(`同步完成，共 ${errors.length} 个错误`);
      if (errors.length <= 3) {
        new Notice(errors.join("\n"), 8000);
      } else {
        new Notice(`同步完成，但存在 ${errors.length} 个错误`, 8000);
      }
    }

    // 刷入日志文件
    await this.logger.flush();

    this.reportProgress(completed, total, "同步完成");
    return { postUploadEtags, postDownloadMtimes };
  }

  /**
   * 更新文件状态
   */
  private async updateStates(
    uploadPaths: string[],
    downloadPaths: string[],
    deleteRemotePaths: string[],
    deleteLocalPaths: string[],
    conflictPaths: string[],
    localFiles: { path: string; mtime: number; hash: string }[],
    remoteFiles: { path: string; mtime: number | null; etag: string | null }[],
    postUploadEtags: Map<string, string | null>,
    postDownloadMtimes: Map<string, number>
  ): Promise<void> {
    const localMap = new Map(localFiles.map((f) => [f.path, f]));
    const remoteMap = new Map(remoteFiles.map((f) => [f.path, f]));

    // 上传的文件 → 标记为已同步
    for (const path of uploadPaths) {
      const lf = localMap.get(path);
      // 使用上传后服务器返回的真实 ETag
      const realEtag = postUploadEtags.get(path);
      // 不存 remoteMtime（服务器时间和本地时间不一致会导致误判）
      this.tracker.setState(path, {
        localMtime: lf?.mtime || 0,
        localHash: lf?.hash || "",
        remoteMtime: null,
        remoteHash: realEtag || null,
        status: "synced",
      });
    }

    // 下载的文件 → 标记为已同步
    for (const path of downloadPaths) {
      // 使用下载写入后的真实本地 mtime
      const realMtime = postDownloadMtimes.get(path);
      // 下载后重新计算 hash
      let realHash = "";
      try {
        const content = await this.vault.adapter.read(path);
        realHash = await computeHash(content);
      } catch (err) {
        this.logger.warn(`重新计算下载文件 hash 失败 ${path}: ${err}`);
      }
      const rf = remoteMap.get(path);
      this.tracker.setState(path, {
        localMtime: realMtime || 0,
        localHash: realHash,
        remoteMtime: rf?.mtime || null,
        remoteHash: rf?.etag || null,
        status: "synced",
      });
    }

    // 删除的文件 → 移除状态
    for (const path of deleteRemotePaths) {
      this.tracker.removeState(path);
    }
    for (const path of deleteLocalPaths) {
      this.tracker.removeState(path);
    }

    // 冲突文件 → 标记为已同步（已被 newer_wins 处理）
    for (const path of conflictPaths) {
      const lf = localMap.get(path);
      const rf = remoteMap.get(path);
      this.tracker.setState(path, {
        localMtime: lf?.mtime || 0,
        localHash: lf?.hash || "",
        remoteMtime: rf?.mtime || null,
        remoteHash: rf?.etag || null,
        status: "synced",
      });
    }
  }
}
