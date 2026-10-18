#!/usr/bin/env bash
# ============================================================
# 家里主站一键初始化（幂等）
# 用法：sudo bash deploy/setup-node.sh
# 注意：需要写 /etc/caddy、/etc/systemd 的步骤只打印提示，不擅自执行
# ============================================================
set -euo pipefail

# ---- 可调变量（集中顶部） ----
APP_DIR="/opt/class-points"
SERVICE_NAME="class-points"
DOMAIN="points.example.com"
PORT="8787"
RUN_USER="www-data"

cd "$APP_DIR"

echo "==> [1/5] 检查 Node 20+"
if ! command -v node >/dev/null 2>&1; then
  echo "    Node 未安装。请先："
  echo "      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "    Node 版本过低：$(node -v)，需要 v20+" >&2; exit 1
fi
echo "    node $(node -v) npm $(npm -v)"

echo "==> [2/5] 安装 app 依赖（仅生产依赖，wrangler 是 devDependency 主站不需要）"
cd "$APP_DIR/app"
npm ci --omit=dev || npm install --omit=dev

echo "==> [3/5] 准备 data 目录"
mkdir -p "$APP_DIR/data/uploads" "$APP_DIR/data/backups"
[ -f "$APP_DIR/data/config.json" ] || cat > "$APP_DIR/data/config.json" <<EOF
{
  "PORT": $PORT,
  "SYNC_SECRET": "$(openssl rand -hex 32)",
  "CF_PEER_URL": "https://points1.example.com"
}
EOF
echo "    config.json 已就绪（请核对 SYNC_SECRET 与 CF 备用站一致）"

echo "==> [4/5] systemd 单元（需 sudo 写入 /etc/systemd，此处只打印）"
cat <<EOF

    需要你手动执行（要 root 写系统目录，脚本不擅自做）：
      sudo cp $APP_DIR/deploy/class-points.service /etc/systemd/system/
      sudo systemctl daemon-reload
      sudo systemctl enable --now $SERVICE_NAME
      sudo systemctl status $SERVICE_NAME

EOF

echo "==> [5/5] Caddy（可选；用 cloudflared tunnel 可跳过）"
cat <<EOF
    若用端口转发方案：
      sudo apt install -y caddy
      sudo cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
      sudo caddy validate --config /etc/caddy/Caddyfile
      sudo systemctl reload caddy
    若用 cloudflared tunnel：无需 Caddy，见 deploy/README-networking.md (b)
EOF

echo "==> 完成。下一步："
echo "    1) 导入迁移数据（见 deploy/README-node.md 第 6 步）"
echo "    2) systemctl enable --now $SERVICE_NAME"
echo "    3) journalctl -u $SERVICE_NAME -f"
