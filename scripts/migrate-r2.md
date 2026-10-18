# R2 附件与备份文件迁移（v3 → v4 迁移第 2 步）

旧桶 `class-points-backup` 里有两类对象：



| 前缀         | 内容         | v4 家里主站落点       | v4 CF 备用站落点          |
| ---------- | ---------- | --------------- | -------------------- |
| `uploads/` | 动态附件（图片等）  | `data/uploads/` | R2 key `uploads/...` |
| `backups/` | 自动 / 手动备份包 | `data/backups/` | R2 key `backups/...` |

> v4 不换桶（新架构仍绑定 
>
> `class-points-backup`
>
> ），所以 
>
> **R2 里的对象本身不用动**
>
> ，
> 只需要把它们从旧环境同步一份到家里主站的磁盘。如果将来要换新桶，见文末「迁移到新桶」。

## 0. 前置：确认 wrangler 已登录



```
wrangler whoami   # 未登录则 wrangler login
```

## 1. 批量下载到家里主站磁盘（推荐用封装脚本）

在**家里 Linux 主站**（或你的 Windows 电脑下载后再 scp 上去）执行：



```
# bash 版（家里 Linux）
bash scripts/migrate-r2.sh download --bucket=class-points-backup --dest=data
```



```
# PowerShell 版（Windows）
.\scripts\migrate-r2.ps1 download -Bucket class-points-backup -Dest data
```

脚本会列出桶内对象，并逐个 `wrangler r2 object get` 下载，保持目录结构：



```
data/
  uploads/   ← 旧 uploads/ 全部对象
  backups/    ← 旧 backups/ 全部对象
```

### 手动等价命令（对象少时）



```
# 列对象
wrangler r2 object get class-points-backup/uploads/   # 前缀不能直接列，用 rclone 更方便
```

`wrangler r2 object` 没有「按前缀批量 get」，批量场景推荐 **rclone**：



```
# 安装 rclone（Linux）
curl https://rclone.org/install.sh | sudo bash

# 配置（选 Cloudflare R2，填 API Token + S3 endpoint）
rclone config
# 之后一条命令同步：
rclone copy class-points-backup:class-points-backup/uploads ./data/uploads --progress
rclone copy class-points-backup:class-points-backup/backups ./data/backups --progress
```

## 2. 校验下载完整性



```
# 对照对象数
rclone lsf class-points-backup:class-points-backup/uploads | wc -l
ls data/uploads | wc -l
```

## 3. 如果 v4 换了新桶（可选）



```
# 1) 建桶（在 CF 控制台或 wrangler）
wrangler r2 bucket create class-points-backup-v4

# 2) 桶内整体拷贝（rclone 最快）
rclone copy class-points-backup:class-points-backup class-points-backup-v4:class-points-backup-v4 --progress

# 3) 改 app/wrangler.toml 里的 bucket_name 为新桶名，并在 Node 端 config 里改目录映射
```

## 4. 与数据库迁移的关系



* 数据库里 `announcements.file_url` 仍指向 `/api/file/uploads/xxx`，文件下载到位后链接即可打开。

* `backup_log` 表里记录的是备份包元信息，包本体在 `data/backups/`。

* R2 迁移**不需要停机**：随时可跑；跑两遍也幂等（同名对象覆盖）。