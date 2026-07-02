# Obsidian WebDAV Sync 插件 — 实现计划

## 背景

在阿里云 Ubuntu 24 + Nginx 服务器上搭建 WebDAV 服务，开发一个 Obsidian 插件实现本地 vault 与远程 WebDAV 存储的**双向同步**。

### 核心需求

| 项目 | 决定 |
|------|------|
| 同步方向 | **双向**（本地 ↔ 远程） |
| 触发方式 | 插件设置中**可多选**：手动 / 保存时 / 定时 / 启动时 |
| 冲突处理 | **新文件覆盖旧文件**，旧文件重命名加时间戳作为备份 |
| 认证 | HTTP **Basic Auth** |
| 服务端 | 阿里云 Ubuntu 24 + Nginx，需搭建 WebDAV |

---

## 一、服务端方案：wsgidav 反向代理

### 为什么不用 Nginx 自带的 DAV 模块

Nginx 内置的 `ngx_http_dav_module` 仅支持 PUT、DELETE、MKCOL、COPY、MOVE，**不支持 PROPFIND**（列目录）。而 Obisidian 插件需要列出远程文件进行对比，所以需要一个完整的 WebDAV 实现。

### 推荐架构

```
外网 ── HTTPS :443 ──→ Nginx (SSL终止 + Basic Auth) ──反向代理──→ wsgidav :8008
                                                                    │
                                                              /var/www/webdav/data/
```

### 详细搭建步骤

#### 第1步：创建 Python 虚拟环境并安装 wsgidav

```bash
# 安装 Python 3 + venv (Ubuntu 24 自带 Python 3.12)
sudo apt update
sudo apt install python3 python3-venv -y

# 创建虚拟环境目录
sudo mkdir -p /opt/webdav
sudo python3 -m venv /opt/webdav/venv

# 在虚拟环境中安装 wsgidav + cheroot
sudo /opt/webdav/venv/bin/pip install wsgidav cheroot
```

安装后，wsgidav 的可执行文件路径为 `/opt/webdav/venv/bin/wsgidav`。

#### 第2步：创建数据目录和用户

```bash
# 创建存储目录
sudo mkdir -p /var/www/webdav/data

# 创建系统用户运行 wsgidav
sudo useradd -r -s /usr/sbin/nologin -d /var/www/webdav webdav

# 添加 webdav 用户到 www-data 组（可选，与 Nginx 共享访问）
sudo usermod -aG www-data webdav

# 设置权限：webdav 用户对数据目录应有读写权限
sudo chown -R webdav:webdav /var/www/webdav

# 虚拟环境目录归 root 所有但允许 webdav 读取执行
sudo chown -R root:root /opt/webdav
sudo chmod -R 755 /opt/webdav
```

#### 第3步：创建 wsgidav 配置文件

`/etc/webdav/config.yaml`:

```yaml
host: "127.0.0.1"        # 仅监听本地，通过 Nginx 反代
port: 8008

provider_mapping:
  "/": "/var/www/webdav/data"

# 关闭内置认证（认证由 Nginx Basic Auth 负责）
http_authenticator:
  accept_basic: true
  accept_digest: false
  default_to_digest: false

simple_dc:
  user_mapping:
    "/": true

logging:
  level: INFO
```

> **注意**：wsgidav 4.x 默认启用自己的 Basic Auth。通过 `http_authenticator` + `simple_dc.user_mapping` 配置使其放行所有请求，认证全部交给上游 Nginx。`host` 和 `path` 必须用引号包裹。

# 日志级别
logging:
  level: INFO
```

#### 第4步：创建 systemd 服务

`/etc/systemd/system/wsgidav.service`:

```ini
[Unit]
Description=WebDAV Server (wsgidav)
After=network.target

[Service]
Type=simple
User=webdav
Group=webdav
ExecStart=/opt/webdav/venv/bin/wsgidav --config /etc/webdav/config.yaml
WorkingDirectory=/var/www/webdav
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wsgidav
sudo systemctl status wsgidav   # 验证运行
```

#### 第5步：配置 Basic Auth 用户

```bash
# 安装 htpasswd 工具
sudo apt install apache2-utils -y

