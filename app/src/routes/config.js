import { Hono } from 'hono';
import { verifyUser, getConfig, setConfig } from './_helpers.js';

// 内置默认段位规则（31 级，逐字沿用旧 TIERS，仅取 name+min；上限由下一段 min 推导）
export const DEFAULT_TIER_RULES = [
  { name: '青铜III', min: 0 },
  { name: '青铜II', min: 100 },
  { name: '青铜I', min: 200 },
  { name: '白银III', min: 300 },
  { name: '白银II', min: 400 },
  { name: '白银I', min: 500 },
  { name: '黄金IV', min: 600 },
  { name: '黄金III', min: 700 },
  { name: '黄金II', min: 800 },
  { name: '黄金I', min: 900 },
  { name: '铂金IV', min: 1000 },
  { name: '铂金III', min: 1100 },
  { name: '铂金II', min: 1200 },
  { name: '铂金I', min: 1300 },
  { name: '钻石V', min: 1400 },
  { name: '钻石IV', min: 1600 },
  { name: '钻石III', min: 1800 },
  { name: '钻石II', min: 2000 },
  { name: '钻石I', min: 2200 },
  { name: '星耀V', min: 2400 },
  { name: '星耀IV', min: 2650 },
  { name: '星耀III', min: 2900 },
  { name: '星耀II', min: 3150 },
  { name: '星耀I', min: 3400 },
  { name: '最强王者', min: 3650 },
  { name: '非凡王者', min: 4000 },
  { name: '无双王者', min: 5000 },
  { name: '绝世王者', min: 6000 },
  { name: '至圣王者', min: 7000 },
  { name: '荣耀王者', min: 8000 },
  { name: '传奇王者', min: 9000 },
];

// 严格校验：数组长度 2..60、name 非空、min 为整数且严格递增、首个 min=0
export function validateTierRules(input) {
  if (!Array.isArray(input)) return '段位规则必须是数组';
  if (input.length < 2 || input.length > 60) return '段位数量需在 2..60 之间';
  for (let i = 0; i < input.length; i++) {
    const t = input[i];
    if (!t || typeof t !== 'object') return '段位项格式错误';
    if (!String(t.name || '').trim()) return `第 ${i + 1} 段名称不能为空`;
    if (!Number.isInteger(t.min)) return `第 ${i + 1} 段最低分必须是整数`;
    if (i === 0 && t.min !== 0) return '首段最低分必须为 0';
    if (i > 0 && t.min <= input[i - 1].min) return `第 ${i + 1} 段最低分必须严格大于上一段`;
  }
  return null;
}

export function configRoutes() {
  const app = new Hono();

  app.get('/config', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const rows = await db.all('SELECT key, value FROM admin_config');
    const cfg = {};
    for (const r of rows) {
      if (r.key === 'password_hash' || r.key === 'password_salt') continue;
      if (r.key === 'vapid_private_key') continue; // 对所有调用方隐藏私钥
      if (r.key === 'resend_api_key') {
        const v = r.value || '';
        cfg.has_resend_key = v ? '1' : '0';
        cfg.resend_api_key_masked = v ? (v.slice(0, 10) + '••••••' + v.slice(-4)) : '';
      } else {
        cfg[r.key] = r.value;
      }
    }
    // 未配置 tier_rules 时回显内置默认（JSON 字符串）
    if (!cfg.tier_rules) cfg.tier_rules = JSON.stringify(DEFAULT_TIER_RULES);
    return c.json({ ok: true, data: cfg });
  });

  app.put('/config', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const updates = await c.req.json().catch(() => ({}));
    // v4.5：backup 端（worker）不允许写外观类配置（站点/显示/双周开关），必须在主站修改
    const APPEARANCE_KEYS = new Set(['sites', 'ext_links', 'biweekly_rank_enabled', 'modal_blur_enabled', 'system_version', 'site_title']);
    const isBackup = c.get('origin') === 'worker';
    for (const [k, v] of Object.entries(updates)) {
      if (isBackup && APPEARANCE_KEYS.has(k)) {
        return c.json({ ok: false, error: '请在主站修改站点/显示配置' }, 403);
      }
      if (k === 'password_hash' || k === 'password_salt') continue;
      // vapid_private_key 不允许通过 API 修改（自动生成）
      if (k === 'vapid_private_key') continue;
      if (k === 'tier_rules') {
        let parsed = v;
        if (typeof v === 'string') { try { parsed = JSON.parse(v); } catch { return c.json({ ok: false, error: 'tier_rules 不是合法 JSON' }, 400); } }
        const err = validateTierRules(parsed);
        if (err) return c.json({ ok: false, error: err }, 400);
        await setConfig(db, k, JSON.stringify(parsed));
        continue;
      }
      if (k === 'biweekly_rank_enabled') {
        if (me.role !== 'super') return c.json({ ok: false, error: '双周排行开关仅超管可改' }, 403);
        const s = String(v);
        if (s !== '0' && s !== '1') return c.json({ ok: false, error: 'biweekly_rank_enabled 必须为 0 或 1' }, 400);
        await setConfig(db, k, s);
        continue;
      }
      if (k === 'modal_blur_enabled') {
        const s = String(v);
        if (s !== '0' && s !== '1') return c.json({ ok: false, error: 'modal_blur_enabled 必须为 0 或 1' }, 400);
        await setConfig(db, k, s);
        continue;
      }
      if (k === 'sites') {
        if (me.role !== 'super') return c.json({ ok: false, error: '站点配置仅超管可改' }, 403);
        let arr = v;
        if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return c.json({ ok: false, error: 'sites 不是合法 JSON 数组' }, 400); } }
        if (!Array.isArray(arr)) return c.json({ ok: false, error: 'sites 必须是数组' }, 400);
        if (!arr.length) return c.json({ ok: false, error: '至少保留 1 个站点' }, 400);
        await setConfig(db, k, JSON.stringify(arr));
        continue;
      }
      if (k === 'ext_links') {
        let obj = v;
        if (typeof v === 'string') { try { obj = JSON.parse(v); } catch { return c.json({ ok: false, error: 'ext_links 不是合法 JSON' }, 400); } }
        if (typeof obj !== 'object' || Array.isArray(obj)) return c.json({ ok: false, error: 'ext_links 必须是对象' }, 400);
        await setConfig(db, k, JSON.stringify(obj));
        continue;
      }
      await setConfig(db, k, v);
    }
    return c.json({ ok: true });
  });

  return app;
}
