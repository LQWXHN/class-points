// v5.1 站点健康探测（内存表，node 进程内）
// 每 60s GET {url}/api/public/bootstrap，记录在线/延迟/instance
// WxPusher 推送 url 与同步 peerUrl 取第一个「在线且公网」的站点
const health = new Map(); // url -> { online, latency, instance, checkedAt }

function isPrivate(url) {
  try {
    const h = new URL(url).hostname;
    return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/.test(h);
  } catch { return true; }
}

export function getSiteHealth() {
  return Object.fromEntries(health);
}

export async function probeSite(url) {
  const started = Date.now();
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch(url.replace(/\/$/, '') + '/api/public/bootstrap', {
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json().catch(() => ({}));
    health.set(url, {
      online: true,
      latency: Date.now() - started,
      instance: j.instance || '',
      checkedAt: Date.now(),
    });
  } catch (e) {
    health.set(url, { online: false, latency: Date.now() - started, instance: '', checkedAt: Date.now() });
  }
}

export async function probeAll(sites) {
  if (!Array.isArray(sites)) return;
  await Promise.all(sites.map(s => s && s.url ? probeSite(s.url) : Promise.resolve()));
}

// 选第一个「在线且公网」的站点 url
export function pickPublicOnline() {
  for (const [url, h] of health) {
    if (h.online && !isPrivate(url)) return url.replace(/\/$/, '');
  }
  return '';
}

// 选第一个「在线且 instance 不等于自身」的站点（用于同步 peerUrl）
export function pickPeerOnline(selfInstance) {
  for (const [url, h] of health) {
    if (h.online && h.instance && h.instance !== selfInstance) return url.replace(/\/$/, '');
  }
  return '';
}

export function startProbeLoop(getSites, intervalMs = 60000) {
  const tick = async () => {
    try {
      const sites = await getSites();
      await probeAll(sites);
    } catch (e) { console.error('[sites-health]', e.message); }
    setTimeout(tick, intervalMs);
  };
  tick();
}