# 创建用户（会提示输入密码）
sudo htpasswd -c /etc/nginx/.htpasswd webdav
```

`/etc/nginx/.htpasswd` 内容示例（一行一个用户）:
```
webdav:$apr1$xxxxxxx...
```

#### 第6步：配置 Nginx 反向代理（含 CORS）

`/etc/nginx/sites-available/webdav`:

```nginx
server {
    listen 443 ssl;
    server_name webdav.denvor.com;
    access_log /var/log/nginx/webdav.denvor.com.log;

    location / {
        # CORS 预检请求 — 直接返回，不检查认证
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Credentials "true" always;
            add_header Access-Control-Allow-Methods "GET, PUT, POST, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Depth, Content-Type, Destination, Overwrite, If" always;
            add_header Access-Control-Expose-Headers "DAV, ETag" always;
            add_header Content-Length 0 always;
            add_header Content-Type text/plain always;
            return 204;
        }

        # 正常请求需要 Basic Auth
        auth_basic "WebDAV";
        auth_basic_user_file /etc/nginx/.htpasswd;

        # 反向代理到 wsgidav
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebDAV 需要这些请求体设置
        client_max_body_size 0;           # 不限制上传大小
        proxy_request_buffering off;      # 文件上传必需

        # 超时设置（大文件上传）
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;

        # 对 proxy_pass 的响应加上 CORS 头
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, PUT, POST, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Depth, Content-Type, Destination, Overwrite, If" always;
        add_header Access-Control-Expose-Headers "DAV, ETag" always;
    }
}
```

> **CORS 说明**：Obsidian 是 Electron 应用，发请求前先发 `OPTIONS` 预检。预检不带 `Authorization` 头，所以要在 `location` 块内用 `if ($request_method = OPTIONS)` 提前返回 204 并带上 CORS 头。`auth_basic` 和 CORS `add_header` 都要写在 `location` 块内，不能写在 `server` 块（`auth_basic` 在 server 块会对 `OPTIONS` 也生效导致 401；`add_header` 在 server 块会被 location 块的 `add_header` 覆盖）。

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/webdav /etc/nginx/sites-enabled/
sudo nginx -t                     # 测试配置
sudo systemctl reload nginx       # 重载生效
```

#### 第7步：防火墙设置

```bash
# 如果使用 ufw
sudo ufw allow 443/tcp
sudo ufw reload
```

#### 第8步：验证 WebDAV 可访问

```bash
# 在本机测试
curl -u webdav:你的密码 -X PROPFIND http://127.0.0.1:8008/ -H "Depth: 1"

# 从外网测试
curl -u webdav:你的密码 -X PROPFIND https://your-domain.com/ -H "Depth: 1"
```

如果返回 XML 格式的目录列表，说明搭建成功。

### 小技巧

- **Let's Encrypt SSL**：`sudo apt install certbot python3-certbot-nginx -y && sudo certbot --nginx -d your-domain.com`
- **备份**：定期备份 `/var/www/webdav/data/` 目录即可
- **监控**：`journalctl -u wsgidav -f` 实时查看 wsgidav 日志
- **修改密码**：`sudo htpasswd /etc/nginx/.htpasswd webdav`（不需要 `-c`）

---

## 二、插件架构

```
obsidian-webdav-sync/
├── manifest.json              # 插件元数据 (id, name, version, minAppVersion)
├── package.json               # 依赖 (obsidian 类型, esbuild 等)
├── tsconfig.json              # TypeScript 配置
├── esbuild.config.mjs         # 构建配置
├── version-bump.mjs           # 版本管理
├── .gitignore
├── main.ts                    # 插件入口, Plugin 类
├── src/
│   ├── types.ts               # 公共类型定义
│   ├── utils.ts               # 工具函数 (XML 解析, 哈希计算)
│   ├── webdav-client.ts       # WebDAV HTTP 客户端 (PROPFIND/GET/PUT/DELETE/MKCOL)
│   ├── file-tracker.ts        # 文件状态跟踪 (hash + mtime)
│   ├── sync-engine.ts         # 核心同步逻辑 (扫描→对比→执行)
│   ├── conflict-resolver.ts   # 冲突检测与处理
│   └── settings.ts            # 设置界面 SettingTab
└── styles.css                 # 设置界面样式
```

### 模块职责

| 模块 | 职责 | 关键方法 |
|------|------|----------|
| `types.ts` | 所有类型定义 | SyncSettings, FileState, SyncAction, WebdavFileInfo |
| `utils.ts` | XML PROPFIND 响应解析、SHA-256 计算、路径规范化 | `parsePropfindResponse()`, `computeHash()`, `normalizePath()` |
| `webdav-client.ts` | WebDAV 协议封装 | `list()`, `download()`, `upload()`, `delete()`, `createDirectory()`, `move()` |
| `file-tracker.ts` | 本地文件状态持久化（JSON 文件） | `load()`, `save()`, `getChangedFiles()`—对比本地 vs 远程 |
| `conflict-resolver.ts` | 按 mtime 判断新旧、执行重命名备份 | `resolve(本地文件, 远程文件)` → 返回处理后的 SyncAction |
| `sync-engine.ts` | 编排同步流程 | `sync()`: scanLocal → listRemote → compare → resolve → execute |
| `settings.ts` | 设置界面 UI | WebDAV 连接信息、触发方式、过滤规则、同步状态 |
| `main.ts` | 插件生命周期 | 注册设置/命令/事件、管理定时器、启动/中止同步 |

