import { Plugin, Notice } from "obsidian";
import { SyncSettings, DEFAULT_SETTINGS } from "./src/types";
import { WebdavClient } from "./src/webdav-client";
import { FileTracker } from "./src/file-tracker";
import { ConflictResolver } from "./src/conflict-resolver";
import { SyncEngine } from "./src/sync-engine";
import { Logger } from "./src/logger";
import { WebdavSyncSettingTab } from "./src/settings";

// ==================== 插件主类 ====================

export default class WebdavSyncPlugin extends Plugin {
  settings!: SyncSettings;
  private client: WebdavClient | null = null;
  private tracker: FileTracker | null = null;
  private logger: Logger | null = null;
  private engine: SyncEngine | null = null;
  private intervalId: number | null = null;
  private saveSyncHandler: (() => void) | null = null;
  private statusBarItem: HTMLElement | null = null;
  private ribbonIcon: HTMLElement | null = null;

  // ==================== 生命周期 ====================

  async onload(): Promise<void> {
    await this.loadSettings();

    // 初始化日志器
    this.logger = new Logger(this.app.vault);
    this.logger.info("插件已加载");

    // 初始化核心模块
    this.tracker = new FileTracker(this.app.vault);
    await this.tracker.load();

    // 初始化 WebDAV 客户端（如果有配置）
    this.initClient();

    // 初始化同步引擎
    this.initEngine();

    // 注册设置页
    this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

    // 注册手动同步命令
    this.addCommand({
      id: "sync-now",
      name: "Sync with WebDAV",
      callback: () => this.runSync(),
    });

    // 状态栏
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("WebDAV: 就绪");

    // 左侧 Ribbon 图标
    this.ribbonIcon = this.addRibbonIcon(
      "cloud",
      "WebDAV 设置",
      () => {
        // 点击图标打开插件设置页
        const setting = (this.app as any).setting;
        if (setting) {
          setting.open();
          setting.openTabById("obsidian-webdav-sync");
        }
      }
    );
    // 将图标移到插件图标列表最后
    this.moveRibbonToBottom();

    // 保存时同步监听
    this.updateSaveSyncListener();

    // 定时同步
    this.updateIntervalSync();

    // 启动时同步
    if (this.settings.syncOnStartup && this.client) {
      setTimeout(() => {
        this.runSync();
      }, 5000);
    }
  }

  onunload(): void {
    // 清除定时器
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // 移除保存事件
    if (this.saveSyncHandler) {
      this.app.vault.off("modify", this.saveSyncHandler);
      this.saveSyncHandler = null;
    }

    // 刷出日志（fire-and-forget，onunload 不能 await）
    this.logger?.flush();
  }

  // ==================== 设置管理 ====================

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // 配置变更时重新初始化客户端
    this.initClient();
    this.initEngine();
  }

  // ==================== 客户端初始化 ====================

  private initClient(): void {
    if (this.settings.webdavUrl && this.settings.username) {
      this.client = new WebdavClient(
        this.settings.webdavUrl,
        this.settings.username,
        this.settings.password
      );
    } else {
      this.client = null;
    }
  }

  private initEngine(): void {
    if (!this.client || !this.tracker || !this.logger) return;
    const resolver = new ConflictResolver(this.app.vault, this.client);
    this.engine = new SyncEngine(
      this.app.vault,
      this.client,
      this.tracker,
      resolver,
      this.settings,
      this.logger
    );
    // 挂载进度回调：实时更新状态栏
    this.engine.setOnProgress((current, total, message) => {
      if (total > 0) {
        this.statusBarItem?.setText(`WebDAV: ${message} (${current}/${total})`);
      } else {
        this.statusBarItem?.setText(`WebDAV: ${message}`);
      }
    });
  }

  /**
   * 将 Ribbon 图标移到最底部（设置齿轮上方）
   */
  private moveRibbonToBottom(): void {
    if (!this.ribbonIcon) return;
    const retry = (attempt: number) => {
      if (attempt > 15) return;
      const ribbon = document.querySelector(".workspace-ribbon");
      if (!ribbon || !this.ribbonIcon) {
        setTimeout(() => retry(attempt + 1), 300);
        return;
      }
      // 找到所有 clickable-icon 插件图标
      const icons = ribbon.querySelectorAll<HTMLElement>(".clickable-icon");
      // 排除 sidebar-actions 里的（设置齿轮）
      const sidebar = ribbon.querySelector(".sidebar-actions");
      const pluginIcons = Array.from(icons).filter(
        (icon) => !sidebar?.contains(icon)
      );
      // 把我们的图标移到插件图标列表的最后
      const lastPluginIcon = pluginIcons[pluginIcons.length - 1];
      if (lastPluginIcon && this.ribbonIcon !== lastPluginIcon) {
        lastPluginIcon.parentNode?.insertBefore(
          this.ribbonIcon,
          lastPluginIcon.nextSibling
        );
      }
    };
    retry(0);
  }

  // ==================== 同步触发 ====================

  /**
   * 测试 WebDAV 连接
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.client) {
      return { ok: false, message: "请先配置服务器地址和用户名" };
    }
    return await this.client.testConnection();
  }

  /**
   * 执行完整同步
   */
  async runSync(): Promise<{ success: boolean; message: string }> {
    if (!this.engine) {
      new Notice("请先在设置中配置 WebDAV 连接");
      return { success: false, message: "请先配置连接" };
    }

    if (this.engine.isSyncing()) {
      new Notice("同步已在进行中");
      return { success: false, message: "同步已在进行中" };
    }

    this.ribbonIcon?.addClass("syncing");
    this.statusBarItem?.setText("WebDAV: 同步中...");

    const result = await this.engine.sync();

    this.ribbonIcon?.removeClass("syncing");

    if (result.success) {
      this.statusBarItem?.setText("WebDAV: 已同步");
      if (result.actions.length > 0) {
        new Notice(result.message);
      }
    } else {
      this.statusBarItem?.setText("WebDAV: 错误");
      new Notice("同步失败: " + result.message);
    }

    // 几秒后恢复就绪状态
    setTimeout(() => {
      this.statusBarItem?.setText("WebDAV: 就绪");
    }, 5000);

    return result;
  }

  /**
   * 更新保存时同步监听器
   */
  updateSaveSyncListener(): void {
    // 移除旧监听
    if (this.saveSyncHandler) {
      this.app.vault.off("modify", this.saveSyncHandler);
      this.saveSyncHandler = null;
    }

    // 如果启用了保存时同步，添加新监听
    if (this.settings.syncOnSave && this.engine) {
      // 防抖：1 秒内多次触发只执行一次
      let timeoutId: number | null = null;
      this.saveSyncHandler = async () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(async () => {
          await this.runSync();
        }, 1000);
      };
      this.app.vault.on("modify", this.saveSyncHandler);
    }
  }

  /**
   * 更新定时同步
   */
  updateIntervalSync(): void {
    // 清除旧定时器
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // 设置新定时器
    if (this.settings.syncInterval > 0 && this.engine) {
      this.intervalId = window.setInterval(
        () => this.runSync(),
        this.settings.syncInterval * 60 * 1000
      );
    }
  }
}
