## 1. 项目初始化

- [x] 1.1 创建 package.json（esbuild、typescript、obsidian 类型等开发依赖）
- [x] 1.2 创建 tsconfig.json（target ES2020、module ESNext、严格模式）
- [x] 1.3 创建 manifest.json（插件 id: obsidian-webdav-sync、名称、版本、minAppVersion）
- [x] 1.4 创建 esbuild.config.mjs（入口 main.ts、输出 main.js + manifest.json）
- [x] 1.5 创建 version-bump.mjs（版本更新钩子）
- [x] 1.6 创建 .gitignore
- [x] 1.7 验证构建：`npm run build` 成功输出 main.js

## 2. 公共类型与工具函数

- [x] 2.1 定义所有类型到 src/types.ts（SyncSettings、FileState、SyncAction、WebdavFileInfo）
- [x] 2.2 实现 XML PROPFIND 响应解析 parsePropfindResponse() 到 src/utils.ts
- [x] 2.3 实现 SHA-256 哈希计算 computeHash() 到 src/utils.ts
- [x] 2.4 实现路径规范化 normalizePath() 到 src/utils.ts
- [x] 2.5 实现 glob 模式匹配 matchGlob() 到 src/utils.ts

## 3. WebDAV 客户端

- [x] 3.1 实现 WebdavClient 类，含构造函数（url + auth header 初始化）
- [x] 3.2 实现 list(path) 方法：PROPFIND → XML 解析 → 返回文件/目录列表
- [x] 3.3 实现 download(path) 方法：GET → 返回文件内容
- [x] 3.4 实现 upload(path, content) 方法：PUT → 上传文件
- [x] 3.5 实现 delete(path) 方法：DELETE → 删除远程文件/目录
- [x] 3.6 实现 createDirectory(path) 方法：MKCOL → 创建远程目录
- [x] 3.7 实现 move(from, to) 方法：MOVE → 重命名/移动远程文件
- [x] 3.8 实现错误处理和重试逻辑（网络错误重试 3 次）

## 4. 文件状态跟踪

- [x] 4.1 实现 FileTracker 类：状态文件的加载 (load) 和保存 (save)
- [x] 4.2 实现 getState(path)/setState(path, state)/removeState(path) 单文件操作
- [x] 4.3 实现 getChangedFiles(localFiles, remoteFiles) 对比生成操作列表
- [x] 4.4 处理首次运行（无状态文件）→ 全量同步

## 5. 冲突处理

- [x] 5.1 实现 ConflictResolver 类，根据 mtime 判断新旧
- [x] 5.2 实现上传统冲突：远程旧文件 MOVE 改名 → PUT 本地文件
- [x] 5.3 实现下载冲突：本地旧文件重命名 → GET 远程文件
- [x] 5.4 冲突备份文件名格式：{basename}.{YYYY-MM-DD}_{HHmmss}{ext}

## 6. 同步引擎

- [x] 6.1 实现 SyncEngine 类：scanLocal() 遍历 vault 获取文件列表
- [x] 6.2 实现 SyncEngine.listRemote() 调用 webdavClient.list() 递归列出远程文件
- [x] 6.3 实现 SyncEngine.compare() 调用 fileTracker.getChangedFiles() 生成操作列表
- [x] 6.4 实现 SyncEngine.executeActions() 按顺序执行 sync actions
- [x] 6.5 实现 SyncEngine.sync() 编排完整流程
- [x] 6.6 实现进度回调 onProgress(bytes/total)
- [x] 6.7 实现中止同步 abort() 方法
- [x] 6.8 实现同步中跳过并发触发（已有同步进行时新触发跳过）

## 7. 设置界面

- [x] 7.1 创建 SettingTab 类：WebDAV 连接配置（URL、用户名、密码）UI
- [x] 7.2 实现"测试连接"按钮功能
- [x] 7.3 实现触发方式开关 UI（启动时/保存时/定时）
- [x] 7.4 实现同步方向下拉选择 UI（双向/仅上传/仅下载）
- [x] 7.5 实现文件过滤规则输入 UI（包含/排除 glob 模式）
- [x] 7.6 实现冲突策略说明（只读显示 newer_wins）
- [x] 7.7 实现设置持久化（加载/保存到 Obsidian plugin data）

## 8. 插件入口

- [x] 8.1 实现 Plugin 子类：onload() 注册设置 tab、命令、事件
- [x] 8.2 注册手动同步命令 "Sync with WebDAV"
- [x] 8.3 实现保存时自动同步（vault.on('modify') + 防抖）
- [x] 8.4 实现定时同步（setInterval + 可配置间隔）
- [x] 8.5 实现启动时自动同步（setTimeout 5 秒后）
- [x] 8.6 实现 onunload() 清理定时器和事件
- [x] 8.7 实现 .obsidian/ 目录自动排除逻辑

## 9. 样式与完善

- [x] 9.1 编写 styles.css（深色主题适配、设置界面布局）
- [x] 9.2 状态栏显示同步状态
- [x] 9.3 错误通知（toast/notice 显示同步失败信息）

## 10. 构建与验证

- [x] 10.1 `npm run build` 构建通过
- [x] 10.2 在本地启动测试 wsgidav 实例
- [x] 10.3 端到端测试：创建文件 → 同步 → 验证远程存在
- [x] 10.4 端到端测试：远程修改 → 同步 → 验证本地更新
- [x] 10.5 端到端测试：双方同时修改 → 冲突 → 新文件覆盖 + 旧文件备份
- [x] 10.6 测试所有四种触发方式分别生效
