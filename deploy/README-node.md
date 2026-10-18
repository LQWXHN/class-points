# 家里 Linux 主站部署（Node + systemd + Caddy）

> 面向对象：能照抄命令的老师/运维。目标机：家里一台常开 Linux（Debian/Ubuntu 均可）。
> 部署后域名：https://points.example.com → 本机 127.0.0.1:8787。

---

## 0. 前置条件

- Ubuntu 22.04 / Debian 12 或更新。
- 已装 `git`、`curl`。
- 组网方式二选一（详见 `README-networking.md`）：
  - (a) 路由器有公网 IP：做 80/443 端口转发 + DDNS；
  - (b) 无公网 IP：装 cloudflared tunnel（推荐，省心）。

## 1. 安装 Node 20

二选一：

**方式 A：NodeSource 仓库（推荐）**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应输出 v20.x
```

**方式 B：nvm（用户态，不装系统包）**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 重开终端后：
nvm install 20
nvm use 20
node -v
```

## 2. 放置代码

把整个项目放到 `/opt/class-points`（属主用一个普通用户，不要用 root）：

```bash
sudo mkdir -p /opt/class-points
sudo chown -R $USER:$USER /opt/class-points
# 假设你已经把项目 scp / git clone 到了某处，复制过来：
cp -r ./班级积分系统/* /opt/class-points/
cd /opt/class-points
```

目录结构应包含：

```
/opt/class-points/
  app/        # 后端（node.js + worker.js）
  web/        # 静态前端
  scripts/    # 迁移脚本
  deploy/     # 本文档、systemd、Caddyfile
  data/       # 运行时数据（自动建）
```

## 3. 安装依赖

```bash
cd /opt/class-points/app
npm ci --omit=dev    # 或 npm install --omit=dev
```

> 主站不需要 `wrangler`——它只是 `app` 的 devDependency，只有部署 Cloudflare 备用站的机器才装 dev 依赖。家里主站只装生产依赖（hono、@hono/node-server、better-sqlite3）。

## 4. 准备数据目录

```bash
mkdir -p /opt/class-points/data/uploads /opt/class-points/data/backups
```

## 5. 配置文件 `data/config.json`

```bash
cat > /opt/class-points/data/config.json <<'EOF'
{
  "PORT": 8787,
  "SYNC_SECRET": "把这里换成和 CF 备用站相同的强随机串",
  "CF_PEER_URL": "https://points1.example.com"
}
EOF
```

生成强随机串（两边用同一个）：

```bash
openssl rand -hex 32
```

> 主站每 60 秒主动与 CF 备用站双向同步（CF 无法主动连家里）。
> 时钟要求：本机用 systemd-timesyncd/chrony 对互联网时间。

## 6. 导入迁移数据（首次）

```bash
# 0) 先装迁移脚本自身依赖（migrate.mjs 会 import better-sqlite3，从 scripts/ 目录解析 node_modules）
cd /opt/class-points/scripts && npm ci --omit=dev || npm install --omit=dev
cd /opt/class-points

# 1) 先把旧库导出的 scripts/tmp/old.sql 拷到本机（见 scripts/export-old-d1.md）
node scripts/migrate.mjs --input=scripts/tmp/old.sql \
  --out-db=/opt/class-points/data/app.db \
  --out-d1=/opt/class-points/scripts/tmp/new-d1.sql

# 2) 核对（应全 ✅）
node scripts/verify-migration.mjs --old=scripts/tmp/old.sql --new-db=/opt/class-points/data/app.db
```

> `new-d1.sql` **自带建表 DDL**（CREATE TABLE IF NOT EXISTS），必须在 `systemctl start` 主站、或在 CF 备用站 `wrangler deploy` 之前导入对应库。Worker/Node 运行期不会自动建表，空库直接起服务会报表不存在。

## 7. systemd 服务

复制 unit 文件并启用：

```bash
sudo cp /opt/class-points/deploy/class-points.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now class-points
sudo systemctl status class-points
```

日志查看：

```bash
journalctl -u class-points -f          # 实时
journalctl -u class-points --since today  # 今天
```

## 8. Caddy 反代（自动 HTTPS）

```bash
# 装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# 替换配置（域名 points.example.com 已解析到本机/DDNS）
sudo cp /opt/class-points/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

> 若你用 cloudflared tunnel（无公网 IP），**可以跳过 Caddy**，见 `README-networking.md` 第 (b) 节——tunnel 直接把域名指到 127.0.0.1:8787，证书由 Cloudflare 边缘处理。

## 9. 防火墙

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

> 8787 端口**不要**对外开——只监听 127.0.0.1，由 Caddy/tunnel 转发。

## 10. 开机自启确认

```bash
sudo systemctl is-enabled class-points   # 应为 enabled
sudo systemctl is-enabled caddy          # 应为 enabled（若用了 Caddy）
```

## 11. 更新代码流程

```bash
cd /opt/class-points
# 拉新代码 / 覆盖 app/ web/
cd app && npm ci --omit=dev
sudo systemctl restart class-points
journalctl -u class-points -f --lines 50
```

## 12. 备份建议

- 每天打包 `data/`（含 app.db、uploads/、backups/）：

```bash
tar czf /opt/class-points/backup-$(date +%F).tar.gz -C /opt/class-points data
```

- 保留最近 14 天，异机/网盘各留一份。
- 系统本身的自动备份功能（后台「数据备份」页）会写到 `data/backups/`。
