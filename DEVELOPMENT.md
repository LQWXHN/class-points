# DEVELOPMENT.md —— 班级积分系统二次开发上手文档

> 版本：v4.8（2026-10-24）
> 本文档面向**第一次接手本仓库的程序员**。读完本文，你应当能在 30 分钟内把项目跑起来，知道每个目录和关键文件是干什么的，并且动手改一个小功能时知道"该动哪几处"。
>
> 普通班主任的使用说明请看 [PROJECT.md](./PROJECT.md)；服务器运维与网络方案请看 [部署教程.md](./部署教程.md) 与 [deploy/](./deploy/) 目录。
>
> 许可证：MIT。仓库地址：`https://github.com/<your-fork>/class-points`（本文中所有域名、IP、密钥均为占位符，请替换为你自己的）。

---

## 目录

1. [这个项目是什么](#1-这个项目是什么)
2. [整体架构](#2-整体架构)
3. [目录结构逐项说明](#3-目录结构逐项说明)
4. [本地开发环境](#4-本地开发环境)
5. [核心机制详解](#5-核心机制详解)
6. [前端约定](#6-前端约定)
7. [改动地图（手把手）](#7-改动地图手把手)
8. [部署流程](#8-部署流程)
9. [回滚与备份恢复](#9-回滚与备份恢复)
10. [常见排障](#10-常见排障)

---

## 1. 这个项目是什么

一套给中小学班主任用的**班级积分管理网页**（不是 App，浏览器打开即用）：

- 老师在后台点按钮给学生加/减分；
- 学生在教室大屏 / 自己手机上看积分、看排行榜、看通知、给老师发小纸条；
- 系统故意同时跑在**两个站点**上（家里常开的小服务器 + Cloudflare Worker），数据每 60 秒双向同步一次，主站挂了浏览器切到备用站即可。

技术栈一句话：**Hono 单代码库 + 原生 HTML/CSS/JS 前端（无构建链）+ SQLite/Cloudflare D1 + 本地磁盘/R2 对象存储**。

| 维度 | 主站（Node） | 备用站（Worker） |
|---|---|---|
| 入口 | `app/src/node.js` | `app/src/worker.js` |
| 运行时 | Node.js ≥ 20（实际推荐 22） | Cloudflare Workers V8 isolate |
| 数据库 | SQLite（`better-sqlite3`，WAL 模式） | Cloudflare D1 |
| 文件存储 | 本地磁盘 `DATA_DIR/uploads/` | Cloudflare R2 Bucket |
| 静态资源 | Node 自己读 `web/` 目录吐出去 | Cloudflare Workers Assets |
| 同步触发 | `setInterval` 每 60 秒主动拉推 | Cron Triggers 每分钟触发 `scheduled()` |
| 备份 | 每周一 04:00（服务器本地时间）写 `DATA_DIR/backups/` | 每周一 04:00（北京时间）写 R2 `backups/` |

两个入口**共享同一份 `app/src/app.js` 挂载的路由与同步逻辑**，区别只在"数据库怎么连、文件存哪、静态资源怎么吐、同步定时器怎么触发"。

---

## 2. 整体架构

### 2.1 文字版架构图

```
                        浏览器（学生大屏 / 老师后台 / 家长手机）
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              主站  https://points.example.com   备用站  https://points1.example.com
              (Node 22 + systemd :8787)          (Cloudflare Worker)
                    │                               │
        ┌───────────┼───────────┐          ┌──────────┼───────────┐
        │           │           │          │          │           │
   Hono app.js  SQLite       磁盘        Hono app.js  D1         R2
   (共享路由)   app.db      uploads/     (共享路由)   (SQLite)   bucket
                  │           backups/                  │           │
                  └───────────┬──────────────────────────┘           │
                              │                                      │
                  POST /api/sync  (Header: X-Sync-Key: <secret>)    │
                  POST /api/sync/files  (multipart, 同上鉴权)        │
                              │                                      │
                              └──────────── 每 60s 双向对表 ─────────┘

   对外依赖：
     • Resend（邮件通知：登录提醒/激活码使用/备份成功/找回密码验证码）
     • Cloudflare（D1 / R2 / Worker / 自定义域名）—— 仅备用站
```

### 2.2 双端共享层

`app/src/app.js` 里的 `createApp({ db, storage, origin, syncSecret, peerUrl })` 是**唯一的路由装配点**：

1. 挂 CORS（放行 `/api/*` 的 `X-Device-Token`、`X-Sync-Key`、`Authorization`）；
2. 中间件把 `db / storage / origin / syncSecret / peerUrl` 塞进 Hono context（`c.get('db')` 等）；
3. 依次 `app.route('/api', xxxRoutes())` 挂载全部业务路由；
4. 全局错误处理统一返回 `{ok:false, error}`。

Node 端和 Worker 端都调用这个 `createApp`，所以**业务路由代码一份都不用改就能两端跑**——前提是你遵守下面这条铁律：

> **路由里永远只通过 `c.get('db')` 和 `c.get('storage')` 访问数据，不要 `import` better-sqlite3 或 R2 SDK。** 这就是存储/数据库抽象的全部意义。

### 2.3 数据库抽象

两端各有一个 adapter，对外暴露完全相同的异步接口：

| 方法 | 作用 |
|---|---|
| `db.run(sql, ...params)` | 执行写，返回 `{lastRowId, changes}` |
| `db.get(sql, ...params)` | 取一行 |
| `db.all(sql, ...params)` | 取多行 |
| `db.tx(async () => { ... })` | 事务。**事务内只允许 `db.run`（会被收集起来批量执行），禁止 `db.get/all`，需要的数据必须在事务外预载好** |
| `db.execSchema(sqlText)` | 整段执行 DDL（Node 端 `raw.exec`；Worker 端拆条后 `d1.batch`） |

实现分别是：

- `app/src/db/node-db.js` —— `better-sqlite3`，WAL 模式，`tx` 内收集 SQL 后一次性 `raw.transaction(...)` 执行；
- `app/src/db/worker-db.js` —— Cloudflare D1，`tx` 内收集后 `d1.batch([...])`。

### 2.4 存储抽象

`storage` 对象两端同构，接口如下：

| 方法 | Node 磁盘实现 | Worker R2 实现 |
|---|---|---|
| `put(key, bytes, contentType)` | 写 `DATA_DIR/<key>` | `bucket.put(key, bytes, {httpMetadata})` |
| `get(key)` | 读文件 Buffer | `bucket.get(key)` |
| `del(key)` | `fs.unlink` | `bucket.delete(key)` |
| `list(prefix)` | 递归 walk 目录 | `bucket.list({prefix, cursor})` 翻页 |
| `exists(key)` | `fs.existsSync` | `bucket.head(key)` |
| `url(key)` | 返回 `/api/file/<encoded key>`（两端一致） | 同左 |

业务侧完全不感知差异。文件 key 约定：上传附件放 `uploads/<ts>_<filename>`，备份放 `backups/backup_<type>_<epochMs>.json`。

---

## 3. 目录结构逐项说明

```
班级积分系统/
├── DEVELOPMENT.md            ← 本文档
├── PROJECT.md                ← 班主任使用说明书（面向老师，不是给你看代码的）
├── 部署教程.md               ← 服务器/网络/运维完整教程
├── README.md                 ← 仓库首页简介
├── LICENSE                   ← MIT
│
├── app/                      ← 后端代码（Node 工程）
│   ├── package.json          ← name=class-points-app, type=module, deps: hono / @hono/node-server / better-sqlite3
│   ├── wrangler.example.toml ← Worker 部署配置模板（复制为 wrangler.toml 后填 ID；真实 wrangler.toml 不入库）
│   ├── wrangler.dev.toml     ← 本地 wrangler dev 用配置
│   ├── src/
│   │   ├── app.js            ← ★ createApp()：双端共享的 Hono 路由装配
│   │   ├── node.js           ← ★ Node 主站入口：建库、跑 migrateV4x、挂静态文件、起 sync runner、排 04:00 备份
│   │   ├── worker.js         ← ★ Worker 备用站入口：fetch 处理请求 + scheduled 每分钟跑 sync tick/自动备份
│   │   ├── db/
│   │   │   ├── node-db.js    ← better-sqlite3 适配器（WAL；tx 内禁 get/all）
│   │   │   ├── worker-db.js  ← D1 适配器（tx 用 d1.batch）
│   │   │   └── schema.sql    ← ★ 全部建表 DDL（CREATE TABLE IF NOT EXISTS，幂等；含内置 teacher/admin 种子）
│   │   ├── storage/
│   │   │   ├── disk-storage.js  ← 磁盘存储实现
│   │   │   └── r2-storage.js    ← R2 存储实现
│   │   ├── routes/
│   │   │   ├── _helpers.js       ← ★ 共享工具：uid/now/genToken/hashPassword(PBKDF2)/getConfig/setConfig/getKv/setKv/
│   │   │   │                        verifyUser(教师 session)/verifyDevice(设备 token)/writeSyncEvent/sendEmail/notify/logAudit/logLogin
│   │   │   ├── auth.js           ← 教师/超管登录、首次设密码、改密、找回密码（邮件验证码）、个人资料
│   │   │   ├── device.js         ← 设备激活码（含 MASTER_CODE 万能码，环境变量覆盖）、设备列表、生成/删除激活码
│   │   │   ├── students.js       ← 学生 CRUD、分组、超管直改分
│   │   │   ├── groups.js         ← 小组 CRUD（v4.8 起含 avatar 头像、颜色、签名）
│   │   │   ├── rules.js          ← ★ 积分规则 CRUD + POST /rules/reorder（拖拽排序，sort_order）
│   │   │   ├── points.js         ← POST /points/batch（批量加扣分，事务内写流水+学生余额+同步事件）、/points/reset
│   │   │   ├── records.js        ← 历史流水查询/导出
│   │   │   ├── announcements.js ← 班级动态（公告）CRUD + 编辑快照 + 已读回执
│   │   │   ├── system-announcements.js ← 系统公告（Markdown，面向所有设备弹窗）
│   │   │   ├── front-messages.js ← 学生 → 老师的小纸条（设备投稿）
│   │   │   ├── rankings.js       ← 个人/小组/段位/双周榜（双周榜锚点 2026-10-12 + 14 天周期，常量在文件头）
│   │   │   ├── upload.js         ← POST /upload（附件上传）、GET /api/file/*（附件下载）
│   │   │   ├── backup.js         ← 备份打包/恢复/列表/下载/删除；跨端 /api/sync/backup/* 代理
│   │   │   ├── config.js         ← ★ GET/PUT /config（全部 admin_config 读写；含 tier_rules/modal_blur_enabled 等校验）
│   │   │   ├── super.js          ← 超管功能：账户管理、登录日志、审计日志、设备管理
│   │   │   ├── sync.js           ← ★ /api/sync（双向事件对表）、/api/sync/files（文件拉推）、/api/sync/status、/api/sync/backup/*
│   │   │   ├── snapshot.js       ← 学生端快照接口
│   │   │   ├── feedback.js       ← 用户反馈（带附件）
│   │   │   └── public.js         ← /api/public/bootstrap（无鉴权，前端启动拉取）、/api/storage/usage
│   │   └── sync/
│   │       ├── runner.js       ← ★ Node 端主动同步 runner：每 pollMs=60000 一轮，推本端事件、拉对端事件、补文件
│   │       ├── worker-tick.js  ← ★ Worker 端同步 tick：由 scheduled cron 每分钟调用，逻辑同 runner
│   │       └── replay.js       ← ★ 事件回放：按 tbl 分支 upsert/delete；LWW(updated_at)；point_records 特殊处理 apply_delta
│   └── test-*.mjs              ← 若干冒烟/回归脚本（不是测试框架，是一次性 node 脚本）
│
├── web/                      ← ★ 前端（原生 HTML/CSS/JS，无构建）
│   ├── index.html            ← 学生前台主页
│   ├── start.html            ← 设备激活页
│   ├── ae.html               ← 关于页
│   ├── history.html          ← 学生历史流水页
│   ├── new.html              ← 班级动态（公告列表）
│   ├── send.html             ← 学生给老师发消息
│   ├── sw.js                 ← Service Worker（缓存名 cp-v55；改静态资源必须升版本）
│   ├── manifest.webmanifest  ← PWA manifest
│   ├── admin/
│   │   ├── index.html        ← 后台壳（登录屏 + 侧栏 + main-content 容器）
│   │   ├── admin.js          ← ★ 后台全部逻辑（单文件 ~16 万字符，switchPage 切页）
│   │   └── admin.css
│   └── assets/
│       ├── common.js         ← ★ 前端公共对象 CP（所有页面共享；api/esc/modal/toast/deviceToken/bootstrap…）
│       ├── apple.css         ← 全站视觉样式
│       ├── page-index.js/css ← 前台主页逻辑
│       ├── page-new.js/css   ← 班级动态
│       ├── page-send.js/css  ← 发消息
│       ├── page-history.js/css ← 历史
│       ├── logo.svg
│       └── vendor/fontawesome/ ← 图标库（本地化，不进 CDN）
│
├── scripts/
│   ├── migrate-v41.sql … migrate-v48.sql  ← ★ D1 端迁移脚本（Node 端由 node.js 内 migrateV4x() 跑）
│   ├── migrate-r2.sh / .ps1               ← R2 批量迁移工具
│   ├── export-old-d1.sh / .ps1            ← 老 D1 数据导出
│   └── tmp/                               ← 开发期一次性脚本/日志/临时库（不影响生产，可删）
│
├── deploy/
│   ├── class-points.service   ← systemd 单元模板
│   ├── Caddyfile             ← 反代模板（可选，用 cloudflared tunnel 可不用）
│   ├── cloudflared-config.yml
│   ├── setup-node.sh         ← 主站一键初始化（幂等）
│   ├── deploy-cf.sh           ← Worker 部署脚本
│   └── README-node.md / README-networking.md / README-cloudflare.md
│
├── data/                     ← 本地开发时 Node 端数据目录（gitignore）
│   ├── app.db / app.db-wal / app.db-shm
│   ├── uploads/
│   ├── backups/
│   └── config.json           ← 可选，覆盖环境变量（SYNC_SECRET / CF_PEER_URL / PORT）
└── .wrangler/                ← wrangler 本地状态（gitignore）
```

---

## 4. 本地开发环境

### 4.1 前置依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20（推荐 22） | 跑主站；自带 `node:sqlite`，但本项目用 `better-sqlite3` |
| npm | 随 Node | 装依赖 |
| wrangler | 4.x（devDependency 自动装） | 本地跑/部署 Worker |
| （可选）Cloudflare 账号 | —— | 只在你要联调 D1/R2/Worker 部署时需要 |

> Windows 本地开发完全可行；Linux 服务器部署见 [deploy/](./deploy/)。

### 4.2 装依赖并启动 Node 主站

```powershell
# PowerShell
cd F:\DESKTOP\班级积分系统\app
npm install

# 用一个干净的临时数据目录跑（避免动到仓库自带 data/）
$env:PORT = "8787"
$env:DATA_DIR = "F:\DESKTOP\班级积分系统\data"   # 首次启动会自动建 app.db / uploads/ / backups/
npm start
```

启动成功后控制台会打印：

```
[node] listening on http://127.0.0.1:8787  data=F:\DESKTOP\班级积分系统\data
```

打开 `http://127.0.0.1:8787/` 应看到学生前台主页；`http://127.0.0.1:8787/admin` 是后台。

> 环境变量优先级：`data/config.json` 里的同名键 > 进程环境变量 > 代码默认值。生产上推荐把 `SYNC_SECRET`、`CF_PEER_URL` 写进 `data/config.json` 或 systemd 的 `EnvironmentFile`，不要硬编码。

### 4.3 建库 / 迁移怎么跑

**你不用手动跑任何 SQL。** 流程如下：

1. Node 端启动时，`node.js` 会：
   - `db.execSchema(schema.sql)` —— 所有 `CREATE TABLE IF NOT EXISTS` 幂等执行；
   - 依次调用 `migrateV41 → V42 → V44 → V45 → V46 → V47 → V48`（每个都是幂等的：`PRAGMA table_info` 检查列是否存在、`INSERT OR IGNORE`/`WHERE NOT EXISTS` 写默认值）。
2. Cloudflare D1 端没有"启动时跑迁移"的机会，所以对应每一个 `migrateVxx`，仓库里都有一份 `scripts/migrate-vxx.sql`，部署前用 wrangler 手动打到 D1（见 §8）。

新表如果只在 `schema.sql` 里加 `CREATE TABLE IF NOT EXISTS`，Node 端首次启动自动建；D1 端需要在对应版本的 `scripts/migrate-vNN.sql` 里补同样的 DDL。

### 4.4 冒烟测试

最小冒烟（手动）：

```powershell
# 1) 健康检查
curl http://127.0.0.1:8787/api/public/bootstrap
# 期望：{"ok":true,"sites":[...],"system_version":"v4.8（2026-10-24）",...}

# 2) 首次设置 teacher 密码
curl -X POST http://127.0.0.1:8787/api/auth/setup -H "Content-Type: application/json" -d '{\"username\":\"teacher\",\"password\":\"test1234\"}'

# 3) 登录拿 token
curl -X POST http://127.0.0.1:8787/api/auth/login -H "Content-Type: application/json" -d '{\"username\":\"teacher\",\"password\":\"test1234\"}'
# 复制返回的 token

# 4) 拉规则列表（无需鉴权）
curl http://127.0.0.1:8787/api/rules

# 5) 拉同步状态（需教师 token）
curl http://127.0.0.1:8787/api/sync/status -H "Authorization: Bearer <token>"
```

仓库 `app/test-smoke.mjs`、`scripts/tmp/check-v48.mjs` 是作者自己用的冒烟脚本，可参考但不是强制。

### 4.5 Worker 本地与部署

```powershell
cd app
# 1) 复制模板并填 ID
Copy-Item wrangler.example.toml wrangler.toml
#    编辑 wrangler.toml：database_id、bucket_name、routes.pattern 换成你自己的

# 2) 本地 dev（需要 XDG_CONFIG_HOME 指到仓库内，避免污染用户目录）
$env:XDG_CONFIG_HOME = "F:\DESKTOP\班级积分系统\app\.wrangler-config"
npx wrangler dev

# 3) 打 D1 迁移（部署前必跑）
npx wrangler d1 execute class-points-db --local --file=../scripts/migrate-v48.sql   # 本地
npx wrangler d1 execute class-points-db --remote --file=../scripts/migrate-v48.sql  # 线上

# 4) 注入同步密钥（不要写进 wrangler.toml）
npx wrangler secret put SYNC_SECRET

# 5) 部署
npx wrangler deploy
```

---

## 5. 核心机制详解

### 5.1 一次请求的生命周期

以"老师在后台点了一下加分按钮"为例：

```
浏览器
  │  POST /api/points/batch   Header: Authorization: Bearer <staff_token>
  ▼
Hono app.js
  ├─ cors() 放行
  ├─ 中间件：c.set('db' / 'storage' / 'origin' / 'syncSecret' / 'peerUrl')
  ▼
routes/points.js → POST /points/batch
  ├─ verifyUser(c)            // 查 sessions 表，校验 token 未过期
  ├─ 事务外预载 students / groups（tx 内禁止 get/all）
  ├─ db.tx(async () => {
  │    ├─ UPDATE students SET points=...
  │    ├─ writeSyncEvent({tbl:'students',  row_uid, op:'upsert', snapshot})
  │    ├─ INSERT INTO point_records ...
  │    └─ writeSyncEvent({tbl:'point_records', row_uid, op:'upsert', snapshot, apply_delta:1})
  │  })
  ▼
返回 {ok:true, count:N}
  │
  └─（异步，最长 60s）runner.js 把这条新 sync_events 推给对端，对端 replayEvent() 落库
```

**铁律：任何写业务表的操作，都必须在同一个事务里再写一条 `sync_events`**（调用 `writeSyncEvent`）。否则这行数据永远不会同步到另一端。

### 5.2 三套鉴权

| 鉴权方式 | Header | 校验位置 | 用在哪 |
|---|---|---|---|
| **教师 session** | `Authorization: Bearer <token>` | `_helpers.js → verifyUser()`：每次请求都 `SELECT * FROM sessions WHERE token=?`，并顺手删过期 session；再 JOIN `admin_users` 取 display_name | 后台所有写操作、`/api/config`、`/api/rules`、`/api/sync/status` 等 |
| **设备 token** | `X-Device-Token: <token>` | `_helpers.js → verifyDevice()`：`SELECT * FROM device_tokens WHERE token=? AND deleted=0`，命中就更新 `last_seen` | 学生大屏/手机前台接口（加分、发消息、看公告） |
| **同步密钥** | `X-Sync-Key: <secret>` | `routes/sync.js` 里直接 `c.req.header('X-Sync-Key') === c.get('syncSecret')` | **仅** `/api/sync`、`/api/sync/files`、`/api/sync/backup/*`——这是两台服务器之间互信的凭证，绝不能暴露给浏览器 |

补充：

- 密码用 PBKDF2-SHA256（10 万轮）+ 随机 salt 哈希，见 `hashPassword`。
- 登录限流：同 IP+用户名 5 分钟内失败 5 次锁 5 分钟。
- 设备激活有"万能码"：`routes/device.js` 里 `MASTER_CODE = process.env.MASTER_CODE || 'change-me-on-deploy'`，**生产必须用环境变量覆盖**，且这个值绝不写库、绝不进 `list-codes`。
- `verifyUser` 和 `verifyDevice` 是或的关系：例如 `/api/upload`、`/api/points/batch` 教师和已激活设备都能调。

### 5.3 sync_events 双向同步

#### 5.3.1 数据结构

`sync_events` 表（两端同构）：

| 列 | 含义 |
|---|---|
| `event_uid` | 事件全局唯一 ID（UUID），幂等去重靠它 |
| `tbl` | 业务表名 |
| `row_uid` | 业务行的 uid（主键是 UUID，不是自增 id——自增 id 两端不一致） |
| `op` | `upsert` 或 `delete` |
| `snapshot` | 该行完整 JSON |
| `apply_delta` | 仅 point_records 用：=1 表示回放时要调整 `students.points` |
| `origin` | 事件首发端（`node` / `worker` / 收到事件时的对端标识） |
| `ts` | 毫秒时间戳 |

#### 5.3.2 同步时序

```
Node runner (每 60s)                Worker tick (每分钟 cron)
     │                                      │
     ├─ lastOutId = kv_meta['sync_out_id']  │
     ├─ myEvents = SELECT * FROM sync_events WHERE id > lastOutId
     │                                      │
     └───────────── POST {peer:'node', last_id: peerLastId, events: myEvents} ────────►
                       Header: X-Sync-Key                                                   │
                                                                                   Worker 路由 /api/sync：
                                                                                     ├─ 逐条 INSERT INTO sync_events (按 event_uid 去重)
                                                                                     ├─ replayEvent(ev) 落业务表
                                                                                     └─ 扫描本端缺失的附件，填 need_files
                                                                                   ◄──── 返回 {last_id, events: 对端未拉取事件, need_files}
     ◄──────────────────────────────────────────────────────────────────────────────────┘
     ├─ kv_meta['sync_out_id'] = 已推送最后一条 id
     ├─ kv_meta['sync_peer_last_id'] = 对端返回的 last_id
     ├─ 对端返回的事件已在 /api/sync 路由内 replay 过
     ├─ pullMissingFiles：本端缺的附件，从对端 GET /api/file/<key> 拉回
     └─ pushFiles：把 myEvents 里引用的附件 multipart 推给对端 /api/sync/files
```

关键设计：

- **游标存在 `kv_meta`**（不是业务表）：`sync_out_id`（本端已推到对端哪条）、`sync_peer_last_id`（本端已拉到对端哪条）、`sync_last_push_at`、`sync_last_pull_at`、`sync_last_error`。
- **幂等**：每条事件先按 `event_uid` 查是否已存在，存在就跳过；`replayEvent` 内再按 `row_uid` upsert。
- **冲突解决**：编辑类（学生/小组/规则/公告等）按 `updated_at` 做 LWW（Last-Write-Wins）——本地已有行且本地 `updated_at >= snapshot.updated_at` 就跳过。
- **point_records 是事件流**：只插不改，`apply_delta=1` 时回放侧把 `students.points` 加上/减去对应值；`type='set'` 直接覆盖。学生余额本身不通过 upsert 同步，而是靠回放流水推导（超管直改走 `force_points=1` 特例）。
- **自愈**：每次同步双方都会额外扫描最近 200 条公告/前台消息/系统公告，凡是库里引用了文件但本地存储缺的，都加进 `need_files`，保证历史漏推最终能追平。

#### 5.3.3 文件同步白名单（fileBearingTable）

只有这 5 张表的事件会触发附件双向传输：

| 表 | 文件字段 | 提取方式 |
|---|---|---|
| `announcements` | `file_url` | 单列 |
| `front_messages` | `file_url` | 单列 |
| `announcement_versions` | `file_url` | 单列（历史快照） |
| `system_announcements` | `content`（Markdown） | 正则提取所有 `/api/file/<key>` 图片 |
| `groups` | `avatar`（v4.8 新增） | 若以 `/api/file/` 开头则提取 key；emoji/dataURL 不同步文件 |

判断逻辑在三处保持一致：`routes/sync.js`、`sync/runner.js`、`sync/worker-tick.js` 里的 `fileBearingTable()`。**新增带附件的表时，三处都要加。**

### 5.4 存储抽象

见 §2.4。要点：业务代码里只 `c.get('storage')`，绝不直接 `import` R2 SDK 或 `fs`。上传接口 `POST /api/upload` 把文件写进 `uploads/`，返回 `/api/file/<key>`；下载走 `GET /api/file/*`（公开，带 1 天缓存）。

### 5.5 数据库迁移链

- **Node 端**：`app/src/node.js` 启动时按顺序调用 `migrateV41 → V48`，每个函数自己 `PRAGMA table_info` 探列、`INSERT OR IGNORE` 写默认值，重复启动安全。
- **D1 端**：没有"启动时跑迁移"的时机，所以每发一个版本，都要在 `scripts/` 下加一份 `migrate-v<NN>.sql`，部署前 `wrangler d1 execute --remote --file=...` 打上去。
- **加新列的惯例**：Node 端在对应 `migrateVxx` 里 `PRAGMA table_info` 探一次再 `ALTER TABLE ADD COLUMN`；D1 端写 `ALTER TABLE ... ADD COLUMN ...`（D1 不支持 `ADD COLUMN IF NOT EXISTS`，重复跑报错可忽略）。
- **清缓存类迁移**（如双周榜口径改了）：直接 `DELETE FROM rank_snapshots WHERE kind='biweekly'`，纯缓存随时可重算。

### 5.6 配置键体系（admin_config 关键键清单）

所有系统配置都在 `admin_config` 表里，通过 `getConfig(db, key)` / `setConfig(db, key, value)` 读写；`setConfig` 会自动写一条 `tbl='admin_config'` 的同步事件，两端自动一致。

| key | 含义 | 谁能改 |
|---|---|---|
| `site_title` | 站点标题 | staff |
| `system_version` | 版本号字符串（如 `v4.8（2026-10-24）`） | 代码迁移时写 |
| `sites` | JSON 数组：`[{name, url}, ...]`，前台地球切换器用 | 仅超管 |
| `ext_links` | JSON 对象：`{github, home, blog}` | staff |
| `biweekly_rank_enabled` | 双周榜开关 `0/1` | 仅超管 |
| `modal_blur_enabled` | 弹窗背景模糊开关 `0/1`（v4.8 新增，默认 `1`） | staff |
| `tier_rules` | JSON：段位规则数组（内置 31 级青铜→传奇王者） | staff |
| `notify_sound` / `notify_sound_url` | 通知提示音 | staff |
| `rescue_email` | 找回密码验证码收件邮箱 | staff |
| `notify_email` | 事件通知收件邮箱（登录/激活码/备份成功） | staff |
| `notify_on_login` / `notify_on_device_code` / `notify_on_master_code` / `notify_on_backup` | 各类邮件通知开关 `0/1` | staff |
| `resend_api_key` / `resend_from` | Resend 邮件服务配置（API key 对前端脱敏显示） | staff |
| `auto_backup_enabled` | 自动备份总开关 `0/1` | staff |

> Worker 端（备用站）**不允许写外观类配置**（`sites`/`ext_links`/`biweekly_rank_enabled`/`modal_blur_enabled`/`system_version`/`site_title`），必须在主站改——见 `routes/config.js` 里的 `APPEARANCE_KEYS`。

---

## 6. 前端约定

### 6.1 技术栈

**纯原生 HTML/CSS/JS，无打包、无框架、无 npm 前端依赖。** 改前端不用跑 build，直接改文件刷新即可（但要注意 Service Worker 缓存，见 §6.5）。

### 6.2 CP 公共对象

所有页面 `<script src="/assets/common.js">` 之后，全局挂 `window.CP`，提供：

- `CP.API = '/api'`；
- token 读写：`CP.getDeviceToken() / setDeviceToken() / getAdminToken() / setAdminToken()`（localStorage key 分别是 `cp_device_token` / `admin_token`）；
- `CP.esc(s)` HTML 转义、`CP.qs(name)` 取 query、`CP.fmtTime(ms)`、`CP.fmtDate(ms)`；
- `CP.api(path, {method, body})`：自动带对应 token，统一处理 401 跳登录；
- `CP.modal(html)` / `CP.closeModal()` / `CP.toast(msg, type)`；
- `CP.deviceFingerprint()`：canvas/webgl/字体指纹，用于设备激活；
- `CP.bootstrap`：启动时 `GET /api/public/bootstrap` 拉下来的对象（站点列表、版本号、提示音、双周榜开关、弹窗模糊开关等）。

### 6.3 bootstrap 下发

前端启动一律先 `GET /api/public/bootstrap`（无鉴权），拿到：

```json
{
  "ok": true,
  "sites": [{"name":"主站","url":"https://points.example.com"}, ...],
  "ext_links": {"github":"","home":"","blog":""},
  "system_version": "v4.8（2026-10-24）",
  "notify_sound": "ganlu",
  "biweekly_rank_enabled": "1",
  "modal_blur_enabled": "1"
}
```

新增一个需要在前端启动时就知道的开关，就在 `routes/public.js` 的 bootstrap 里加一行 `getConfig`，并在 `common.js` 启动逻辑里读 `CP.bootstrap.xxx`。

### 6.4 页面 / 路由清单

无后缀路由由 `node.js`（静态文件映射）和 `worker.js`（`PAGE_REWRITES`）分别处理：

| 路径 | 文件 | 用途 |
|---|---|---|
| `/` | `web/index.html` | 学生前台主页 |
| `/start` | `web/start.html` | 设备激活 |
| `/ae` | `web/ae.html` | 关于 |
| `/history` | `web/history.html` | 学生历史流水 |
| `/new` | `web/new.html` | 班级动态 |
| `/send` | `web/send.html` | 发消息给老师 |
| `/admin` → `/admin/` | `web/admin/index.html` | 后台壳 |

后台内部页（`switchPage('students'|'groups'|'rules'|'announcements'|'rankings'|'records'|'export'|'backup'|'security'|'settings'|'super-users'|...)`）全在 `web/admin/admin.js` 里以字符串模板渲染，没有独立 HTML 文件。

### 6.5 Service Worker 与缓存版本

- `web/sw.js` 当前缓存名 `cp-v55`。
- 策略：导航请求网络优先（离线回退缓存）；静态资源缓存优先；`/api/*` 完全不缓存。
- **改了任何静态资源（HTML/CSS/JS）后必须做两件事**：
  1. 把 `sw.js` 里的 `const CACHE = 'cp-v55'` 升到 `cp-v56`（activate 阶段会自动清掉旧缓存）；
  2. 把所有 HTML 里引用该资源的 `?v=55` 改成 `?v=56`（例如 `/assets/common.js?v=55` → `?v=56`）。
- Node 端对 HTML 强制 `Cache-Control: no-cache`，对 JS/CSS 是 `max-age=300, must-revalidate`，所以边缘不会长期滞留旧版本，但升版本号仍是必须动作。

---

## 7. 改动地图（手把手）

下面 4 个例子覆盖日常 80% 的改动场景。每个例子都列出"动哪几个文件、为什么"。

### 7.1 例一：新增一条加减分规则 / 调整规则排序

**场景**：产品说"加一条'主动举手 +1'，并且把'作业全对'排到加分第一位"。

规则本身已经是 CRUD，**不需要改后端代码**：

1. 后台「积分规则」页点"添加"，填 `type=add, reason=主动举手, points=1`；
2. 拖动手柄排序，前端会调 `POST /api/rules/reorder`：

   ```json
   { "orders": [{"uid":"<rule-uid-1>","sort_order":1}, ...] }
   ```

3. 后端 `routes/rules.js` 已实现：
   - `GET /api/rules` 按 `ORDER BY type, sort_order ASC, id ASC` 返回；
   - `POST /api/rules` 新建时自动把 `sort_order` 设为该类型末尾 `MAX+1`；
   - `POST /api/rules/reorder` 事务内批量更新 `sort_order`，每条都写同步事件。

如果你想**改内置规则的默认值**，去 `node.js` 的 `migrateV44` 里看两条 `builtin-rule-add` / `builtin-rule-sub` 的种子 SQL；前端快捷按钮渲染顺序见 `web/assets/page-index.js` 里拉 `/api/rules` 后的渲染逻辑。

### 7.2 例二：新增一个前端页面并接入后台导航

**场景**：加一个"班级相册"页，只在后台可见。

1. **写页面逻辑**：后台没有独立 HTML，直接在 `web/admin/admin.js` 里加一个渲染函数：

   ```js
   async function renderAlbum() {
     $('main-content').innerHTML = `
       <div class="card"><h2>班级相册</h2>
         <div id="album-grid"></div>
       </div>`;
     // 拉数据、渲染……
   }
   ```

2. **注册到 switchPage 路由表**：在 `admin.js` 的 `switchPage(page)` 函数里加分支：

   ```js
   if (page === 'album') return renderAlbum();
   ```

3. **加侧栏导航项**：在 `renderNav()` 里加一行：

   ```js
   html += `<div class="nav-sec"><div class="nav-sec-t">新功能</div>
     ${item('album', 'fa-camera', '班级相册')}</div>`;
   ```

4. **如果是前台新页面**（独立 URL）：新建 `web/album.html`，然后在 `node.js` 的 `pageMap` 和 `worker.js` 的 `PAGE_REWRITES` 里都加 `'/album': '/album.html'`。

5. **升 SW 版本**：改了 `admin.js` / 新 HTML，记得 `cp-v55` → `cp-v56`，并把 HTML 里 `?v=55` 一起改。

### 7.3 例三：新增一个后台配置开关（从 DB 到同步）

**场景**：加一个"是否允许学生自定义头像"开关 `student_avatar_enabled`，默认开。

1. **写 schema/迁移**：不需要新表，只是 `admin_config` 多一个 key。在 `node.js` 的下一个迁移函数（如 `migrateV49`）里加默认值：

   ```js
   const row = await db.get("SELECT key FROM admin_config WHERE key=?", 'student_avatar_enabled');
   if (!row) await setConfig(db, 'student_avatar_enabled', '1');
   ```

   对应在 `scripts/migrate-v49.sql` 里写：

   ```sql
   INSERT INTO admin_config (key, value, updated_at)
     SELECT 'student_avatar_enabled', '1', 0
     WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE key='student_avatar_enabled');
   ```

2. **后端校验**：在 `routes/config.js` 的 `PUT /config` 里加分支：

   ```js
   if (k === 'student_avatar_enabled') {
     const s = String(v);
     if (s !== '0' && s !== '1') return c.json({ok:false, error:'必须为 0 或 1'}, 400);
     await setConfig(db, k, s);
     continue;
   }
   ```

   > `setConfig` 内部已经会 `writeSyncEvent({tbl:'admin_config', ...})`，对端 `replay.js` 里 `admin_config` 走 `INSERT OR REPLACE`，**自动同步，不用写额外代码**。

3. **bootstrap 下发**：在 `routes/public.js` 的 `/public/bootstrap` 里加：

   ```js
   const studentAvatarEnabled = await getConfig(db, 'student_avatar_enabled') || '1';
   // 返回对象里加 student_avatar_enabled: studentAvatarEnabled
   ```

4. **前端读取**：`common.js` 启动时已经把 bootstrap 存进 `CP.bootstrap`，页面里直接：

   ```js
   if (CP.bootstrap.student_avatar_enabled === '0') { /* 隐藏头像上传入口 */ }
   ```

5. **后台设置页**：在 `admin.js` 的 `renderSettings()` 里加一个开关 `<label><input type="checkbox" id="cfg-student-avatar"> 允许学生自定义头像</label>`，保存时 `CP.api('/config', {method:'PUT', body:{student_avatar_enabled: checked?'1':'0'}})`。

### 7.4 例四：新增一张表并纳入双端同步

**场景**：加一张"课堂表现点评"表 `comments`（学生 uid、点评内容、时间）。

1. **建表**：在 `app/src/db/schema.sql` 加（两端同构）：

   ```sql
   CREATE TABLE IF NOT EXISTS comments (
     uid         TEXT PRIMARY KEY,
     student_uid TEXT NOT NULL,
     content     TEXT NOT NULL DEFAULT '',
     created_by  TEXT NOT NULL DEFAULT '',
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL,
     deleted     INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS idx_comments_stu ON comments(student_uid);
   ```

   D1 端同样的 DDL 放进 `scripts/migrate-v49.sql`。

2. **写路由**：新建 `app/src/routes/comments.js`，CRUD 里**每次写业务表都要在事务内调 `writeSyncEvent`**：

   ```js
   await db.tx(async () => {
     await db.run('INSERT INTO comments (uid, student_uid, content, created_by, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,?)',
       cUid, studentUid, content, me.username, t, t, 0);
     await writeSyncEvent(db, { tbl: 'comments', row_uid: cUid, op: 'upsert',
       snapshot: { uid: cUid, student_uid, content, created_by: me.username, created_at: t, updated_at: t, deleted: 0 },
       origin: c.get('origin') });
   });
   ```

   软删：`UPDATE comments SET deleted=1 ...` + `writeSyncEvent({op:'delete', snapshot:{uid}})`。

3. **挂路由**：在 `app/src/app.js` 里 `import { commentsRoutes } from './routes/comments.js'` 并 `app.route('/api', commentsRoutes())`。

4. **写回放**：在 `app/src/sync/replay.js` 的 `applyUpsert` 里加 `comments` 分支（参考 `front_messages` 的 LWW upsert 写法）。

5. **（可选）带附件的话**：如果 comment 有图片附件，记得在 `routes/sync.js`、`sync/runner.js`、`sync/worker-tick.js` 三处的 `fileBearingTable()` 里加上 `'comments'`，并在 `keysFromSnap` 里提取 `file_url`。

6. **（可选）要进备份**：在 `routes/backup.js` 的 `buildBackup` 和 `restoreBackup` 里加上 `comments` 表的导出/恢复。

---

## 8. 部署流程

### 8.1 主站（Node + systemd）

```powershell
# 服务器上（Linux）
cd /opt/class-points
git pull
cd app
npm ci --omit=dev

# 数据目录（首次）
mkdir -p ../data/uploads ../data/backups
# 编辑 ../data/config.json，填入 SYNC_SECRET 与 CF_PEER_URL

sudo cp deploy/class-points.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart class-points
journalctl -u class-points -f
```

systemd 单元见 `deploy/class-points.service`：普通用户 `www-data` 跑、`Restart=always`、`EnvironmentFile=/opt/class-points/data/secrets.env`。

### 8.2 备用站（Cloudflare Worker）

**顺序很重要：先打 D1 迁移，再 deploy。**

```powershell
cd app
# 1) 打 D1 迁移（线上）
npx wrangler d1 execute class-points-db --remote --file=../scripts/migrate-v48.sql

# 2) 确认 secret 已注入（不需要每次重打）
npx wrangler secret list

# 3) 部署
npx wrangler deploy
```

### 8.3 版本号惯例

- `admin_config.system_version` 是给用户看的版本字符串，格式 `v<major.minor>（YYYY-MM-DD）`；
- 每个版本发版时：
  - Node 端 `migrateVxx` 最后一行 `UPDATE admin_config SET value='v4.x（日期）' ...`；
  - D1 端 `scripts/migrate-v<NN>.sql` 里同步写同样的 `UPDATE`；
  - `web/sw.js` 的 `CACHE` 升到 `cp-v<NN+1>`；
  - 所有 HTML 的 `?v=` 一起升。

---

## 9. 回滚与备份恢复

### 9.1 备份在哪

| 位置 | 路径 |
|---|---|
| Node 主站 | `$DATA_DIR/backups/backup_<type>_<epochMs>.json` |
| Worker 备用站 | R2 bucket `backups/backup_<type>_<epochMs>.json` |
| 备份记录 | 本地 `backup_log` 表 |

- 自动备份：每周一 04:00（Node 看服务器本地时间；Worker 用 UTC+8 判断），两端各一份；保留最近 8 份（`AUTO_KEEP=8`），超出自动删最旧。
- 手动备份：后台「数据备份」页两个卡片（服务器 / Cloudflare），可分别创建、下载、恢复、删除。跨端操作通过 `/api/sync/backup/*`（X-Sync-Key 鉴权）代理。
- 备份成功发邮件（`notify_on_backup=1`，Resend）。

### 9.2 恢复

后台「数据备份」页选一份 → 点恢复。后端 `restoreBackup()` 会按 groups → students → rules → announcements → ... 的顺序 upsert 覆盖当前库。恢复是**整库覆盖语义**，恢复前建议先手动备份一次。

命令行手动恢复：把 backup JSON 通过后台恢复接口上传，或直接用 `wrangler d1 execute` 对 D1 跑恢复 SQL。

### 9.3 回滚发版

- **代码回滚**：`git checkout <上一个 tag>`，主站 `systemctl restart class-points`，Worker `wrangler deploy` 上一个版本。
- **数据库回滚**：本项目**不做 down migration**。回滚代码前，先恢复到对应版本的备份；新表/新列留着不影响旧代码运行（旧代码不 `SELECT` 新列即可）。
- **同步回滚**：如果新版本引入了不兼容的 sync event 格式，先把两端都回到旧版本，再清一次 `sync_events`（极端情况，正常发版不会遇到）。

---

## 10. 常见排障

### 10.1 同步不工作，看哪

1. **先看状态接口**（教师 token）：

   ```powershell
   curl http://127.0.0.1:8787/api/sync/status -H "Authorization: Bearer <token>"
   ```

   返回里 `enabled`、`last_push_at`、`last_pull_at`、`last_error`、`pending_out` 是关键：
   - `enabled=false`：主站没配 `CF_PEER_URL` 或 `SYNC_SECRET`；
   - `last_error='HTTP xxx'`：对端不可达或密钥不对；
   - `pending_out` 持续增长：对端一直没收到。

2. **Worker 端**状态只能看日志：`npx wrangler tail`，grep `[sync] tick ok` / `[sync] tick failed`；错误信息会写进 D1 的 `kv_meta` 表 `key='sync_last_error'`。

3. **文件缺了**：公告/消息里图片裂了？下一轮同步（60s 内）自愈扫描会自动补拉；也可以手动再触发一次（重启 Node 或等 Worker cron）。

### 10.2 日志在哪

| 端 | 日志位置 |
|---|---|
| Node 主站 | `journalctl -u class-points -f`（systemd）；前台跑就是 stdout/stderr |
| Worker | `npx wrangler tail`；错误也写 `kv_meta.sync_last_error` |
| 登录/审计 | `login_logs` / `audit_logs` 表（后台「超级管理」可见） |

### 10.3 本地空库如何启动

```powershell
cd app
$env:DATA_DIR = "F:\DESKTOP\班级积分系统\scripts\tmp\fresh-dev"
$env:PORT = "8787"
npm start
```

首次启动会自动：建 `app.db`、跑全部迁移、插入 `teacher`/`admin` 两个空密码账户、写入默认 `admin_config`。打开 `/admin`，前端会引导你给 `teacher` 设置密码。

### 10.4 其他常见问题

- **改完前端没生效**：99% 是 Service Worker 缓存。硬刷新（Ctrl+Shift+R）或 DevTools → Application → Service Workers → Unregister；发版时记得升 `cp-vNN`。
- **D1 迁移报"duplicate column"**：D1 不支持 `ADD COLUMN IF NOT EXISTS`，重复跑报错可忽略，Node 端是幂等的。
- **登录被锁 5 分钟**：同 IP+用户名 5 分钟失败 5 次，等 5 分钟或换个浏览器隐身窗口。
- **邮件发不出去**：检查 `admin_config` 里 `resend_api_key` / `resend_from` / `notify_email` 是否配好，且对应 `notify_on_*` 开关为 `1`。

---

## 附：安全红线（二次开发必读）

- **永远不要**把真实密码、`SYNC_SECRET`、Resend API key、`MASTER_CODE` 写进代码或 commit 进仓库；全部走环境变量 / `data/config.json` / `wrangler secret`。
- `MASTER_CODE` 在 `routes/device.js` 里默认是占位符 `'change-me-on-deploy'`，生产必须用 `MASTER_CODE` 环境变量覆盖。
- 文档和注释里出现的域名一律用 `*.example.com`，内网 IP 用 `192.168.x.x`。
- 新增路由时想清楚走哪套鉴权：教师操作用 `verifyUser`、设备操作用 `verifyDevice`、端间互信用 `X-Sync-Key`——**绝不要**把 `X-Sync-Key` 校验暴露成浏览器可调的 API。
- 写同步事件时 `snapshot` 里不要包含密码哈希等敏感字段（`admin_users` 的 replay 分支已经显式只同步 `password_hash/password_salt/role/display_name`，不要顺手把别的字段加进去）。

---

> 有问题先翻 `app/src/routes/_helpers.js` 和 `app/src/sync/replay.js`——这两个文件看懂了，整个系统就通了一半。祝玩得开心。
