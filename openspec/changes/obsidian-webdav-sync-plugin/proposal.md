## Why

Obsidian 用户需要一个可靠的工具，将本地 vault 文件与自建 WebDAV 服务器进行双向同步，实现多设备间的数据备份与协作。现有同步方案（Obsidian Sync、git、第三方云盘）要么付费、要么配置复杂、要么依赖特定云服务。自建 WebDAV + 插件方案给予用户完全的数据控制权。

## What Changes

- 开发一个 Obsidian 插件 `obsidian-webdav-sync`，实现本地 vault ↔ 远程 WebDAV 存储的双向同步
- 插件提供完整的设置界面，允许用户配置连接参数、触发方式、文件过滤规则
- 支持四种同步触发方式（手动/保存时/定时/启动时），可在设置中多选
- 内置冲突处理机制：新文件覆盖旧文件，旧文件自动重命名并加时间戳备份
- 需要用户在服务器端搭建 WebDAV 服务（推荐 wsgidav + Nginx 反向代理方案）
- 零第三方运行时依赖，全部使用原生 Web API

## Capabilities

### New Capabilities
- `webdav-connection`: WebDAV 服务器连接管理，支持 URL 配置、HTTP Basic Auth 认证、连接测试
- `file-sync`: 核心双向同步功能，包含文件扫描、状态对比、上传下载执行
- `conflict-resolution`: 冲突检测与处理，按时间戳判定新旧，旧文件改名备份
- `sync-triggers`: 多种同步触发方式（手动命令、保存时、定时器、启动时）
- `file-filtering`: 文件包含/排除规则，始终过滤 .obsidian/ 目录
- `sync-state-persistence`: 文件同步状态持久化，使用本地 JSON 文件记录每个文件的 hash 和 mtime

### Modified Capabilities
无（新项目，无已有 specs）

## Impact

- **新代码**: 完整的 Obsidian 插件项目，约 7 个 TypeScript 模块 + 设置界面 + 样式文件
- **无外部 API 依赖**: 仅使用 Obsidian Plugin API + 原生 Web API (fetch, crypto.subtle, DOMParser)
- **无运行时依赖**: 零第三方 npm 包，开发依赖仅 obsidian 类型定义 + esbuild + TypeScript
- **服务器端**: 用户需在服务器搭建 WebDAV 服务（wsgidav + Nginx），不涉及本插件代码变更
- **存储**: 在 vault 内 `.obsidian/plugins/webdav-sync/` 目录下创建状态 JSON 文件
- **兼容性**: 纯 Web API 实现，理论上可在桌面/Android/iOS Obsidian 客户端工作
