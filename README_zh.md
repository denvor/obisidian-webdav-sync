> 中文 | [**English**](README.md)

# Obsidian WebDAV Sync

将 Obsidian vault 文件与自建 WebDAV 服务器进行**双向同步**的 Obsidian 插件。

## 什么是 Obsidian Vault

Obsidian **Vault**（仓库）是一个文件夹，里面放你的所有 Markdown 笔记文件。这是 Obsidian 管理笔记的基本单元。

**如何找到你的 Vault 位置：**

1. 打开 Obsidian，点击左下角的 **齿轮图标**（设置）
2. 在左侧菜单选择 → **关于**（About）
3. 点击 **Vault 位置** 一栏的路径（打开文件夹图标即可看到完整路径）

或者直接在 Obsidian 窗口左上角悬停你的 Vault 名称，会弹出完整路径。

默认路径示例：
- Windows: `C:\Users\你的用户名\Documents\Obsidian Vault`
- macOS: `~/Documents/Obsidian Vault/`
- Linux: `~/Documents/Obsidian Vault/`

插件安装时，`manifest.json`、`main.js`、`styles.css` 三个文件需要放到 vault 目录下的 `.obsidian/plugins/obsidian-webdav-sync/` 文件夹中。

## 功能

- **双向同步** — 本地 ↔ 远程，自动对比文件变更
- **多种触发方式** — 手动 / 保存时 / 定时 / 启动时，可多选互不冲突
- **冲突处理** — 双方同时修改时，新文件保留原名，旧文件自动备份加时间戳
- **同步方向控制** — 双向 / 仅上传 / 仅下载
- **文件过滤** — 支持包含/排除 glob 模式，始终排除 `.obsidian/` 目录
- **SHA-256 哈希对比** — 基于文件内容哈希 + 修改时间双重判断，避免误判
- **状态持久化** — 同步状态写入 JSON 文件，重启后仍可追踪
- **零运行时依赖** — 使用 Obsidian Electron 内置的 `fetch`、`crypto.subtle`、`DOMParser`，无需安装第三方包

## 架构

```
Obsidian vault
      │
      ├─ main.ts                 插件入口
      │
      ├─ src/
      │   ├─ webdav-client.ts    WebDAV HTTP 客户端
      │   ├─ file-tracker.ts     文件状态跟踪与持久化
      │   ├─ sync-engine.ts      同步流程编排
      │   ├─ conflict-resolver.ts 冲突检测与备份
      │   ├─ settings.ts         设置界面 UI
      │   ├─ types.ts            类型定义
      │   └─ utils.ts            工具函数
      │
      └─ 同步到 → HTTPS :443 → Nginx (SSL + Basic Auth) → wsgidav :8008
```

同步流程：

```
scanLocal() → listRemote() → compare() → resolveConflicts() → executeActions() → updateStates()
     │              │             │              │                   │                │
  遍历vault      PROPFIND      对比hash      按mtime判断        上传/下载/      持久化状态
  计算mtime+     递归列出      和mtime       新旧，旧文件        删除/重命名      + PROPFIND
  SHA-256       远程文件                     改名备份                          刷新ETag
```

## 安装

### 1. 安装插件

1. 在 Obsidian 设置 → 第三方插件 → 关闭安全模式
2. 将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 下的 `.obsidian/plugins/obsidian-webdav-sync/`
3. 在已安装插件列表中启用 **WebDAV Sync**

### 2. 配置插件

在插件设置中填写：

| 字段 | 说明 |
|------|------|
| **WebDAV URL** | 服务器地址，如 `https://webdav.example.com/` |
| **用户名** | Basic Auth 用户名 |
| **密码** | Basic Auth 密码 |

点击 **测试连接** 验证配置正确后，点击 **立即同步** 开始同步。

## 触发方式

| 方式 | 说明 |
|------|------|
| **手动** | 命令面板 → "Sync with WebDAV"，或设置页的"立即同步"按钮 |
| **保存时** | 文件保存后 1 秒自动触发（防抖） |
| **定时** | 可配置间隔（分钟） |
| **启动时** | Obsidian 启动 5 秒后自动触发 |

可在设置中任意组合开启。

## 冲突处理

当同一文件在本地和远程都被修改时：

1. 比较双方的修改时间
2. **较新的文件**保留原名，直接同步
3. **较旧的文件**重命名备份：`filename.YYYY-MM-DD_HHmmss.ext`
4. 上传冲突：远程旧文件 MOVE 改名 → PUT 本地新文件
5. 下载冲突：本地旧文件 rename → GET 远程新文件

## 文件过滤

- `.obsidian/` **始终排除**
- 可配置包含模式（仅同步匹配的文件）
- 可配置排除模式（跳过指定文件/目录）
- 支持 glob 模式：`*`、`**`、`?`、`{a,b}`

