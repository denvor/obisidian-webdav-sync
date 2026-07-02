import { FileState, WebdavFileInfo, PLUGIN_DATA_DIR, STATE_FILE } from "./types";
import { computeHash, normalizePath } from "./utils";
import { Vault, TFile } from "obsidian";

interface LocalFileInfo {
  path: string;
  mtime: number;
  hash: string;
}

/**
 * 文件状态跟踪器
 * 维护本地 JSON 状态文件，对比本地/远程变更
 */
export class FileTracker {
  private states: Map<string, FileState> = new Map();
  private vault: Vault;
  private pluginDir: string;
  private loaded: boolean = false;

  constructor(vault: Vault) {
    this.vault = vault;
    this.pluginDir = PLUGIN_DATA_DIR;
  }

  /**
   * 获取状态文件完整路径
   */
  private getStateFilePath(): string {
    return `${this.pluginDir}/${STATE_FILE}`; // 不含 vault 根路径前缀
  }

  /**
   * 从 vault 加载状态文件
   */
  async load(): Promise<void> {
    try {
      const filePath = this.getStateFilePath();
      const exists = await this.vault.adapter.exists(filePath);
      if (!exists) {
        this.loaded = true;
        return;
      }
      const content = await this.vault.adapter.read(filePath);
      const data: FileState[] = JSON.parse(content);
      this.states.clear();
      for (const state of data) {
        // 解码旧的 URL 编码路径（%E5%85%B3 → 关）
        const decodedPath = decodeURIComponent(state.path);
        state.path = decodedPath;
        this.states.set(normalizePath(decodedPath), state);
      }
    } catch (err) {
      console.error("加载文件状态失败:", err);
      // 文件损坏时重置
      this.states.clear();
    }
    this.loaded = true;
  }

  /**
   * 保存状态文件到 vault
   */
  async save(): Promise<void> {
    try {
      // 确保目录存在
      await this.vault.adapter.mkdir(this.pluginDir);
      const data = Array.from(this.states.values());
      await this.vault.adapter.write(
        this.getStateFilePath(),
        JSON.stringify(data, null, 2)
      );
    } catch (err) {
      console.error("保存文件状态失败:", err);
    }
  }

  /**
   * 获取单个文件状态
   */
  getState(path: string): FileState | undefined {
    return this.states.get(normalizePath(path));
  }

  /**
   * 设置单个文件状态
   */
  setState(path: string, state: Partial<FileState>): void {
    const key = normalizePath(path);
    const existing = this.states.get(key) || {
      path: key,
      localMtime: 0,
      localHash: "",
      remoteMtime: null,
      remoteHash: null,
      status: "synced",
    };
    this.states.set(key, { ...existing, ...state, path: key });
  }

  /**
   * 删除文件状态
   */
  removeState(path: string): void {
    this.states.delete(normalizePath(path));
  }

  /**
   * 获取所有跟踪的文件路径
   */
  getAllPaths(): string[] {
    return Array.from(this.states.keys());
  }

  /**
   * 扫描本地文件，返回文件信息列表
   */
  async scanLocal(): Promise<LocalFileInfo[]> {
    const files: LocalFileInfo[] = [];
    const allFiles = this.vault.getFiles();

    for (const file of allFiles) {
      // 跳过 .obsidian 目录
      if (file.path.startsWith(".obsidian/")) continue;

      try {
        const content = await this.vault.read(file);
        const hash = await computeHash(content);
        files.push({
          path: file.path,
          mtime: file.stat.mtime,
          hash,
        });
      } catch (err) {
        console.warn(`读取文件失败 ${file.path}:`, err);
      }
    }

    return files;
  }

  /**
   * 计算本地文件信息（用于单文件同步）
   */
  async getLocalFileInfo(file: TFile): Promise<LocalFileInfo | null> {
    try {
      const content = await this.vault.read(file);
      const hash = await computeHash(content);
      return {
        path: file.path,
        mtime: file.stat.mtime,
        hash,
      };
    } catch {
      return null;
    }
  }

