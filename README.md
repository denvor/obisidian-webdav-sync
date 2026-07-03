> [**中文**](README_zh.md) | English

# Obsidian WebDAV Sync

An Obsidian plugin for **bidirectional sync** between your vault and a self-hosted WebDAV server.

## What is an Obsidian Vault

An Obsidian **Vault** is simply a folder on your computer that holds all your Markdown note files. It's the basic unit of organization in Obsidian.

**How to find your Vault location:**

1. Open Obsidian, click the **gear icon** (Settings) in the bottom-left corner
2. Navigate to → **About**
3. Click the path under **Vault location** (the folder icon opens the full path)

Or hover over your vault name in the top-left corner of the Obsidian window.

Default paths by platform:
- Windows: `C:\Users\YourName\Documents\Obsidian Vault`
- macOS: `~/Documents/Obsidian Vault/`
- Linux: `~/Documents/Obsidian Vault/`

To install the plugin, copy `manifest.json`, `main.js`, and `styles.css` to `.obsidian/plugins/obsidian-webdav-sync/` inside your vault directory.

## Features

- **Bidirectional sync** — local ↔ remote, automatic change detection
- **Multiple triggers** — manual / on-save / scheduled / on-startup, combinable
- **Conflict resolution** — when both sides change, the newer file wins and the older one is backed up with a timestamp
- **Sync direction control** — bidirectional / upload only / download only
- **File filtering** — include/exclude glob patterns, always ignores `.obsidian/`
- **SHA-256 hash comparison** — double verification with content hash + modification time
- **State persistence** — sync state saved to JSON file, survives restarts
- **Zero runtime dependencies** — uses Obsidian Electron's built-in `fetch`, `crypto.subtle`, and `DOMParser`

## Architecture

```
Obsidian vault
      │
      ├─ main.ts                 Plugin entry point
      │
      ├─ src/
      │   ├─ webdav-client.ts    WebDAV HTTP client
      │   ├─ file-tracker.ts     File state tracking & persistence
      │   ├─ sync-engine.ts      Sync workflow orchestration
      │   ├─ conflict-resolver.ts Conflict detection & backup
      │   ├─ settings.ts         Settings UI
      │   ├─ types.ts            Type definitions
      │   └─ utils.ts            Utility functions
      │
      └─ syncs to → HTTPS :443 → Nginx (SSL + Basic Auth) → wsgidav :8008
```

Sync flow:

```
scanLocal() → listRemote() → compare() → resolveConflicts() → executeActions() → updateStates()
     │              │             │              │                   │                │
  walk vault     PROPFIND      compare       mtime-based         upload/         persist
  compute        recursive     hash +         backup old         download/       state +
  mtime +        list remote   mtime          file rename        delete/rename   PROPFIND
  SHA-256        files                                           MOVE            refresh ETag
```

## Installation

### 1. Install the Plugin

1. Open Obsidian Settings → Community plugins → Turn off Safe Mode
2. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/obsidian-webdav-sync/` inside your vault
3. Enable **WebDAV Sync** in the installed plugins list

### 2. Configure the Plugin

Fill in the plugin settings:

| Field | Description |
|-------|-------------|
| **WebDAV URL** | Server URL, e.g. `https://webdav.example.com/` |
| **Username** | Basic Auth username |
| **Password** | Basic Auth password |

Click **Test Connection** to verify, then click **Sync Now**.

## Sync Triggers

| Trigger | Description |
|---------|-------------|
| **Manual** | Command palette → "Sync with WebDAV", or the "Sync Now" button in settings |
| **On Save** | Auto-triggers 1 second after a file is saved (debounced) |
| **Scheduled** | Configurable interval in minutes |
| **On Startup** | Auto-triggers 5 seconds after Obsidian launches |

Any combination can be enabled in settings.

## Conflict Resolution

When a file is modified both locally and remotely:

1. Compare modification times
2. **Newer file** keeps its original name and syncs through
3. **Older file** is renamed with a timestamp backup: `filename.YYYY-MM-DD_HHmmss.ext`
4. Upload conflict: MOVE the remote old file → PUT the local new file
5. Download conflict: rename the local old file → GET the remote new file

