# 导出旧 Cloudflare D1 数据库（v3 → v4 迁移第 1 步）

本步骤在**你自己的 Windows 电脑**上执行，需要你本机已登录 Cloudflare 的 `wrangler`。
脚本无法替你登录（需要浏览器授权），请按下面操作。

## 1. 安装/确认 wrangler

```powershell
npm install -g wrangler
wrangler --version
```

如提示未安装 Node：先到 https://nodejs.org 装 Node 20+（LTS 即可）。

## 2. 登录 Cloudflare

```powershell
wrangler login
```

会自动打开浏览器 → 选择你的账号 → 授权。成功后终端显示 `Successfully logged in.`。

> 如果是在无浏览器的机器上，改用 API Token：
> 浏览器登录 Cloudflare 控制台 → 右上头像 → My Profile → API Tokens → Create Token → 选「Edit Cloudflare Workers」模板 → 拿到 token 后：
> ```powershell
> $env:CLOUDFLARE_API_TOKEN="你的token"
> ```

## 3. 执行导出（推荐直接用封装脚本）

在项目根目录（`F:\DESKTOP\班级积分系统`）打开 PowerShell：

```powershell
.\scripts\export-old-d1.ps1
```

等价的手动命令是：

```powershell
npx wrangler d1 export class-points-db --output=scripts/tmp/old.sql
```

> 旧库信息（已写死在脚本里）：database_name = `class-points-db`，id = `3cfcd4c1-9932-4eba-a5c2-8004488c9521`。

导出完成后应看到 `scripts\tmp\old.sql`，文件大小一般几百 KB 到几 MB。

## 4. 常见报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `command not found: wrangler` / 无法识别 | 未装/未重开终端 | `npm i -g wrangler` 后**关闭并重开 PowerShell** |
| `Authentication error [10000]` / 未登录 | 登录态失效 | 重新 `wrangler login` |
| `D1_ERROR: No such database` | 库名不对/选错账号 | 确认登录的是原账号；`wrangler d1 list` 核对 |
| 导出文件 0 字节或全是注释 | 网络中断 | 重跑一次；或用下面的手动导出备选 |

## 5. 手动导出备选（需要 Remote 凭据时）

```powershell
# 确认能列出旧库
wrangler d1 list

# 导出（--remote 明确指向线上数据）
wrangler d1 export class-points-db --remote --output=scripts/tmp/old.sql
```

## 6. 下一步

导出完成后，执行迁移：

```powershell
node scripts/migrate.mjs --input=scripts/tmp/old.sql --out-db=data/app.db --out-d1=scripts/tmp/new-d1.sql
node scripts/verify-migration.mjs --old=scripts/tmp/old.sql --new-db=data/app.db
```

详见 `scripts/migrate-r2.md`（R2 附件/备份迁移）与 `deploy/README-node.md`、`deploy/README-cloudflare.md`。
