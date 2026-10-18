# Cloudflare 备用站部署（Worker + D1 v4 + R2）

> 备用站：https://points1.example.com
> 功能：主站挂机时可独立读写；恢复后 60 秒内与主站双向合并。

## 0. 前置

- 本机已装 Node 20+ 与 wrangler（`npm i -g wrangler`）。
- 已 `wrangler login`。
- 已在 `app/wrangler.toml` 里确认 name/main/binding。

## 1. 建 D1 v4 库

```bash
cd /opt/class-points   # 或项目根
wrangler d1 create class-points-db-v4
```

输出形如：

```
✅ Successfully created DB 'class-points-db-v4'
[[d1_databases]]
binding = "DB"
database_name = "class-points-db-v4"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 `database_id` 回填到 `app/wrangler.toml` 的空字符串处。

## 2. 导入迁移好的数据

> wrangler.toml 在 `app/` 目录，所有 `d1` 命令都要在 `app/` 下跑。

```bash
cd /opt/class-points/app
# scripts/tmp/new-d1.sql 是 scripts/migrate.mjs 生成的（相对 app/ 即 ../scripts/tmp/）
wrangler d1 execute class-points-db-v4 --remote --file=../scripts/tmp/new-d1.sql
```

核对行数（应与本地 `data/app.db` 一致）：

```bash
cd /opt/class-points/app
wrangler d1 execute class-points-db-v4 --remote --command "SELECT COUNT(*) AS students FROM students WHERE deleted=0;"
wrangler d1 execute class-points-db-v4 --remote --command "SELECT COUNT(*) AS records FROM point_records;"
```

> `new-d1.sql` 含建表 DDL，必须在第 5 步 `wrangler deploy` **之前**完成导入——空库直接部署 Worker 会报表不存在。

## 3. R2 桶

沿用旧桶 `class-points-backup`，无需新建。如果 CF 账号里看不到：

```bash
wrangler r2 bucket create class-points-backup
```

## 4. 注入同步密钥

与家里主站 `data/config.json` 里的 `SYNC_SECRET` **完全一致**：

```bash
# 先生成（两边用同一个）
openssl rand -hex 32

# 写入 Worker secret
cd app
wrangler secret put SYNC_SECRET
# 粘贴上面生成的串
```

## 5. 部署 Worker

```bash
cd /opt/class-points/app
wrangler deploy
```

输出会给出默认域名 `class-points-app-v4.<你的子域>.workers.dev`。

## 6. 绑定自定义域名 points1.example.com

二选一：

**A) Cloudflare 控制台（推荐）**
Workers & Pages → class-points-app-v4 → Settings → Domains & Routes → Add →
`points1.example.com`（自动加 DNS 记录）。

**B) wrangler routes**（在 wrangler.toml 追加）：

```toml
[[routes]]
pattern = "points1.example.com/*"
zone_name = "example.com"
```

## 7. 部署后核对清单

- [ ] 打开 https://points1.example.com/start 能看到激活页
- [ ] 打开 https://points1.example.com/api/snapshot 返回 `{ok:true, students:[...]}`
- [ ] 在备用站后台发一条公告，等 ≤60 秒，家里主站首页「班级动态」出现同一条
- [ ] 反过来在主站加一分，等 ≤60 秒，备用站历史记录能看到
- [ ] 重复同步两次，学生分数不翻倍（幂等）
