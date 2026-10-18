# 班级积分系统（Class Points System）

一套给中小学班主任用的**班级积分管理网站**：老师在后台加减分、发公告、看排行榜；学生在教室大屏 / 平板 / 手机上查看个人与小组分数、班级动态、历史记录，并可给老师发消息。浏览器打开即用，无需安装 App。

系统可以同时跑在**家里的一台常开小服务器（主站，Node + SQLite）**和 **Cloudflare 免费服务（备用站，Worker + D1/R2）**上，两端每 60 秒自动双向同步，任一站点挂了另一个可继续使用。

## 功能特性

- 学生 / 小组加分扣分，积分规则可自定义，批量操作
- 个人榜、小组榜、双周进步榜（可在后台开关）
- 班级动态（公告 / 分类 / 已读统计）、历史记录筛选与 CSV 导出
- 前台「发消息」给老师、意见反馈（含附件）
- 教师 / 超管两级后台，学生信息、小组、规则、激活码、设备、备份、系统公告等完整管理
- 教室设备用激活码（含万能码）激活，一台设备一个 Token
- 主站 / 备用站一键互跳（🌐 地球图标）
- 前台防截图遮罩（失焦盖页、拦截打印/保存/右键）
- 苹果风克制 UI、移动端自适应、PWA 离线缓存

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Hono 单份代码双入口：Node（`node:sqlite` / better-sqlite3）+ Cloudflare Workers（D1） |
| 前端 | 原生 HTML / CSS / JavaScript（无框架）、Service Worker、Font Awesome |
| 存储 | SQLite / Cloudflare D1；本地磁盘 / R2 附件与备份 |
| 同步 | 主站与 Worker 之间基于事件日志的双向同步（cron 每分钟拉取） |

## 目录结构

```
.
├── app/                    # 后端（Hono 双入口）
│   ├── src/
│   │   ├── node.js         # Node 主站入口（含各版本幂等迁移）
│   │   ├── worker.js       # Cloudflare Worker 入口
│   │   ├── app.js          # 路由装配
│   │   ├── routes/         # 业务路由（学生/积分/公告/排行榜/反馈/设备/备份…）
│   │   ├── db/             # 建表 DDL 与双端数据库适配
│   │   ├── sync/           # 主备双向同步
│   │   └── storage/        # 磁盘 / R2 附件存储
│   ├── wrangler.example.toml  # Worker 配置模板（真实 wrangler.toml 不入库）
│   └── test-*.mjs          # 冒烟测试
├── web/                    # 前端静态站点
│   ├── *.html              # 首页 / 动态 / 发消息 / 历史 / 激活 / 后台
│   └── assets/、admin/     # 页面对应的 JS/CSS
├── scripts/                # 迁移与运维脚本
│   ├── migrate-v*.sql      # D1 各版本幂等迁移
│   ├── migrate.mjs         # 旧系统数据导入
│   └── deploy-server.py    # 服务器部署脚本（地址需自行修改）
├── deploy/                 # systemd / Caddy / cloudflared 部署样例
├── data/                   # 运行时数据（不入库，仅保留 .gitkeep）
├── PROJECT.md              # 面向使用者的超详细使用说明
├── 部署教程.md             # 面向部署者的完整部署教程
└── LICENSE                 # MIT
```

## 本地运行

要求 Node.js 20+（推荐 22）。

```bash
cd app
npm install
node src/node.js
# 默认 http://127.0.0.1:8787
```

运行冒烟测试：`node test-smoke.mjs`（测试脚本中的万能码通过环境变量 `MASTER_CODE` 传入）。

## 部署

- 完整图文教程见 [《部署教程.md》](./部署教程.md)
- 家用服务器（systemd / Caddy / cloudflared tunnel）样例见 [`deploy/`](./deploy)
- 备用站（Worker + D1 + R2）：
  ```bash
  cd app
  cp wrangler.example.toml wrangler.toml   # 填入你自己的 database_id / 域名
  wrangler d1 create class-points-db
  wrangler secret put SYNC_SECRET
  wrangler deploy
  ```

## 安全须知（自部署前务必修改）

1. **默认密码**：首次启动后请立即修改教师 / 超管账号默认密码。
2. **万能激活码**：代码默认值仅为占位符，必须通过环境变量 `MASTER_CODE` 覆盖（systemd 推荐 `EnvironmentFile`）。
3. **同步密钥**：主站与 Worker 的 `SYNC_SECRET` 必须一致，用 `openssl rand -hex 32` 生成，不要写进任何入库文件。
4. `wrangler.toml`、`data/config.json` 等含真实标识的文件已被 `.gitignore` 排除。

## 文档

- [PROJECT.md](./PROJECT.md) —— 使用说明书（面向班主任）
- [部署教程.md](./部署教程.md) —— 从零到上线的部署教程

## 许可

[MIT License](./LICENSE)
