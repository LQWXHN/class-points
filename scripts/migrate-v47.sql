-- v4.7 幂等迁移：删除聊天/IM 模块（v4.4~v4.6 引入）
-- 适用于 Cloudflare D1。主站 node 端由 migrateV47(db) 在启动时同步执行，本文件仅用于 D1 远程一次性执行。

DROP TABLE IF EXISTS chat_reads;
DROP TABLE IF EXISTS chat_stickers;
DROP TABLE IF EXISTS chat_favorites;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS chat_messages;

-- 删除聊天相关 config 键（含 PWA VAPID 密钥，已无消费者）
DELETE FROM admin_config WHERE key IN
  ('chat_notice','chat_sensitive_words','front_account_name','front_account_avatar',
   'vapid_public_key','vapid_private_key');

-- 清理残留同步事件
DELETE FROM sync_events WHERE tbl IN
  ('chat_messages','chat_favorites','chat_stickers','chat_reads','push_subscriptions');

-- 系统版本号
UPDATE admin_config SET value='v4.7（2026-10-18）' WHERE key='system_version';
INSERT INTO admin_config (key, value, updated_at)
  SELECT 'system_version', 'v4.7（2026-10-18）', 0
  WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE key='system_version');
