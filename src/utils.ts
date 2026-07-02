import { WebdavFileInfo } from "./types";

/**
 * 解析 WebDAV PROPFIND 响应 XML，提取文件/目录列表
 */
export function parsePropfindResponse(xmlText: string, basePath: string): WebdavFileInfo[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");

  // 检查解析错误
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("XML 解析失败: " + parseError.textContent);
  }

  const results: WebdavFileInfo[] = [];
  const responses = xml.querySelectorAll("D\\:response, response");

  responses.forEach((response) => {
    const hrefEl = response.querySelector("D\\:href, href");
    if (!hrefEl || !hrefEl.textContent) return;

    let href = hrefEl.textContent;
    // 解码 URL 编码的路径（服务器返回 %E5%85%B3 转为 关）
    try {
      href = decodeURIComponent(href);
    } catch {
      // 如果解码失败，保留原值
    }
    // 跳过根路径自身
    if (href === basePath || href === basePath + "/") return;

    // 移除 basePath 前缀得到相对路径
    let relPath = href;
    if (basePath !== "/" && basePath !== "") {
      if (relPath.startsWith(basePath)) {
        relPath = relPath.slice(basePath.length);
      }
    }
    relPath = relPath.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!relPath) return;

    // 判断是否为目录
    const isDir = href.endsWith("/");

    // 提取 getlastmodified
    const mtimeEl = response.querySelector("D\\:getlastmodified, getlastmodified");
    let mtime: number | null = null;
    if (mtimeEl && mtimeEl.textContent) {
      const parsed = Date.parse(mtimeEl.textContent);
      if (!isNaN(parsed)) mtime = parsed;
    }

    // 提取 getetag
    const etagEl = response.querySelector("D\\:getetag, getetag");
    const etag = etagEl && etagEl.textContent ? etagEl.textContent.replace(/"/g, "") : null;

    results.push({
      path: relPath,
      mtime,
      etag,
      isDirectory: isDir,
    });
  });

  // 过滤掉根目录自身，只返回文件和非根目录
  return results.filter(
    (f) => f.path !== "" && f.path !== "/" && !(f.isDirectory && f.path === ".")
  );
}

/**
 * 计算字符串的 SHA-256 哈希，返回前 16 位十六进制字符串
 */
export async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex.substring(0, 16);
}

/**
 * 规范化路径：移除多余斜杠、尾部斜杠
 */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * 简单 glob 模式匹配（支持 *、**、? 和 {a,b}）
 * 注意：这是一个简化实现，覆盖常用场景
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  // 转义正则特殊字符，将 glob 模式转为正则
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);

  let regexStr = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*" && normalizedPattern[i + 2] === "/") {
      // **/ 匹配任意深度路径
      regexStr += "(.*/)?";
      i += 3;
      continue;
    } else if (ch === "*" && normalizedPattern[i + 1] === "*" && normalizedPattern[i + 2] === undefined) {
      // 末尾的 ** 匹配剩余全部
      regexStr += ".*";
      i += 2;
      continue;
    } else if (ch === "*" && normalizedPattern[i + 1] === "/") {
      // */ 匹配单级目录
      regexStr += "[^/]+/";
      i += 2;
      continue;
    } else if (ch === "*") {
      // 单星号匹配非斜杠字符
      regexStr += "[^/]*";
      i += 1;
      continue;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    } else if (ch === "{") {
      // {a,b} 模式
      const closeBrace = normalizedPattern.indexOf("}", i);
      if (closeBrace !== -1) {
        const alternatives = normalizedPattern.substring(i + 1, closeBrace).split(",");
        regexStr += "(" + alternatives.map((a) => a.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")";
        i = closeBrace + 1;
        continue;
      }
    } else if (/[.+?^${}()|[\]\\]/.test(ch)) {
      regexStr += "\\" + ch;
    } else {
      regexStr += ch;
    }
    i++;
  }

  // 如果模式不以 $ 结尾，自动匹配到末尾
  try {
    const regex = new RegExp("^" + regexStr + "$");
    return regex.test(normalizedPath);
  } catch {
    // 正则无效时回退到简单前缀匹配
    return normalizedPath.startsWith(normalizedPattern);
  }
}

/**
 * 格式化时间戳为备份文件名格式: YYYY-MM-DD_HHmmss
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number, len: number = 2) => n.toString().padStart(len, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * 生成冲突备份文件路径
 * 例如: notes.md → notes.2026-07-01_153045.md
 */
export function getBackupPath(originalPath: string): string {
  const dir = originalPath.includes("/") ? originalPath.substring(0, originalPath.lastIndexOf("/") + 1) : "";
  const filename = originalPath.includes("/") ? originalPath.substring(originalPath.lastIndexOf("/") + 1) : originalPath;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    // 无扩展名或点开头文件（如 .gitignore）
    return `${dir}${filename}.${formatTimestamp(new Date())}`;
  }
  const basename = filename.substring(0, lastDot);
  const ext = filename.substring(lastDot);
  return `${dir}${basename}.${formatTimestamp(new Date())}${ext}`;
}

/**
 * 文件是否在 .obsidian 目录下
 */
export function isObsidianDir(path: string): boolean {
  return path.startsWith(".obsidian/") || path === ".obsidian";
}

/**
 * 检查文件是否应排除（.obsidian 或匹配排除模式）
 */
export function shouldExclude(
  path: string,
  excludePatterns: string[],
  includePatterns: string[]
): boolean {
  // 始终排除 .obsidian
  if (isObsidianDir(path)) return true;

  // 如果有包含模式，文件必须匹配至少一个
  if (includePatterns.length > 0) {
    const matchesInclude = includePatterns.some((p) => matchGlob(p.trim(), path));
    if (!matchesInclude) return true;
  }

  // 排除模式
  if (excludePatterns.length > 0) {
    return excludePatterns.some((p) => p.trim() && matchGlob(p.trim(), path));
  }

  return false;
}