  /**
   * 对比本地文件和远程文件，生成同步操作列表
   *
   * 返回:
   *  - upload: 仅本地有 或 本地有修改但远程未变
   *  - download: 仅远程有 或 远程有修改但本地未变
   *  - conflict: 双方都有修改
   *  - synced: 双方一致（跳过）
   */
  compare(
    localFiles: LocalFileInfo[],
    remoteFiles: WebdavFileInfo[]
  ): {
    uploadPaths: string[];
    downloadPaths: string[];
    conflictPaths: string[];
    deleteRemotePaths: string[];
    deleteLocalPaths: string[];
    syncedPaths: string[];
  } {
    const localMap = new Map<string, LocalFileInfo>();
    for (const f of localFiles) {
      localMap.set(normalizePath(f.path), f);
    }

    const remoteMap = new Map<string, WebdavFileInfo>();
    for (const f of remoteFiles) {
      if (!f.isDirectory) {
        remoteMap.set(normalizePath(f.path), f);
      }
    }

    const uploadPaths: string[] = [];
    const downloadPaths: string[] = [];
    // 安全检查阈值：文件数量不低于预期的一半才视作"用户主动删除"
    const localCount = localMap.size;
    const remoteCount = remoteMap.size;
    const expectedCount = this.states.size;
    const canAssumeDelete = expectedCount === 0 ||
      (localCount >= expectedCount * 0.5 && remoteCount >= expectedCount * 0.5);
    const conflictPaths: string[] = [];
    const deleteRemotePaths: string[] = [];
    const deleteLocalPaths: string[] = [];
    const syncedPaths: string[] = [];

    // 遍历本地文件
    for (const [localPath, localInfo] of localMap) {
      const remoteInfo = remoteMap.get(localPath);
      const savedState = this.states.get(localPath);

      if (!remoteInfo) {
        // 文件仅在本地 → 上传
        uploadPaths.push(localPath);
      } else {
        // 两边都存在 → 判断变更
        // 没有历史状态则视为已同步（不触发冲突也不重复上传）
        if (!savedState) {
          syncedPaths.push(localPath);
          continue;
        }

        const localChanged =
          savedState.localHash !== localInfo.hash ||
          savedState.localMtime !== localInfo.mtime;

        const remoteChanged =
          !savedState.remoteHash ||
          (remoteInfo.etag && savedState.remoteHash !== remoteInfo.etag) ||
          (savedState.remoteMtime !== null && remoteInfo.mtime !== null && savedState.remoteMtime !== remoteInfo.mtime);

        if (!localChanged && !remoteChanged) {
          syncedPaths.push(localPath);
        } else if (localChanged && !remoteChanged) {
          uploadPaths.push(localPath);
        } else if (!localChanged && remoteChanged) {
          downloadPaths.push(localPath);
        } else {
          // 双方都变了 → 冲突
          conflictPaths.push(localPath);
        }
      }
    }

    // 遍历远程文件，找出仅在远程的文件
    for (const [remotePath, remoteInfo] of remoteMap) {
      if (!localMap.has(remotePath)) {
        const savedState = this.states.get(remotePath);
        if (savedState && savedState.localHash && canAssumeDelete) {
          // 本地曾经有但被删除了 → 删除远程
          deleteRemotePaths.push(remotePath);
        } else {
          // 仅在远程 → 下载
          downloadPaths.push(remotePath);
        }
      }
    }

    // 本地删除但远程存在的文件（不在 localMap 中但之前跟踪过）
    if (canAssumeDelete) {
      for (const [path, state] of this.states) {
        if (state.status === "synced" && !localMap.has(path) && remoteMap.has(path)) {
          if (!deleteRemotePaths.includes(path)) {
            deleteRemotePaths.push(path);
          }
        }
      }
    }

    // 远程删除但本地存在的文件
    if (canAssumeDelete) {
      for (const [path, state] of this.states) {
        if (state.status === "synced" && localMap.has(path) && !remoteMap.has(path)) {
          if (!deleteLocalPaths.includes(path)) {
            deleteLocalPaths.push(path);
          }
        }
      }
    }

    return {
      uploadPaths: [...new Set(uploadPaths)],
      downloadPaths: [...new Set(downloadPaths)],
      conflictPaths: [...new Set(conflictPaths)],
      deleteRemotePaths: [...new Set(deleteRemotePaths)],
      deleteLocalPaths: [...new Set(deleteLocalPaths)],
      syncedPaths: [...new Set(syncedPaths)],
    };
  }

  /**
   * 是否已加载状态文件
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}
