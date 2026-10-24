/* /new.html 班级动态（v4.2）：最近消息(本周/上周/本月直达) + 历史消息(发布者→年→月→日) + 分类筛选 + 服务端已读 + Markdown 详情 */
'use strict';
const $ = id => document.getElementById(id);
const DAY = 864e5;

let items = [];
let kw = '';
let mode = 'browse'; // browse | search
const nav = { level: 1, author: null, year: null, month: null, day: null, item: null, time: null, cat: '全部' };
function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function weekStart(ms) { const d = new Date(dayStart(ms)); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.getTime(); }
function monthStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }

function inScope(a) {
  const ms = Number(a.created_at) || 0;
  const now = Date.now();
  if (nav.author && a.author !== nav.author) return false;
  if (nav.time === 'thisWeek') return ms >= weekStart(now);
  if (nav.time === 'lastWeek') { const ws = weekStart(now); return ms >= ws - DAY * 7 && ms < ws; }
  if (nav.time === 'thisMonth') return ms >= monthStart(now);
  return true;
}
function scoped() { return items.filter(inScope).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)); }

/* ---------- 搜索：标题 / 正文 / 日期 ---------- */
function dateVariants(ms) {
  const d = new Date(Number(ms) || 0);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const p2 = n => String(n).padStart(2, '0');
  return [
    `${y}-${p2(m)}-${p2(day)}`, `${y}/${p2(m)}/${p2(day)}`, `${y}.${p2(m)}.${p2(day)}`,
    `${y}年${m}月${day}日`, `${y}年${m}月${day}号`, `${y}年${m}月`,
    `${p2(m)}-${p2(day)}`, `${p2(m)}/${p2(day)}`,
    `${m}月${day}日`, `${m}月${day}号`, `${m}月${day}`,
    String(y), `${y}年`
  ];
}
function matchItem(a, q) {
  const hay = `${a.title || ''}\n${a.content || ''}\n${dateVariants(a.created_at).join(' ')}`.toLowerCase();
  return hay.includes(q);
}
function stripMd(s) {
  return CP.esc(String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ').replace(/\s+/g, ' ').trim());
}
function snippetOf(a, q) {
  const raw = stripMd(a.content);
  if (!raw) return '';
  const i = raw.toLowerCase().indexOf(q);
  if (i < 0 || !q) return raw.slice(0, 70);
  const start = Math.max(0, i - 18), end = Math.min(raw.length, i + q.length + 52);
  return (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
}
function viewSearch() {
  const q = kw.trim().toLowerCase();
  if (!q) { mode = 'browse'; nav.level = 1; return viewHome(); }
  const list = items.filter(a => matchItem(a, q)).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (!list.length) return `<div class="empty"><i class="fas fa-magnifying-glass"></i><p>没有找到与「${CP.esc(kw.trim())}」相关的通知</p></div>`;
  return `<div class="sec-title">搜索结果 · ${list.length} 条</div>` + list.map(a => `
    <div class="card msg-card" data-detail="${a.uid || a.id}">
      <div class="msg-head">
        ${authorAvatar(a.author || '匿名')}
        <div style="flex:1;min-width:0">
          <div class="msg-author">${CP.esc(a.author || '匿名')}${editedBadge(a)}</div>
          <div class="msg-time">${CP.fmtTime(a.created_at, true)}</div>
        </div>
        ${CP.isAnnRead(a) ? '' : '<span class="msg-unread-dot"></span>'}
      </div>
      <div class="msg-title">${CP.esc(a.title)}${a.file_url ? '<i class="fas fa-paperclip msg-file-ic"></i>' : ''}</div>
      ${snippetOf(a, q) ? `<div class="msg-snippet">${snippetOf(a, q)}</div>` : ''}
    </div>`).join('');
}
function bindSearch() {
  const input = $('ann-search');
  const clear = $('ann-search-clear');
  if (!input) return;
  let t = null;
  input.addEventListener('input', () => {
    const v = input.value.trim();
    clear.style.display = v ? '' : 'none';
    clearTimeout(t);
    t = setTimeout(() => {
      kw = input.value;
      if (v) { mode = 'search'; nav.level = 1; nav.item = null; }
      else { mode = 'browse'; nav.level = 1; nav.item = null; }
      render();
    }, 180);
  });
  clear.addEventListener('click', () => {
    input.value = ''; kw = ''; clear.style.display = 'none';
    mode = 'browse'; nav.level = 1; nav.item = null;
    render(); input.focus();
  });
}

const AV_COLORS = ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#5856d6'];
function authorColor(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function authorAvatar(name) {
  const n = String(name || '匿名');
  return `<span class="author-av" style="background:${authorColor(n)}">${CP.esc(n.slice(0, 1).toUpperCase())}</span>`;
}
function isImage(a) {
  const t = String(a.file_type || '').toLowerCase();
  const n = String(a.file_name || '').toLowerCase();
  return t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n);
}
function editedBadge(a) {
  if (!a.edited) return '';
  const t = a.updated_at ? CP.fmtTime(a.updated_at, true) : '';
  return `<span class="edited-badge" title="编辑于 ${t}">已编辑${t ? ' · ' + t : ''}</span>`;
}

/* ---------- 未读角标 ---------- */
function renderBadge() {
  const b = $('new-badge');
  if (!b) return;
  const unread = items.filter(a => !CP.isAnnRead(a)).length;
  b.style.display = unread > 0 ? '' : 'none';
  b.textContent = unread > 99 ? '99+' : unread;
}

/* ---------- 面包屑 ---------- */
const BUCKET_NAME = { thisWeek: '本周消息', lastWeek: '上周消息', thisMonth: '本月消息' };
function renderCrumb() {
  const c = $('crumb');
  const parts = [{ label: '首页', go: () => goHome() }];
  if (mode === 'search' && nav.level !== 6) parts.push({ label: `搜索“${kw.trim()}”`, go: null });
  if (nav.level === 6 && mode === 'search') parts.push({ label: `搜索“${kw.trim()}”`, go: () => backToSearch() });
  if (nav.level >= 2 && nav.author) parts.push({ label: nav.author, go: () => goYears() });
  if (nav.level >= 2 && nav.year != null && nav.author) parts.push({ label: nav.year + '年', go: () => goYears() });
  if (nav.level >= 3 && nav.year != null) parts.push({ label: nav.year + '年', go: () => goYears() });
  if (nav.level >= 4 && nav.month != null) parts.push({ label: (nav.month + 1) + '月', go: () => goMonths(nav.year) });
  if (nav.level >= 5 && nav.day != null) parts.push({ label: nav.month + 1 + '月' + nav.day + '日', go: () => goDays(nav.year, nav.month) });
  if (nav.level === 5 && nav.time) parts.push({ label: BUCKET_NAME[nav.time] || '', go: null });
  if (nav.level >= 6 && nav.item) parts.push({ label: '详情', go: null });
  c.innerHTML = parts.map((p, i) =>
    (i ? '<span class="sep">/</span>' : '') +
    (p.go ? `<a data-crumb="${i}">${CP.esc(p.label)}</a>` : `<span>${CP.esc(p.label)}</span>`)
  ).join('');
  c.querySelectorAll('[data-crumb]').forEach(a => a.onclick = () => parts[Number(a.dataset.crumb)].go());
}

/* ---------- 渲染 ---------- */
function render() {
  renderCrumb();
  renderBadge();
  const v = $('view');
  v.className = 'fade-in';
  if (nav.level === 6) v.innerHTML = viewDetail();
  else if (mode === 'search') v.innerHTML = viewSearch();
  else if (nav.level === 1) v.innerHTML = viewHome();
  else if (nav.level === 2) v.innerHTML = viewYears();
  else if (nav.level === 3) v.innerHTML = viewMonths();
  else if (nav.level === 4) v.innerHTML = viewDays();
  else if (nav.level === 5) v.innerHTML = viewList();
  bindView(v);
}

/* L1 首页：区块一最近消息三卡 + 区块二历史消息发布者卡 */
function viewHome() {
  if (!items.length) return '<div class="empty"><i class="fas fa-bullhorn"></i><p>暂无班级动态</p></div>';
  const base = items;
  const now = Date.now();
  const buckets = [
    { key: 'thisWeek', name: '本周消息', ic: 'fa-calendar-week', color: '#007aff', test: a => Number(a.created_at) >= weekStart(now) },
    { key: 'lastWeek', name: '上周消息', ic: 'fa-calendar', color: '#ff9500', test: a => { const ws = weekStart(now); const ms = Number(a.created_at); return ms >= ws - DAY * 7 && ms < ws; } },
    { key: 'thisMonth', name: '本月消息', ic: 'fa-calendar-days', color: '#34c759', test: a => Number(a.created_at) >= monthStart(now) }
  ];
  let html = '<div class="sec-title">最近消息</div><div class="bucket-grid">';
  buckets.forEach(b => {
    const list = base.filter(b.test).sort((a, c) => (c.created_at || 0) - (a.created_at || 0));
    const latest = list[0] ? list[0].title : '暂无消息';
    html += `
      <div class="card bucket-card" data-bucket="${b.key}">
        <div class="bucket-ic" style="background:${b.color}1a;color:${b.color}"><i class="fas ${b.ic}"></i></div>
        <div class="bucket-name">${b.name}</div>
        <div class="bucket-count">${list.length} 条消息</div>
        <div class="bucket-latest">${CP.esc(latest)}</div>
      </div>`;
  });
  html += '</div>';
  // 发布者
  const byAuthor = {};
  base.forEach(a => { const k = a.author || '匿名'; (byAuthor[k] = byAuthor[k] || []).push(a); });
  const names = Object.keys(byAuthor);
  html += '<div class="sec-title">历史消息</div>';
  if (!names.length) html += '<div class="empty"><i class="fas fa-inbox"></i><p>暂无内容</p></div>';
  else {
    html += '<div class="author-grid">';
    Object.entries(byAuthor).sort((a, b) => b[1].length - a[1].length).forEach(([name, list]) => {
      html += `
        <div class="card author-card" data-author="${CP.esc(name)}">
          ${authorAvatar(name)}
          <div style="min-width:0">
            <div class="author-name">${CP.esc(name)}</div>
            <div class="author-count">${list.length} 条动态</div>
          </div>
        </div>`;
    });
    html += '</div>';
  }
  return html;
}

function viewYears() {
  const list = scoped();
  const years = {};
  list.forEach(a => { const y = new Date(a.created_at).getFullYear(); (years[y] = years[y] || []).push(a); });
  return gridTiles(Object.keys(years).sort().reverse(), y => `${y}年`, y => `${years[y].length} 条消息`, 'data-year');
}
function viewMonths() {
  const list = scoped();
  const map = {};
  list.forEach(a => { const d = new Date(a.created_at); if (d.getFullYear() === nav.year) { const m = d.getMonth(); (map[m] = map[m] || []).push(a); } });
  return gridTiles(Object.keys(map).map(Number).sort((a, b) => b - a), m => `${m + 1}月`, m => `${map[m].length} 条消息`, 'data-month');
}
function viewDays() {
  const list = scoped();
  const map = {};
  list.forEach(a => { const d = new Date(a.created_at); if (d.getFullYear() === nav.year && d.getMonth() === nav.month) { const dd = d.getDate(); (map[dd] = map[dd] || []).push(a); } });
  return gridTiles(Object.keys(map).map(Number).sort((a, b) => b - a), d => `${nav.month + 1}月${d}日`, d => `${map[d].length} 条消息`, 'data-day');
}
function gridTiles(keys, label, sub, attr) {
  if (!keys.length) return '<div class="empty"><i class="fas fa-inbox"></i><p>暂无内容</p></div>';
  return '<div class="tile-grid">' + keys.map(k => `
    <div class="card tile" ${attr}="${k}">
      <div class="big">${CP.esc(label(k))}</div>
      <div class="sub">${CP.esc(sub(k))}</div>
    </div>`).join('') + '</div>';
}

function viewList() { // L5：消息列表（时间桶 或 某日）
  let list = scoped();
  if (!nav.time) {
    list = list.filter(a => {
      const d = new Date(a.created_at);
      return d.getFullYear() === nav.year && d.getMonth() === nav.month && d.getDate() === nav.day;
    });
  }
  if (!list.length) return '<div class="empty"><i class="fas fa-inbox"></i><p>暂无消息</p></div>';
  return list.map(a => `
    <div class="card msg-card" data-detail="${a.uid || a.id}">
      <div class="msg-head">
        ${authorAvatar(a.author || '匿名')}
        <div style="flex:1;min-width:0">
          <div class="msg-author">${CP.esc(a.author || '匿名')}${editedBadge(a)}</div>
          <div class="msg-time">${CP.fmtTime(a.created_at, true)}</div>
        </div>
        ${CP.isAnnRead(a) ? '' : '<span class="msg-unread-dot"></span>'}
      </div>
      <div class="msg-title">${CP.esc(a.title)}${a.file_url ? '<i class="fas fa-paperclip msg-file-ic"></i>' : ''}</div>
    </div>`).join('');
}

function viewDetail() {
  const a = nav.item;
  if (!a) return '<div class="empty"><p>内容不存在</p></div>';
  const fileBlock = a.file_url ? `
    <div class="detail-file">
      <div style="width:38px;height:38px;border-radius:10px;background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center"><i class="fas ${isImage(a) ? 'fa-image' : 'fa-file'}"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${CP.esc(a.file_name || '附件')}</div>
        <div style="font-size:11.5px;color:var(--text-3)">${a.file_size ? (a.file_size / 1024).toFixed(1) + ' KB' : ''}</div>
      </div>
      <a class="btn btn-sm btn-primary" href="${CP.esc(a.file_url)}" download="${CP.esc(a.file_name || 'file')}"><i class="fas fa-download"></i>下载</a>
      ${isImage(a) ? `<img data-protect src="${CP.esc(a.file_url)}" alt="">` : ''}
    </div>` : '';
  return `<div class="card detail-card">
    <h1 class="detail-title">${CP.esc(a.title)}</h1>
    <div class="detail-meta">
      ${authorAvatar(a.author || '匿名')}
      <span class="badge">${CP.esc(a.author || '匿名')}</span>
      <span class="text-3" style="font-size:12.5px"><i class="far fa-clock"></i> ${CP.fmtTime(a.created_at, true)}</span>
      ${editedBadge(a)}
    </div>
    ${a.content ? `<div class="detail-body md-body">${CP.mdToHtml(a.content)}</div>` : ''}
    ${fileBlock}
  </div>`;
}

/* ---------- 视图跳转 ---------- */
function resetNav() {
  nav.level = 1; nav.time = null; nav.author = null; nav.year = null; nav.month = null; nav.day = null; nav.item = null;
}
function backToSearch() { nav.level = 1; nav.item = null; render(); }
function goHome() {
  resetNav(); mode = 'browse'; kw = '';
  const input = $('ann-search'), clear = $('ann-search-clear');
  if (input) input.value = '';
  if (clear) clear.style.display = 'none';
  render();
}
function goAuthors() { resetNav(); render(); }
function goYears() { nav.level = 2; nav.year = null; nav.month = null; nav.day = null; nav.item = null; render(); }
function goMonths(y) { nav.level = 3; nav.year = y; nav.month = null; nav.day = null; nav.item = null; render(); }
function goDays(y, m) { nav.level = 4; nav.year = y; nav.month = m; nav.day = null; nav.item = null; render(); }
function bindView(v) {
  v.querySelectorAll('[data-bucket]').forEach(el => el.onclick = () => { nav.time = el.dataset.bucket; nav.author = null; nav.level = 5; render(); });
  v.querySelectorAll('[data-author]').forEach(el => el.onclick = () => { nav.author = el.dataset.author; nav.time = null; goYears(); });
  v.querySelectorAll('[data-year]').forEach(el => el.onclick = () => goMonths(Number(el.dataset.year)));
  v.querySelectorAll('[data-month]').forEach(el => el.onclick = () => goDays(nav.year, Number(el.dataset.month)));
  v.querySelectorAll('[data-day]').forEach(el => el.onclick = () => { nav.level = 5; nav.day = Number(el.dataset.day); render(); });
  v.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => {
    const id = el.dataset.detail;
    const a = items.find(x => String(x.uid || x.id) === String(id));
    if (!a) return;
    nav.item = a; nav.level = 6; render();
    CP.markAnnRead(a);
  });
}

/* ---------- 数据 ---------- */
function parseList(d) {
  let arr = [];
  if (Array.isArray(d)) arr = d;
  else if (Array.isArray(d.data)) arr = d.data;
  else if (d.data && Array.isArray(d.data.list)) arr = d.data.list;
  return arr;
}
let lastSig = '';
async function refresh() {
  let d;
  try { d = await CP.api('/announcements'); } catch (e) { return; }
  const fresh = parseList(d);
  const sig = JSON.stringify(fresh.map(a => [a.uid, a.title, a.edited, a.updated_at, a.created_at]));
  if (sig !== lastSig) {
    items = fresh;
    lastSig = sig;
    if (nav.level === 6 && nav.item) {
      const f = items.find(x => String(x.uid || x.id) === String(nav.item.uid || nav.item.id));
      if (f) nav.item = f;
    }
    render();
  }
}

(async function init() {
  CP.applyTitle('班级动态');
  bindSearch();
  const ok = await CP.requireDevice();
  if (!ok) return;
  await CP.loadReadState();
  await refresh();
  CP.poll(refresh, 5000);
})();
