-- ============================================================
-- 班级积分系统 v4.3 迁移脚本（Cloudflare D1 端）
-- 双周榜锚点从 2026-10-01 调整为 2026-10-12（第 1 期 10-12 ~ 10-25）。
-- 旧锚点写入的 rank_snapshots 为纯缓存，删除后由首次请求确定性重算。
-- 幂等：DELETE 纯缓存，重复执行无副作用。
-- 执行方式：wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v43.sql
-- ============================================================

DELETE FROM rank_snapshots WHERE kind='biweekly';
