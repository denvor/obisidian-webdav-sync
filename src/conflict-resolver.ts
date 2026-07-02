import { SyncAction } from "./types";
import { getBackupPath } from "./utils";
import { WebdavClient } from "./webdav-client";
import { Vault } from "obsidian";

/**
 * 冲突处理器
 * 按时间戳判断新旧，保留新文件，旧文件改名备份
 */
export class ConflictResolver {
  private vault: Vault;
  private client: WebdavClient;

  constructor(vault: Vault, client: WebdavClient) {
    this.vault = vault;
    this.client = client;
  }

  /**
   * 处理冲突文件列表，返回具体的 sync actions
   *
   * @param conflictPaths 冲突文件路径列表
   * @param localMtimes 本地 mtime 映射
   * @param remoteMtimes 远程 mtime 映射
   */
  async resolve(
    conflictPaths: string[],
    localTimes: Map<string, number>,
    remoteTimes: Map<string, number>,
    localContents: Map<string, string>
  ): Promise<SyncAction[]> {
    const actions: SyncAction[] = [];

    for (const path of conflictPaths) {
      const localMtime = localTimes.get(path) || 0;
      const remoteMtime = remoteTimes.get(path) || 0;

      if (localMtime >= remoteMtime) {
        // 本地文件更新 → 上传本地版本，远程旧版本改名备份
        const backupPath = getBackupPath(path);
        actions.push({
          type: "conflict_upload",
          path,
          backupPath,
          content: localContents.get(path),
        });
      } else {
        // 远程文件更新 → 下载远程版本，本地旧版本改名备份
        const backupPath = getBackupPath(path);
        actions.push({
          type: "conflict_download",
          path,
          backupPath,
        });
      }
    }

    return actions;
  }

  /**
   * 执行冲突上传：MOVE 远程旧文件 → PUT 新文件
   */
  async executeConflictUpload(path: string, backupPath: string, content?: string): Promise<void> {
    // 1. 远程旧文件改名备份（加上目录前缀，和 executeConflictDownload 一致）
    const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
    const fullBackupPath = dir ? `${dir}/${backupPath.replace(/^.*\//, "")}` : backupPath;
    try {
      await this.client.move(path, fullBackupPath);
    } catch (err) {
      console.warn(`远程备份失败 ${path} → ${backupPath}:`, err);
      // MOVE 失败可能是远程文件不存在，继续上传
    }

    // 2. 上传本地新文件
    if (content !== undefined) {
      // 确保目录存在
      const dirPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
      if (dirPath) {
        await this.client.ensureDirectory(dirPath);
      }
      await this.client.upload(path, content);
    }
  }

  /**
   * 执行冲突下载：本地旧文件改名 → GET 远程新文件
   */
  async executeConflictDownload(path: string, backupPath: string): Promise<void> {
    // 1. 本地旧文件改名备份
    try {
      const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
      const fullBackupPath = dir ? `${dir}/${backupPath.replace(/^.*\//, "")}` : backupPath;
      await this.vault.rename(
        this.vault.getAbstractFileByPath(path) as any,
        fullBackupPath
      );
    } catch (err) {
      console.warn(`本地备份失败 ${path} → ${backupPath}:`, err);
    }

    // 2. 下载远程新文件
    try {
      const content = await this.client.download(path);
      // 确保目录存在
      const dirPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
      if (dirPath) {
        await this.vault.adapter.mkdir(dirPath);
      }
      await this.vault.adapter.write(path, content);
    } catch (err) {
      console.warn(`下载冲突文件失败 ${path}:`, err);
    }
  }
}
