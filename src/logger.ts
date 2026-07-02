import { Vault } from "obsidian";

const LOG_DIR = ".obsidian/plugins/obsidian-webdav-sync";
const LOG_FILE = "sync.log";
const MAX_LINES = 500;

/**
 * 简单的文件日志器
 * 将同步日志写入插件目录的 sync.log 文件
 */
export class Logger {
  private vault: Vault;
  private logs: string[] = [];

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * 写入一条日志
   */
  log(level: "INFO" | "WARN" | "ERROR", message: string): void {
    const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
    const line = `[${timestamp}] [${level}] ${message}`;
    this.logs.push(line);
    // 也输出到控制台，方便 DevTools 查看
    if (level === "ERROR") {
      console.error(line);
    } else if (level === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  info(msg: string): void { this.log("INFO", msg); }
  warn(msg: string): void { this.log("WARN", msg); }
  error(msg: string): void { this.log("ERROR", msg); }

  /**
   * 将所有日志写入文件（追加模式）
   */
  async flush(): Promise<void> {
    if (this.logs.length === 0) return;

    try {
      await this.vault.adapter.mkdir(LOG_DIR);

      // 读取现有日志
      let existing = "";
      try {
        existing = await this.vault.adapter.read(`${LOG_DIR}/${LOG_FILE}`);
      } catch {
        // 文件不存在，忽略
      }

      const allLines = existing ? existing.split("\n") : [];
      const newLines = this.logs;  // 已经是按行分割的数组

      // 合并并截断（保留最后 MAX_LINES 行）
      const merged = [...allLines, ...newLines];
      if (merged.length > MAX_LINES) {
        merged.splice(0, merged.length - MAX_LINES);
      }

      await this.vault.adapter.write(`${LOG_DIR}/${LOG_FILE}`, merged.join("\n") + "\n");
      this.logs = [];
    } catch (err) {
      console.error("写入日志文件失败:", err);
    }
  }

  /**
   * 获取日志文件路径（供设置界面显示"查看日志"用）
   */
  getLogFilePath(): string {
    return `${LOG_DIR}/${LOG_FILE}`;
  }
}
