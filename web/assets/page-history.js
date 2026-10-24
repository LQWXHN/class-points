/* /history.html 历史记录与导出 */
'use strict';
const $ = id => document.getElementById(id);
const LIMIT = 50;

const state = {
  type: 'all', kw: '', start: '', end: '',
  list: [], offset: 0, total: 0, loading: false, hasMore: true
};

function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function weekStart(ms) { // 本地自然周，周一为始
  const d = new Date(dayStart(ms));
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
function monthStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }

function buildQuery(reset) {
  if (reset) { state.offset = 0; state.list = []; state.hasMore = true; }
  const p = new URLSearchParams();
  p.set('limit', LIMIT);
  p.set('offset', state.offset);
  if (state.start) p.set('start', state.start);
  if (state.end) p.set('end', state.end);
  if (state.type !== 'all') p.set('type', state.type);
  if (state.kw) p.set('kw', state.kw);
  return p;
}

function parseRecordsResp(d) {
  if (!d) return { list: [], total: 0 };
  if (Array.isArray(d)) return { list: d, total: d.length };
  if (d.data && Array.isArray(d.data.list)) return { list: d.data.list, total: d.data.total != null ? d.data.total : d.data.list.length };
  if (Array.isArray(d.data)) return { list: d.data, total: d.total != null ? d.total : d.data.length };
  if (Array.isArray(d.list)) return { list: d.list, total: d.total != null ? d.total : d.list.length };
  return { list: [], total: 0 };
}

let lastSig = '';
async function load(reset) {
  if (state.loading) return;
  state.loading = true;
  setLoadState(reset ? '加载中…' : '加载更多…');
  try {
    const d = await CP.api('/records?' + buildQuery(reset).toString());
    const { list, total } = parseRecordsResp(d);
    if (reset) state.list = list; else state.list = state.list.concat(list);
    state.total = total;
    state.offset = state.list.length;
    state.hasMore = state.list.length < total;
    const sig = JSON.stringify(state.list.map(r => [r.id, r.points, r.operator, r.created_at])) + '|' + state.total;
    if (reset && sig === lastSig) { state.loading = false; return; } // 签名未变不重绘
    lastSig = sig;
  } catch (e) {
    CP.failToast(e, '加载失败');
    state.hasMore = false;
  }
  state.loading = false;
  render();
}

function typeChip(r) {
  if (r.type === 'add') return '<span class="type-chip" style="background:var(--green-soft);color:var(--green)">加分</span>';
  if (r.type === 'sub') return '<span class="type-chip" style="background:var(--red-soft);color:var(--red)">扣分</span>';
  return '<span class="type-chip" style="background:var(--fill);color:var(--text-2)">系统</span>';
}
function ptHTML(r) {
  const p = Number(r.points);
  if (r.type === 'sub') return `<span class="pt-sub">${p > 0 ? '-' : ''}${Math.abs(p)}</span>`;
  if (r.type === 'add') return `<span class="pt-add">+${p}</span>`;
  return `<span class="pt-sys">${p > 0 ? '+' : ''}${p}</span>`;
}

function rowHTML(r) {
  return `<tr>
    <td>${CP.esc(r.student_name || '-')}</td>
    <td class="text-2">${CP.esc(r.group_name || '未分组')}</td>
    <td>${typeChip(r)}</td>
    <td class="text-2">${CP.esc(r.reason || '-')}</td>
    <td style="text-align:right">${ptHTML(r)}</td>
    <td class="text-2">${CP.esc(r.operator || 'device')}</td>
    <td class="text-2 nowrap">${CP.fmtTime(r.created_at, true)}</td>
  </tr>`;
}

function render() {
  const $tc = document.getElementById('total-count'); if ($tc) $tc.textContent = state.total;
  // 桌面表格
  const tb = document.getElementById('tbody');
  if (tb) tb.innerHTML = state.list.length
    ? state.list.map(rowHTML).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:30px">暂无记录</td></tr>';
  // 移动卡片
  const mc = document.getElementById('mobile-cards');
  if (mc) mc.innerHTML = state.list.length ? state.list.map(r => `
    <div class="card mrec fade-in">
      <div class="mrec-top">
        <div>
          <div class="mrec-name">${CP.esc(r.student_name || '-')}</div>
          <div class="mrec-sub">${CP.esc(r.group_name || '未分组')} · ${CP.esc(r.operator || 'device')}</div>
        </div>
        ${ptHTML(r)}
      </div>
      <div class="mrec-reason">${typeChip(r)} ${CP.esc(r.reason || '-')}</div>
      <div class="mrec-foot"><span></span><span>${CP.fmtTime(r.created_at, true)}</span></div>
    </div>`).join('')
    : '<div class="empty"><i class="fas fa-clipboard-list"></i><p>暂无记录</p></div>';
  // 加载更多
  const lm = document.getElementById('load-more');
  if (lm) { lm.style.display = state.hasMore ? '' : 'none'; lm.disabled = state.loading; }
  setLoadState(state.list.length ? `已加载 ${state.list.length} / ${state.total}` : '');
}
function setLoadState(t) {
  const el = $('#load-state'); if (el) el.textContent = t;
}

/* ---------- 筛选 ---------- */
function setType(t, fromUrl) {
  state.type = t;
  document.querySelectorAll('#type-seg button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  if (!fromUrl) {
    const u = new URL(location.href);
    if (t === 'all') u.searchParams.delete('type'); else u.searchParams.set('type', t);
    history.replaceState(null, '', u.toString());
  }
  load(true);
}
function quickRange(kind) {
  const now = Date.now();
  let s = '', e = '';
  if (kind === 'today') { s = CP.fmtDate(dayStart(now)); e = CP.fmtDate(now); }
  else if (kind === 'week') { s = CP.fmtDate(weekStart(now)); e = CP.fmtDate(now); }
  else if (kind === 'month') { s = CP.fmtDate(monthStart(now)); e = CP.fmtDate(now); }
  else { s = ''; e = ''; }
  state.start = s; state.end = e;
  $('f-start').value = s; $('f-end').value = e;
  document.querySelectorAll('.quick-chip').forEach(c => c.classList.toggle('active', c.dataset.q === kind));
  load(true);
}

