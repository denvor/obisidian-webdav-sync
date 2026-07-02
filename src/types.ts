import { App, PluginSettingTab, Setting, Plugin } from "obsidian";

// ==================== 类型定义 ====================

export interface SyncSettings {
  webdavUrl: string;
  username: string;
  password: string;
  syncOnSave: boolean;
  syncOnStartup: boolean;
  syncInterval: number;
  syncDirection: "bidirectional" | "upload_only" | "download_only";
  includePatterns: string;
  excludePatterns: string;
}

export interface FileState {
  path: string;
  localMtime: number;
  localHash: string;
  remoteMtime: number | null;
  remoteHash: string | null;
  status: "synced" | "pending_upload" | "pending_download" | "conflict";
}

export interface WebdavFileInfo {
  path: string;
  mtime: number | null;
  etag: string | null;
  isDirectory: boolean;
}

export type SyncAction =
  | { type: "upload"; path: string; content?: string }
  | { type: "download"; path: string }
  | { type: "delete_remote"; path: string }
  | { type: "delete_local"; path: string }
  | { type: "mkdir_remote"; path: string }
  | { type: "conflict_upload"; path: string; backupPath: string; content?: string }
  | { type: "conflict_download"; path: string; backupPath: string };

export const DEFAULT_SETTINGS: SyncSettings = {
  webdavUrl: "",
  username: "",
  password: "",
  syncOnSave: false,
  syncOnStartup: false,
  syncInterval: 0,
  syncDirection: "bidirectional",
  includePatterns: "",
  excludePatterns: "",
};

export const PLUGIN_DATA_DIR = ".obsidian/plugins/obsidian-webdav-sync";
export const STATE_FILE = "file-states.json";
