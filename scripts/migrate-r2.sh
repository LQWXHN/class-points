#!/usr/bin/env bash
# R2 批量下载脚本（家里 Linux 主站）
# 用法：
#   bash scripts/migrate-r2.sh download --bucket=class-points-backup --dest=data
#   bash scripts/migrate-r2.sh download --bucket=class-points-backup --dest=data --keys-file=scripts/tmp/r2-keys.txt
set -euo pipefail

mode="${1:-}"
bucket="class-points-backup"
dest="data"
keys_file=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --bucket=*) bucket="${1#*=}" ;;
    --dest=*) dest="${1#*=}" ;;
    --keys-file=*) keys_file="${1#*=}" ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ "$mode" != "download" ]; then echo "[错误] 目前只支持 download" >&2; exit 1; fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "[错误] 未找到 wrangler，请先 npm i -g wrangler" >&2; exit 1
fi
if ! wrangler whoami >/dev/null 2>&1; then
  echo "[错误] wrangler 未登录。请先：wrangler login（浏览器授权）" >&2; exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
destAbs="$root/$dest"
mkdir -p "$destAbs"

if [ -z "$keys_file" ]; then
  echo "[提示] 未提供 --keys-file。请先生成对象 key 列表（每行一个 key）：" >&2
  echo "  rclone lsf $bucket:uploads  > scripts/tmp/r2-keys.txt" >&2
  echo "  rclone lsf $bucket:backups >> scripts/tmp/r2-keys.txt" >&2
  echo "然后重跑：bash scripts/migrate-r2.sh download --bucket=$bucket --dest=$dest --keys-file=scripts/tmp/r2-keys.txt" >&2
  exit 2
fi

ok=0; fail=0
while IFS= read -r key; do
  key="$(echo "$key" | xargs)"
  [ -z "$key" ] && continue
  local="$destAbs/$key"
  mkdir -p "$(dirname "$local")"
  if wrangler r2 object get "$bucket/$key" --file="$local" >/dev/null 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "  ! 失败: $key" >&2
  fi
done < "$keys_file"
echo "[完成] 成功 $ok 失败 $fail"
