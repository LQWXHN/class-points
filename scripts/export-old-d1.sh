#!/usr/bin/env bash
# 导出旧 D1 库到 scripts/tmp/old.sql（家里 Linux 主站也可用）
# 用法：bash scripts/export-old-d1.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmpDir="$root/scripts/tmp"
mkdir -p "$tmpDir"
out="$tmpDir/old.sql"

if ! command -v wrangler >/dev/null 2>&1; then
  if command -v npx >/dev/null 2>&1; then
    echo "[提示] 未全局安装 wrangler，改用 npx wrangler（首次会下载）..."
    exec npx wrangler d1 export class-points-db --remote --output="$out"
  else
    echo "[错误] 未找到 wrangler / npx。请先安装：npm install -g wrangler" >&2
    exit 1
  fi
fi

echo "[检查] wrangler 登录态..."
if ! wrangler whoami >/dev/null 2>&1; then
  echo "[错误] wrangler 未登录。请先执行：wrangler login（浏览器授权）" >&2
  echo "       或设置 API Token：export CLOUDFLARE_API_TOKEN=你的token" >&2
  exit 1
fi

echo "[导出] class-points-db -> $out"
wrangler d1 export class-points-db --remote --output="$out"

if [ ! -s "$out" ] || [ "$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")" -lt 100 ]; then
  echo "[错误] 导出文件为空或异常小，请手动重跑" >&2
  exit 1
fi
echo "[完成] $out ($(du -h "$out" | cut -f1))"
echo "下一步：node scripts/migrate.mjs --input=scripts/tmp/old.sql --out-db=data/app.db --out-d1=scripts/tmp/new-d1.sql"
