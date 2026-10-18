# R2 批量下载脚本（Windows PowerShell）
# 用法：
#   .\scripts\migrate-r2.ps1 download -Bucket class-points-backup -Dest data
#   .\scripts\migrate-r2.ps1 download -Bucket class-points-backup -Dest data -KeysFile scripts\tmp\r2-keys.txt
# 说明：wrangler 本身没有「按前缀列对象」的子命令。批量有两种方式：
#   A) 装 rclone（推荐）：rclone lsf 桶:前缀 生成 key 列表后喂给本脚本的 -KeysFile
#   B) 直接用 rclone copy 同步到目录（脚本会检测 rclone 并提示完整命令）
param(
  [Parameter(Mandatory=$true)][string]$Mode,        # download（目前只实现下载）
  [string]$Bucket = 'class-points-backup',
  [string]$Dest = 'data',
  [string]$KeysFile = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Mode -ne 'download') { Write-Host '[错误] 目前只支持 -Mode download' -ForegroundColor Red; exit 1 }

# 登录态检测
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
  Write-Host '[错误] 未找到 wrangler，请先 npm i -g wrangler' -ForegroundColor Red; exit 1
}
& wrangler whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[错误] wrangler 未登录。请先：wrangler login（浏览器授权）' -ForegroundColor Red; exit 1
}

$destAbs = Join-Path $root $Dest
New-Item -ItemType Directory -Force -Path $destAbs | Out-Null

# 无 keys 文件时：检测 rclone 并打印指引
if (-not $KeysFile) {
  Write-Host '[提示] 未提供 -KeysFile。请先生成对象 key 列表（每行一个 key，如 uploads/xxx.jpg）：' -ForegroundColor Yellow
  Write-Host '  rclone lsf '"$Bucket`:uploads  > scripts\tmp\r2-keys.txt' -ForegroundColor Yellow
  Write-Host '  rclone lsf '"$Bucket`:backups >> scripts\tmp\r2-keys.txt' -ForegroundColor Yellow
  Write-Host '然后重跑：' -ForegroundColor Yellow
  Write-Host "  .\scripts\migrate-r2.ps1 download -Bucket $Bucket -Dest $Dest -KeysFile scripts\tmp\r2-keys.txt" -ForegroundColor Yellow
  exit 2
}

$keys = Get-Content $KeysFile | Where-Object { $_.Trim() -ne '' }
Write-Host "[下载] $($keys.Count) 个对象 -> $destAbs" -ForegroundColor Cyan
$ok = 0; $fail = 0
foreach ($key in $keys) {
  $key = $key.Trim()
  $local = Join-Path $destAbs ($key -replace '/', '\')
  $localDir = Split-Path -Parent $local
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
  & wrangler r2 object get "$Bucket/$key" --file=$local 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $local)) { $ok++ } else { $fail++; Write-Host "  ! 失败: $key" -ForegroundColor Red }
}
Write-Host "[完成] 成功 $ok 失败 $fail" -ForegroundColor $(if ($fail -eq 0) {'Green'} else {'Red'})
