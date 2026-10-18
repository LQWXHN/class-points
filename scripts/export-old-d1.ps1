# 导出旧 D1 库到 scripts/tmp/old.sql（Windows PowerShell）
# 用法：在项目根目录执行  .\scripts\export-old-d1.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$tmpDir = Join-Path $root 'scripts\tmp'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$out = Join-Path $tmpDir 'old.sql'

# 1) 检测 wrangler
$wr = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wr) {
  $npx = Get-Command npx -ErrorAction SilentlyContinue
  if (-not $npx) {
    Write-Host '[错误] 未找到 wrangler / npx。请先安装：npm install -g wrangler' -ForegroundColor Red
    exit 1
  }
  Write-Host '[提示] 未全局安装 wrangler，改用 npx wrangler（首次会下载，稍候）...' -ForegroundColor Yellow
  & npx wrangler d1 export class-points-db --remote --output=$out
  exit $LASTEXITCODE
}

# 2) 检测登录态（无浏览器环境下会直接报错）
Write-Host '[检查] wrangler 登录态...' -ForegroundColor Cyan
& wrangler whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[错误] wrangler 未登录。请先执行：wrangler login（浏览器授权）' -ForegroundColor Red
  Write-Host '       或设置 API Token：$env:CLOUDFLARE_API_TOKEN="你的token"' -ForegroundColor Yellow
  exit 1
}

# 3) 执行导出
Write-Host "[导出] class-points-db -> $out" -ForegroundColor Cyan
& wrangler d1 export class-points-db --remote --output=$out
if ($LASTEXITCODE -ne 0) {
  Write-Host '[错误] 导出失败，见上方报错。手动步骤见 scripts/export-old-d1.md' -ForegroundColor Red
  exit 1
}
if ((-not (Test-Path $out)) -or ((Get-Item $out).Length -lt 100)) {
  Write-Host '[错误] 导出文件为空或异常小，请手动重跑：wrangler d1 export class-points-db --remote --output=scripts/tmp/old.sql' -ForegroundColor Red
  exit 1
}
Write-Host "[完成] $out（$([math]::Round((Get-Item $out).Length/1KB,1)) KB）" -ForegroundColor Green
Write-Host '下一步：node scripts/migrate.mjs --input=scripts/tmp/old.sql --out-db=data/app.db --out-d1=scripts/tmp/new-d1.sql' -ForegroundColor Green
