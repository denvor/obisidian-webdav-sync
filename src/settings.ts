import { App, PluginSettingTab, Setting } from "obsidian";
import WebdavSyncPlugin from "../main";
import { SyncSettings, DEFAULT_SETTINGS } from "./types";

/**
 * 插件设置界面
 */
export class WebdavSyncSettingTab extends PluginSettingTab {
  plugin: WebdavSyncPlugin;

  constructor(app: App, plugin: WebdavSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ===== 操作（放最上面） =====
    containerEl.createEl("h3", { text: "📊 操作" });

    new Setting(containerEl)
      .setName("立即同步")
      .setDesc("立即开始同步本地文件与 WebDAV 服务器")
      .addButton((btn) =>
        btn
          .setButtonText("🔄 立即同步")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("同步中...");
            btn.setDisabled(true);
            try {
              const result = await this.plugin.runSync();
              btn.setButtonText(result.message);
            } catch {
              btn.setButtonText("同步失败");
            }
            setTimeout(() => {
              btn.setButtonText("🔄 立即同步");
              btn.setDisabled(false);
            }, 5000);
          })
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("检查 WebDAV 服务器是否可访问")
      .addButton((btn) =>
        btn
          .setButtonText("🔄 测试连接")
          .onClick(async () => {
            btn.setButtonText("连接中...");
            btn.setDisabled(true);
            try {
              const result = await this.plugin.testConnection();
              if (result.ok) {
                btn.setButtonText("✅ 连接成功");
              } else {
                btn.setButtonText("❌ " + result.message);
              }
            } catch {
              btn.setButtonText("❌ 连接失败");
            }
            setTimeout(() => {
              btn.setButtonText("🔄 测试连接");
              btn.setDisabled(false);
            }, 3000);
          })
      );

    // ===== WebDAV 服务器 =====
    containerEl.createEl("h3", { text: "🔗 WebDAV 服务器" });

    new Setting(containerEl)
      .setName("服务器地址")
      .setDesc("WebDAV 服务的完整 URL，例如 https://example.com/webdav/")
      .addText((text) =>
        text
          .setPlaceholder("https://example.com/webdav/")
          .setValue(this.plugin.settings.webdavUrl)
          .onChange(async (value) => {
            this.plugin.settings.webdavUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("用户名")
      .addText((text) =>
        text
          .setPlaceholder("用户名")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("密码")
      .addText((text) => {
        text
          .setPlaceholder("密码")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
        // 密码类型
        (text.inputEl as HTMLInputElement).type = "password";
      });

    containerEl.createEl("h3", { text: "⏱️ 触发方式" });

    // 启动时同步
    new Setting(containerEl)
      .setName("启动时自动同步")
      .setDesc("Obsidian 打开后自动触发同步")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    // 保存时同步
    new Setting(containerEl)
      .setName("保存时自动同步")
      .setDesc("每次保存文件时自动同步该文件")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnSave)
          .onChange(async (value) => {
            this.plugin.settings.syncOnSave = value;
            await this.plugin.saveSettings();
            this.plugin.updateSaveSyncListener();
          })
      );

    // 定时同步
    new Setting(containerEl)
      .setName("定时同步")
      .setDesc("每隔指定分钟数自动同步（0 表示禁用）")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.syncInterval))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.syncInterval = num;
              await this.plugin.saveSettings();
              this.plugin.updateIntervalSync();
            }
          })
      );

    containerEl.createEl("h3", { text: "↕️ 同步选项" });

    // 同步方向
    new Setting(containerEl)
      .setName("同步方向")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bidirectional", "双向同步（本地 ↔ 远程）")
          .addOption("upload_only", "仅上传（本地 → 远程）")
          .addOption("download_only", "仅下载（远程 → 本地）")
          .setValue(this.plugin.settings.syncDirection)
          .onChange(async (value) => {
            this.plugin.settings.syncDirection = value as SyncSettings["syncDirection"];
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "🔍 文件过滤" });

    // 包含模式
    new Setting(containerEl)
      .setName("仅包含模式")
      .setDesc("一行一个 glob 模式，留空表示包含所有文件")
      .addTextArea((text) =>
        text
          .setPlaceholder("*.md\n*.txt\nassets/**")
          .setValue(this.plugin.settings.includePatterns)
          .onChange(async (value) => {
            this.plugin.settings.includePatterns = value;
            await this.plugin.saveSettings();
          })
      );

    // 排除模式
    new Setting(containerEl)
      .setName("排除模式")
      .setDesc("一行一个 glob 模式。.obsidian/ 始终被排除")
      .addTextArea((text) =>
        text
          .setPlaceholder("archive/**\ntmp/**")
          .setValue(this.plugin.settings.excludePatterns)
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "⚡ 冲突处理" });

    new Setting(containerEl)
      .setName("冲突策略")
      .setDesc("新文件覆盖旧文件，旧文件自动重命名加时间戳备份")
      .addText((text) =>
        text
          .setValue("newer_wins（新文件优先）")
          .setDisabled(true)
      );
  }
}