## 构建

```bash
npm run build    # 构建出 main.js
npm run dev      # 开发模式，监听文件变更
```

## 技术细节

- **状态文件**：存储在 `.obsidian/plugins/obsidian-webdav-sync/file-states.json`
- **日志文件**：存储在 `.obsidian/plugins/obsidian-webdav-sync/sync.log`
- **哈希算法**：SHA-256 前 16 位十六进制
- **远程文件标识**：使用 WebDAV 的 `ETag` 响应头
- **WebDAV 方法**：PROPFIND / GET / PUT / DELETE / MKCOL / MOVE

## License

MIT

---

## 附录：部署 WebDAV 服务器

推荐使用 **wsgidav + Nginx** 反向代理架构：

```
外网 ── HTTPS :443 ──→ Nginx (SSL + Basic Auth) ──反向代理──→ wsgidav :8008
                                                                │
                                                          /var/www/webdav/data/
```

> **为什么不用 Nginx DAV 模块？** Nginx 内置的 `ngx_http_dav_module` 不支持 `PROPFIND`（列目录），而插件需要列出远程文件进行对比，所以需要完整的 WebDAV 实现。

### 1. 安装 wsgidav

```bash
# 安装 Python 3 + venv (Ubuntu 24 自带 Python 3.12)
sudo apt update
sudo apt install python3 python3-venv -y

# 创建虚拟环境
sudo mkdir -p /opt/webdav
sudo python3 -m venv /opt/webdav/venv
sudo /opt/webdav/venv/bin/pip install wsgidav cheroot
```

### 2. 创建数据目录和用户

```bash
sudo mkdir -p /var/www/webdav/data
sudo useradd -r -s /usr/sbin/nologin -d /var/www/webdav webdav
sudo chown -R webdav:webdav /var/www/webdav
sudo chown -R root:root /opt/webdav
sudo chmod -R 755 /opt/webdav
```

### 3. 配置 wsgidav

创建 `/etc/webdav/config.yaml`：

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

> wsgidav 4.x 默认启用自己的 Basic Auth。通过以上配置放行所有请求，认证全部交给上游 Nginx。

### 4. 创建 systemd 服务

创建 `/etc/systemd/system/wsgidav.service`：

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
sudo systemctl status wsgidav
```

### 5. 配置 Basic Auth 用户

```bash
sudo apt install apache2-utils -y
sudo htpasswd -c /etc/nginx/.htpasswd webdav
```

### 6. 配置 Nginx 反向代理

参考项目根目录的 [`webdav.conf.sample`](webdav.conf.sample)。

**Step A：在 `/etc/nginx/nginx.conf` 的 `http {}` 块内添加：**

```nginx
log_format full '$remote_addr - $remote_user [$time_local] '
                '"$request" $status $body_bytes_sent '
                '"$http_referer" "$http_user_agent" '
                'origin="$http_origin"';

limit_req_zone $binary_remote_addr zone=webdav:10m rate=10r/s;

map $http_origin $cors_origin {
    default "";
    "~^app://obsidian\.md$" $http_origin;
}
```

**Step B：创建 `/etc/nginx/conf.d/webdav.conf`：**

```nginx
server {
    listen 443 ssl;
    server_name webdav.example.com;       # 改为你的域名

    ssl_certificate     /etc/letsencrypt/live/webdav.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webdav.example.com/privkey.pem;

    access_log /var/log/nginx/webdav.example.com.log full;
    limit_req zone=webdav burst=20 nodelay;

    location / {
        # CORS 预检
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Access-Control-Allow-Credentials "true" always;
            add_header Access-Control-Allow-Methods "GET, PUT, POST, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Depth, Content-Type, Destination, Overwrite, If" always;
            add_header Access-Control-Expose-Headers "DAV, ETag" always;
            add_header Content-Length 0 always;
            add_header Content-Type text/plain always;
            return 204;
        }

        auth_basic "WebDAV";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 0;           # 不限制上传大小（或改为 50m）
        proxy_request_buffering off;

        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;

        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, PUT, POST, DELETE, PROPFIND, MKCOL, MOVE, COPY, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Depth, Content-Type, Destination, Overwrite, If" always;
        add_header Access-Control-Expose-Headers "DAV, ETag" always;
        add_header X-Content-Type-Options nosniff always;
    }
}
```

```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/webdav /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. SSL 证书（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d webdav.example.com
```

### 8. 验证

```bash
# 从外网测试
curl -u webdav:你的密码 -X PROPFIND https://webdav.example.com/ -H "Depth: 1"
```

返回 XML 格式的目录列表即部署成功。

### 9. 防火墙

```bash
sudo ufw allow 443/tcp
sudo ufw reload
```
