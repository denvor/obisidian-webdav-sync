## Context

本插件是一个 Obsidian vault 与用户自建 WebDAV 服务器之间的双向同步工具。用户通过 Nginx + wsgidav 搭建 WebDAV 服务，插件在 Obsidian 内通过原生 Web API（fetch、crypto.subtle、DOMParser）与服务器通信，实现文件的增删改同步。

插件运行在 Obsidian 的 Electron 环境（桌面）或 WebView 环境（移动端），无第三方运行时依赖。文件状态通过本地 JSON 文件持久化到 vault 的插件数据目录。

## Goals / Non-Goals

**Goals:**
- 实现本地 ↔ 远程的双向文件同步（增/删/改）
- 支持四种触发方式：手动命令、保存时自动、定时轮询、启动时自动
- 设置界面可配置：服务器地址、认证信息、触发方式、文件过滤规则
- 冲突检测与自动处理：新文件覆盖旧文件，旧文件备份改名
- 零运行时依赖，仅使用原生 API
- 文件状态（hash + mtime）本地持久化，支持断点式同步

**Non-Goals:**
- 不做实时协作/多人同时编辑（无锁定机制）
- 不做版本历史管理（仅保留最新 + 冲突备份）
- 不做加密传输（依赖 HTTPS 传输层加密）
- 不做选择性文件同步 UI（全部文件基于 glob 规则同步）
- 不实现 WebDAV 服务端（由用户自行搭建）

## Decisions

### 1. 通信协议：原生 fetch vs axios / node:http

**选择：** 原生 `fetch` API

| 方案 | 优点 | 缺点 |
|------|------|------|
| fetch | Obsidian Electron 内置，无需依赖；支持 Promise；移动端可用 | 需手动处理 PROPFIND XML 解析 |
| axios | 更友好的 API | 需额外依赖，增加打包体积 |
| node:http | 完整 HTTP 控制 | 仅桌面可用，移动端不支持 |

**结论：** fetch 是 Obsidian 插件生态的标准选择，兼容所有平台。

### 2. 文件哈希：SHA-256 vs MD5 vs mtime-only

**选择：** SHA-256（前 16 位十六进制）+ mtime 双重判断

| 方案 | 优点 | 缺点 |
|------|------|------|
| SHA-256 + mtime | 精确判断内容变化；crypto.subtle 原生支持 | 大文件计算稍慢 |
| MD5 | 更短（32位） | 需引入第三方库 |
| mtime-only | 最快 | 不准确（文件修改后改回、时区问题） |

**结论：** SHA-256 由浏览器原生支持无需引入依赖，截取前 16 位兼顾精确度和存储空间。mtime 作为快速预检，hash 做最终判断。

### 3. 冲突处理：newer_wins vs 手动解决 vs 跳过

**选择：** Newer Wins + 旧文件备份重命名

- 自动解决无需用户介入
- 旧文件备份保留数据不丢失
- 重命名格式 `filename.YYYY-MM-DD_HHmmss.ext` 用户可手动恢复
- 通过 WebDAV MOVE 方法在服务端执行远程重命名

### 4. 状态持久化：JSON 文件 vs IndexedDB vs Obsidian localStorage

**选择：** 本地 JSON 文件（`.obsidian/plugins/webdav-sync/file-states.json`）

| 方案 | 优点 | 缺点 |
|------|------|------|
| JSON 文件 | 透明可读、易调试、无容量限制 | 全量读写 |
| IndexedDB | 高效查询 | Obsidian 插件中不常用，调试困难 |
| localStorage | 简单 | 容量限制（5MB），vault 间不迁移 |

**结论：** JSON 文件是 Obsidian 插件社区的标准做法（参考官方 sample plugin），文件随 vault 自动备份迁移。

### 5. 模块拆分：单一文件 vs 多模块

**选择：** 多模块拆分（7 个 ts 文件）

- `types.ts` — 类型定义，被所有模块引用
- `utils.ts` — 工具函数（XML 解析、哈希计算）
- `webdav-client.ts` — HTTP 客户端
- `file-tracker.ts` — 状态跟踪
- `sync-engine.ts` — 核心编排
- `conflict-resolver.ts` — 冲突处理
- `settings.ts` — 设置界面

每个模块职责单一，便于测试和修改。

### 6. 构建工具：esbuild 与 Obsidian 插件标准

**选择：** esbuild + TypeScript

Obsidian 官方 sample plugin 使用 esbuild 作为构建工具，输出单一 `main.js`。配合 `obsidian` npm 包提供类型定义。无需 webpack、rollup 等更复杂的配置。

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 大文件上传超时 | 同步失败 | 客户端设置合理超时；服务端配置 proxy_timeout；文件过大时跳过 |
| 网络不稳定中断同步 | 同步状态不一致 | 同步引擎支持重试；状态持久化可恢复 |
| 大量文件（>10,000）全量扫描 | Obsidian 性能下降 | 扫描过程异步 + 进度回调；使用 vault API 而非文件系统遍历 |
| 移动端后台被杀 | 定时同步失效 | 定时间隔在移动端自动降级为仅前台执行；文档中说明限制 |
| wsgidav 单点故障 | 同步不可用 | systemd 自动重启；Nginx 可配置多个 wsgidav 后端 |
| 并发修改同一文件（本+远） | 数据丢失风险 | Newer wins 策略保证至少保留一份最新内容；旧文件备份可恢复 |