/* ---------- 导出 ---------- */
function openExport() {
  // 默认本月
  const now = Date.now();
  const ds = CP.fmtDate(monthStart(now)), de = CP.fmtDate(now);
  const box = CP.modal(`
    <h3><i class="fas fa-file-export" style="color:var(--primary);margin-right:7px"></i>导出积分记录</h3>
    <p class="text-2" style="margin:0 0 14px">选择时间范围，导出为 CSV 文件</p>
    <div class="form-row"><label class="form-label">起始日期</label>
      <input type="date" id="ex-start" class="form-input" value="${ds}"></div>
    <div class="form-row"><label class="form-label">结束日期</label>
      <input type="date" id="ex-end" class="form-input" value="${de}"></div>
    <div class="form-row" style="display:flex;gap:7px;flex-wrap:wrap">
      <button class="chip quick-chip" data-q="today">今天</button>
      <button class="chip quick-chip" data-q="week">本周</button>
      <button class="chip quick-chip active" data-q="month">本月</button>
      <button class="chip quick-chip" data-q="all">全部</button>
    </div>
    <p id="ex-count" class="form-hint" style="margin-bottom:6px">将按所选范围导出记录</p>
    <div class="modal-foot">
      <button class="btn" data-act="cancel">取消</button>
      <button class="btn btn-primary" data-act="ok"><i class="fas fa-download"></i> 导出 CSV</button>
    </div>`, { size: 'sm' });
  box.querySelectorAll('.quick-chip').forEach(c => c.onclick = () => {
    const kind = c.dataset.q;
    const now = Date.now();
    let s = '', e = '';
    if (kind === 'today') { s = CP.fmtDate(dayStart(now)); e = CP.fmtDate(now); }
    else if (kind === 'week') { s = CP.fmtDate(weekStart(now)); e = CP.fmtDate(now); }
    else if (kind === 'month') { s = CP.fmtDate(monthStart(now)); e = CP.fmtDate(now); }
    box.querySelector('#ex-start').value = s; box.querySelector('#ex-end').value = e;
    box.querySelectorAll('.quick-chip').forEach(x => x.classList.toggle('active', x === c));
    previewCount(box);
  });
  box.querySelector('#ex-start').onchange = () => previewCount(box);
  box.querySelector('#ex-end').onchange = () => previewCount(box);
  box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
  box.querySelector('[data-act=ok]').onclick = () => doExport(box);
  previewCount(box);
}
async function previewCount(box) {
  const s = box.querySelector('#ex-start').value, e = box.querySelector('#ex-end').value;
  const hint = box.querySelector('#ex-count');
  try {
    const p = new URLSearchParams({ limit: 1, offset: 0 });
    if (s) p.set('start', s); if (e) p.set('end', e);
    const d = await CP.api('/records?' + p.toString());
    const { total } = parseRecordsResp(d);
    hint.textContent = `将导出 ${total} 条记录`;
  } catch (e) { hint.textContent = '将按所选范围导出记录'; }
}
async function doExport(box) {
  const s = box.querySelector('#ex-start').value, e = box.querySelector('#ex-end').value;
  const btn = box.querySelector('[data-act=ok]');
  btn.disabled = true;
  try {
    const p = new URLSearchParams();
    if (s) p.set('start', s); if (e) p.set('end', e);
    const res = await CP.api('/export/records?' + p.toString(), { raw: true });
    const text = (res.data && res.data.rawText) || (typeof res.data === 'string' ? res.data : '');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `积分记录_${s || 'start'}_${e || 'end'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    CP.toast('导出成功', 'success');
    CP.closeModal();
  } catch (err) {
    CP.failToast(err, '导出失败');
  } finally { btn.disabled = false; }
}

/* ---------- 事件 ---------- */
function bind() {
  document.querySelectorAll('#type-seg button').forEach(b => b.onclick = () => setType(b.dataset.t));
  $('f-kw').addEventListener('input', function () { state.kw = this.value.trim(); clearTimeout(this._t); this._t = setTimeout(() => load(true), 300); });
  $('f-start').onchange = function () { state.start = this.value; load(true); };
  $('f-end').onchange = function () { state.end = this.value; load(true); };
  document.querySelectorAll('.quick-chip').forEach(c => c.onclick = () => quickRange(c.dataset.q));
  $('load-more').onclick = () => load(false);
  $('btn-export').onclick = openExport;
  $('btn-back').onclick = () => {
    const from = CP.qs('from');
    const referer = document.referrer || '';
    location.href = (from === 'admin' || referer.includes('/admin/')) ? '/admin/' : '/index.html';
  };
}

(async function init() {
  CP.applyTitle('历史记录');
  const ok = await CP.requireDevice();
  if (!ok) return;
  bind();
  const initType = new URLSearchParams(location.search).get('type');
  if (['all', 'add', 'sub', 'system'].includes(initType)) {
    setType(initType, true);
  } else {
    await load(true);
  }
  // 仅在第一页（未翻页）且导出弹窗未打开时自动刷新
  CP.poll(async () => {
    if (state.offset > 0) return;
    const anyModal = document.querySelector('.modal-back.show');
    if (anyModal) return;
    await load(true);
  }, 5000);
})();
