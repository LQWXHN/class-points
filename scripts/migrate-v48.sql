-- v4.8 幂等迁移：
--   1) 双周榜口径改为「期末小组平均分 − 期初小组平均分」，旧公式写入的缓存作废（纯缓存，可重算）
--   2) 新增"弹窗背景模糊"开关 modal_blur_enabled，默认 '1'（开）
-- 适用于 Cloudflare D1。主站 node 端由 migrateV48(db) 在启动时同步执行，本文件仅用于 D1 远程一次性执行。

-- 1. 作废旧双周榜缓存
DELETE FROM rank_snapshots WHERE kind='biweekly';

-- 2. 弹窗背景模糊开关（默认开）
INSERT INTO admin_config (key, value, updated_at)
  SELECT 'modal_blur_enabled', '1', 0
  WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE key='modal_blur_enabled');

-- 3. 小组头像列（D1 不支持 ADD COLUMN IF NOT EXISTS，重复执行报错可忽略；node 端启动迁移幂等）
ALTER TABLE groups ADD COLUMN avatar TEXT NOT NULL DEFAULT '';

-- 4. 规则 sort_order 列（v4.8 拖拽排序；同上，重复执行报错可忽略）
ALTER TABLE point_rules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 5. 系统版本号
UPDATE admin_config SET value='v4.8（2026-10-24）' WHERE key='system_version';
INSERT INTO admin_config (key, value, updated_at)
  SELECT 'system_version', 'v4.8（2026-10-24）', 0
  WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE key='system_version');
