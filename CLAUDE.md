# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

Obsidian WebDAV Sync — 一个 Obsidian 插件，将本地 vault 文件与用户服务器上的 WebDAV 存储进行双向同步。服务器推使用 wsgidav (Python) 在 Nginx 后做反向代理。

## 构建命令

```bash
npm run build        # 使用 esbuild 构建出 main.js + manifest.json
npm run dev          # 开发模式，监听文件变更自动重新构建
```

## 项目结构

```
obsidian-webdav-sync/
├── manifest.json          # 插件元数据 (id, name, version, minAppVersion)
├── package.json           # 依赖管理
├── esbuild.config.mjs     # 构建配置
├── main.ts                # 插件入口 — Plugin 类，注册命令/设置/事件
├── src/
│   ├── types.ts           # 所有类型定义 (SyncSettings, FileState, SyncAction 等)
│   ├── utils.ts           # 工具函数 (XML PROPFIND 解析、文件哈希、路径处理)
│   ├── webdav-client.ts   # WebDAV HTTP 客户端
│   ├── file-tracker.ts    # 文件状态跟踪 (hash + mtime + 本地JSON持久化)
│   ├── sync-engine.ts     # 核心同步流程编排
│   ├── conflict-resolver.ts # 冲突检测处理 (新覆盖旧，旧改名备份)
│   └── settings.ts        # PluginSettingTab 设置界面
└── styles.css             # 设置界面样式
```

## 架构要点

### 核心数据流

```
sync-engine.sync()
  1. scanLocal()          → 遍历 vault 文件，计算 mtime + SHA-256
  2. webdavClient.list()  → PROPFIND 递归列出远程文件 (mtime + ETag)
  3. fileTracker.compare()→ 对比本地/远程，生成操作列表
  4. conflictResolver     → 按时间戳处理冲突文件
  5. executeActions()     → 创建目录 → 上传/下载 → 删除
  6. fileTracker.save()   → 持久化状态
```

### 关键设计决策

- **WebDAV 客户端**: 使用 Obsidian Electron 内置的 `fetch` API，无第三方运行时依赖
- **文件跟踪**: 基于 SHA-256 哈希（前 16 位）和 mtime 双重判断，状态持久化到 `.obsidian/plugins/webdav-sync/file-states.json`
- **冲突处理**: 比较双方 mtime，新文件保留原名，旧文件重命名加时间戳 `filename.YYYY-MM-DD_HHmmss.ext`
- **文件过滤**: 始终排除 `.obsidian/`，用户可配置包含/排除 glob 模式
- **触发方式**: 在设置中可多选 (手动/保存时/定时/启动时)，互不冲突

### 模块依赖关系

```
main.ts
  ├─ settings.ts          (设置 UI, 仅依赖 types.ts)
  ├─ sync-engine.ts       (核心编排)
  │    ├─ webdav-client.ts   (HTTP 通信)
  │    ├─ file-tracker.ts    (状态对比 + 持久化)
  │    └─ conflict-resolver.ts (冲突处理)
  └─ types.ts + utils.ts  (被所有模块引用)
```

### 同步触发实现方式

- **手动**: `this.addCommand({ id: 'sync-now', callback })`
- **保存时**: `this.registerEvent(this.vault.on('modify', debouncedFn))`
- **定时**: `this.registerInterval(window.setInterval(fn, ms))`
- **启动时**: `onload()` 中 `setTimeout(fn, 5000)`

## WebDAV 协议要点

实现中需处理的 HTTP 方法：
- `PROPFIND` — 列目录，响应为 XML（`application/xml`），用 `DOMParser` 解析
- `GET` — 下载文件
- `PUT` — 上传文件
- `DELETE` — 删除文件/目录
- `MKCOL` — 创建目录
- `MOVE` — 重命名/移动文件（冲突备份时使用）

响应头 `ETag` 用作远程文件哈希对比。

## 通用规则

- 代码注释使用中文
- 不引入不必要的第三方依赖
- 匹配 Obsidian 插件社区的代码风格（参考官方 sample plugin）
- 状态持久化使用 JSON 文件，不引入数据库