### 数据流

```
sync-engine.sync()
    │
    ├─ 1. scanLocal()          → 遍历 vault, 获取文件路径 + mtime + hash
    ├─ 2. webdavClient.list()  → PROPFIND 递归列出远程文件 + mtime + ETag
    ├─ 3. fileTracker.compare()
    │       ┌─────────┬──────────┬──────────┬──────────┐
    │       │ 本地存在 │ 本地无   │ 本变更远未变 │ 双方都变 │
    │       ├─────────┼──────────┼──────────┼──────────┤
    │       │ pending  │ pending  │ synced   │ conflict │
    │       │ _upload  │ _download│          │          │
    │       └─────────┴──────────┴──────────┴──────────┘
    ├─ 4. conflictResolver.resolve(conflictList)
    │       → 新旧判断: 新文件保留原名, 旧文件改名备份
    ├─ 5. executeActions(actionList)
    │       → 先创建目录 → 再传/下载 → 最后删除
    └─ 6. fileTracker.save()   → 持久化状态
```

### 同步触发机制

- **手动**：注册命令 `sync-now`，Obsidian 命令面板调用
- **保存时**：监听 `vault.on('modify')`，防抖后单文件同步
- **定时**：插件 onload 时 `setInterval`，设置中可配置间隔
- **启动时**：`onload()` 中延迟 5 秒自动触发

### 冲突处理

```
对比双方 mtime:
  新的 → 保留原名, 直接同步
  旧的 → 改名: filename.YYYY-MM-DD_HHmmss.ext
```

- 上传冲突：远程旧文件 MOVE 改名 → PUT 本地文件
- 下载冲突：本地旧文件 rename → GET 远程文件

### 状态持久化

存储在 `<vault>/.obsidian/plugins/webdav-sync/file-states.json`：

```json
[
  {
    "path": "notes/daily.md",
    "localMtime": 1719823200000,
    "localHash": "a1b2c3d4e5f6g7h8",
    "remoteMtime": 1719823100000,
    "remoteHash": "\"abc123\"",
    "status": "synced"
  }
]
```

### 文件过滤

- 始终排除：`.obsidian/` 目录
- 用户可配置包含/排除 glob 模式（每行一个）
- 默认包含所有文件（`**`）

---

## 三、依赖与构建

- **运行时依赖**: 无（全部使用原生 `fetch` + `crypto.subtle` + `DOMParser`）
- **开发依赖**: `obsidian` (类型定义), `esbuild`, `typescript`, `@types/node`
- **构建**: `npm run build` → esbuild 输出 `main.js` + `manifest.json`
- **输出**: 单一 `main.js`（Obsidian 插件加载方式）

---

## 四、实现步骤

| # | 内容 | 文件 |
|---|------|------|
| 1 | 初始化项目: package.json, manifest.json, tsconfig, esbuild, .gitignore | 项目根 |
| 2 | 公共类型 + 工具函数 | `src/types.ts`, `src/utils.ts` |
| 3 | WebDAV 客户端（HTTP 封装） | `src/webdav-client.ts` |
| 4 | 文件状态跟踪器 | `src/file-tracker.ts` |
| 5 | 冲突处理器 | `src/conflict-resolver.ts` |
| 6 | 同步引擎（编排核心流程） | `src/sync-engine.ts` |
| 7 | 设置界面 UI | `src/settings.ts` |
| 8 | 插件入口（集成所有模块） | `main.ts` |
| 9 | 设置样式 | `styles.css` |
| 10 | 编译测试 | `npm run build` |

---

## 五、验证方式

1. **构建验证**: `npm run build` 成功输出 `main.js` + `manifest.json`
2. **本地测试**: 在本地启动临时 wsgidav 实例，配置插件连接，测试 CRUD 操作
3. **场景测试**:
   - 创建文件 → 同步 → 远程可见
   - 远程修改 → 同步 → 本地更新
   - 双方同时修改 → 冲突 → 新文件覆盖 + 旧文件备份
   - 删除文件 → 同步 → 远程同步删除
   - 启动时 / 保存时 / 定时 / 手动 四种触发方式分别生效
