#!/usr/bin/env bash
# ============================================================
# Cloudflare 备用站一键部署（幂等）
# 用法：bash deploy/deploy-cf.sh
# ============================================================
set -euo pipefail

# ---- 可调变量 ----
DBNAME="class-points-db-v4"
NEW_D1_SQL="scripts/tmp/new-d1.sql"

cd "$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/6] 检查 wrangler 登录态"
if ! command -v wrangler >/dev/null 2>&1; then
  echo "    未安装 wrangler。请：npm i -g wrangler && wrangler login" >&2; exit 1
fi
if ! wrangler whoami >/dev/null 2>&1; then
  echo "    wrangler 未登录。请：wrangler login" >&2; exit 1
fi

echo "==> [2/6] 检查 D1 库（若 wrangler.toml 里 database_id 为空则建库）"
if grep -q 'database_id = ""' app/wrangler.toml; then
  echo "    wrangler.toml 中 database_id 为空，正在建库..."
  wrangler d1 create "$DBNAME"
  cat <<EOF

    ^^^^ 把上面输出的 database_id 回填到 app/wrangler.toml 的空字符串处，再重跑本脚本。
EOF
  exit 0
fi
echo "    database_id 已配置"

echo "==> [3/6] 导入新 D1 SQL（wrangler.toml 在 app/ 下，先 cd 进去）"
if [ -f "$NEW_D1_SQL" ]; then
  (cd app && wrangler d1 execute "$DBNAME" --remote --file="../$NEW_D1_SQL")
else
  echo "    未找到 $NEW_D1_SQL，跳过导入（首次部署必须先跑 scripts/migrate.mjs）" >&2
fi

echo "==> [4/6] R2 桶（沿用 class-points-backup）"
wrangler r2 bucket list | grep -q class-points-backup || wrangler r2 bucket create class-points-backup

echo "==> [5/6] SYNC_SECRET（与家里主站 config.json 一致）"
cat <<EOF
    若还没设置过：
      cd app && wrangler secret put SYNC_SECRET
    生成命令：openssl rand -hex 32
EOF

echo "==> [6/6] 部署 Worker"
cd app
wrangler deploy
echo "==> 完成。"
