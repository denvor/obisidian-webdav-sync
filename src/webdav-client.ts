import { WebdavFileInfo } from "./types";
import { parsePropfindResponse } from "./utils";

/**
 * WebDAV HTTP 客户端
 * 使用原生 fetch API（Obsidian Electron 内置）
 */
export class WebdavClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrl: string, username: string, password: string) {
    // 确保 URL 以 / 结尾
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

    // Basic Auth
    const credentials = btoa(`${username}:${password}`);
    this.headers = {
      Authorization: `Basic ${credentials}`,
    };
  }

  /**
   * 获取基础 URL
   */
  getUrl(): string {
    return this.baseUrl;
  }

  /**
   * 构建完整 URL（拼接路径）
   * 对路径中的中文和特殊字符做 URL 编码
   */
  private buildUrl(path: string): string {
    const cleanPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
    // 按 / 分段后分别编码，保留 / 作为路径分隔符
    const encoded = cleanPath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return this.baseUrl + encoded;
  }

  /**
   * 发起 fetch 请求的通用方法
   */
  private async request(
    path: string,
    options: RequestInit = {},
    retries: number = 3
  ): Promise<Response> {
    const url = this.buildUrl(path);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.headers,
            ...(options.headers || {}),
          },
        });
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries - 1) {
          // 指数退避: 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError || new Error(`请求失败: ${path}`);
  }

  /**
   * PROPFIND — 列出目录内容
   */
  async list(path: string = ""): Promise<WebdavFileInfo[]> {
    const response = await this.request(path, {
      method: "PROPFIND",
      headers: {
        Depth: "1",
        Accept: "application/xml",
      },
    });

    if (!response.ok) {
      throw new Error(`PROPFIND 失败: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    return parsePropfindResponse(xmlText, path);
  }

  /**
   * 递归列出所有文件和目录
   */
  async listRecursive(path: string = ""): Promise<WebdavFileInfo[]> {
    const allFiles: WebdavFileInfo[] = [];
    const queue: string[] = [path];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const items = await this.list(current);

      for (const item of items) {
        if (item.path === current || item.path === "") continue;
        allFiles.push(item);
        if (item.isDirectory) {
          queue.push(item.path);
        }
      }
    }

    return allFiles;
  }

  /**
   * GET — 下载文件内容
   */
  async download(path: string): Promise<string> {
    const response = await this.request(path, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`GET 失败: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * PUT — 上传文件内容
   */
  async upload(path: string, content: string): Promise<string | null> {
    const response = await this.request(path, {
      method: "PUT",
      body: content,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });

    if (!response.ok) {
      throw new Error(`PUT 失败: ${response.status} ${response.statusText}`);
    }

    // 返回服务器返回的 ETag（用于更新同步状态）
    return response.headers.get("ETag");
  }

  /**
   * DELETE — 删除文件或目录
   */
  async delete(path: string): Promise<void> {
    const response = await this.request(path, {
      method: "DELETE",
    });

    // 404 视为已删除，不报错
    if (!response.ok && response.status !== 404) {
      throw new Error(`DELETE 失败: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * MKCOL — 创建目录
   */
  async createDirectory(path: string): Promise<void> {
    const response = await this.request(path, {
      method: "MKCOL",
    });

    // 405 (Method Not Allowed) 表示目录已存在，不报错
    if (!response.ok && response.status !== 405) {
      throw new Error(`MKCOL 失败: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * MOVE — 重命名/移动文件
   */
  async move(from: string, to: string): Promise<void> {
    const destinationUrl = this.buildUrl(to);
    const response = await this.request(from, {
      method: "MOVE",
      headers: {
        Destination: destinationUrl,
      },
    });

    if (!response.ok) {
      throw new Error(`MOVE 失败: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 确保远程目录存在（递归创建）
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    const parts = dirPath.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current += part + "/";
      try {
        await this.createDirectory(current);
      } catch (err) {
        // 405 (Method Not Allowed) = 目录已存在，不是错误
        if (err instanceof Error && err.message.includes("405")) {
          continue;
        }
        // 其他错误重新抛出
        throw err;
      }
    }
  }

  /**
   * 测试连接 — 向根路径发送 PROPFIND
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.list("");
      return { ok: true, message: "连接成功" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }
}