## File Filtering

- `.obsidian/` **always excluded**
- Configurable include patterns (sync only matching files)
- Configurable exclude patterns (skip matching files/directories)
- Glob patterns: `*`, `**`, `?`, `{a,b}`

## Build

```bash
npm run build    # Build main.js
npm run dev      # Watch mode, auto-rebuild on changes
```

## Technical Details

- **State file**: stored at `.obsidian/plugins/obsidian-webdav-sync/file-states.json`
- **Log file**: stored at `.obsidian/plugins/obsidian-webdav-sync/sync.log`
- **Hash algorithm**: SHA-256, first 16 hex characters
- **Remote file identity**: WebDAV `ETag` response header
- **WebDAV methods**: PROPFIND / GET / PUT / DELETE / MKCOL / MOVE

## License

MIT

---

## Appendix: Deploying a WebDAV Server

The recommended setup uses **wsgidav + Nginx** reverse proxy:

```
Internet ── HTTPS :443 ──→ Nginx (SSL + Basic Auth) ──reverse proxy──→ wsgidav :8008
                                                                          │
                                                                    /var/www/webdav/data/
```

> **Why not Nginx's built-in DAV module?** Nginx's `ngx_http_dav_module` does not support `PROPFIND` (listing directories), which the plugin needs to compare remote files. A full WebDAV implementation is required.

### 1. Install wsgidav

```bash
# Install Python 3 + venv (Ubuntu 24 ships with Python 3.12)
sudo apt update
sudo apt install python3 python3-venv -y

# Create a virtual environment
sudo mkdir -p /opt/webdav
sudo python3 -m venv /opt/webdav/venv
sudo /opt/webdav/venv/bin/pip install wsgidav cheroot
```

### 2. Create Data Directory and User

```bash
sudo mkdir -p /var/www/webdav/data
sudo useradd -r -s /usr/sbin/nologin -d /var/www/webdav webdav
sudo chown -R webdav:webdav /var/www/webdav
sudo chown -R root:root /opt/webdav
sudo chmod -R 755 /opt/webdav
```

### 3. Configure wsgidav

Create `/etc/webdav/config.yaml`:

```yaml
host: "127.0.0.1"        # Listen locally only, proxied through Nginx
port: 8008

provider_mapping:
  "/": "/var/www/webdav/data"

# Disable built-in auth (handled by Nginx Basic Auth)
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

> wsgidav 4.x enables its own Basic Auth by default. The config above lets all requests through, delegating authentication entirely to Nginx.

### 4. Create systemd Service

Create `/etc/systemd/system/wsgidav.service`:

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

### 5. Set Up Basic Auth User

```bash
sudo apt install apache2-utils -y
sudo htpasswd -c /etc/nginx/.htpasswd webdav
```

### 6. Configure Nginx Reverse Proxy

See [`webdav.conf.sample`](webdav.conf.sample) in the project root.

**Step A: Add to the `http {}` block in `/etc/nginx/nginx.conf`:**

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

**Step B: Create `/etc/nginx/conf.d/webdav.conf`:**

```nginx
server {
    listen 443 ssl;
    server_name webdav.example.com;       # Change to your domain

    ssl_certificate     /etc/letsencrypt/live/webdav.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webdav.example.com/privkey.pem;

    access_log /var/log/nginx/webdav.example.com.log full;
    limit_req zone=webdav burst=20 nodelay;

    location / {
        # CORS preflight
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

        client_max_body_size 0;           # No upload limit (or set to 50m)
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
# Enable the site
sudo ln -s /etc/nginx/sites-available/webdav /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. SSL Certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d webdav.example.com
```

### 8. Verify

```bash
# Test from outside
curl -u webdav:your-password -X PROPFIND https://webdav.example.com/ -H "Depth: 1"
```

An XML directory listing means the server is working.

### 9. Firewall

```bash
sudo ufw allow 443/tcp
sudo ufw reload
```
