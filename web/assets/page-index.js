/* ============================================================
   /index.html 主页逻辑（班级积分系统 v4.0）
   ============================================================ */
'use strict';

/* 段位 TIERS（31 级，逐字自旧版搬迁，数值不得改动） */
const TIERS = [
  { name: '青铜III', min: 0, max: 99, order: 1, color: '#b45309', icon: 'fa-shield-halved', frame: 'avf-bronze' },
  { name: '青铜II', min: 100, max: 199, order: 2, color: '#b45309', icon: 'fa-shield-halved', frame: 'avf-bronze' },
  { name: '青铜I', min: 200, max: 299, order: 3, color: '#b45309', icon: 'fa-shield-halved', frame: 'avf-bronze' },
  { name: '白银III', min: 300, max: 399, order: 4, color: '#64748b', icon: 'fa-shield-halved', frame: 'avf-silver' },
  { name: '白银II', min: 400, max: 499, order: 5, color: '#64748b', icon: 'fa-shield-halved', frame: 'avf-silver' },
  { name: '白银I', min: 500, max: 599, order: 6, color: '#64748b', icon: 'fa-shield-halved', frame: 'avf-silver' },
  { name: '黄金IV', min: 600, max: 699, order: 7, color: '#b45309', icon: 'fa-medal', frame: 'avf-gold' },
  { name: '黄金III', min: 700, max: 799, order: 8, color: '#b45309', icon: 'fa-medal', frame: 'avf-gold' },
  { name: '黄金II', min: 800, max: 899, order: 9, color: '#b45309', icon: 'fa-medal', frame: 'avf-gold' },
  { name: '黄金I', min: 900, max: 999, order: 10, color: '#b45309', icon: 'fa-medal', frame: 'avf-gold' },
  { name: '铂金IV', min: 1000, max: 1099, order: 11, color: '#0e7490', icon: 'fa-award', frame: 'avf-platinum' },
  { name: '铂金III', min: 1100, max: 1199, order: 12, color: '#0e7490', icon: 'fa-award', frame: 'avf-platinum' },
  { name: '铂金II', min: 1200, max: 1299, order: 13, color: '#0e7490', icon: 'fa-award', frame: 'avf-platinum' },
  { name: '铂金I', min: 1300, max: 1399, order: 14, color: '#0e7490', icon: 'fa-award', frame: 'avf-platinum' },
  { name: '钻石V', min: 1400, max: 1599, order: 15, color: '#0891b2', icon: 'fa-gem', frame: 'avf-diamond' },
  { name: '钻石IV', min: 1600, max: 1799, order: 16, color: '#0891b2', icon: 'fa-gem', frame: 'avf-diamond' },
  { name: '钻石III', min: 1800, max: 1999, order: 17, color: '#0891b2', icon: 'fa-gem', frame: 'avf-diamond' },
  { name: '钻石II', min: 2000, max: 2199, order: 18, color: '#0891b2', icon: 'fa-gem', frame: 'avf-diamond' },
  { name: '钻石I', min: 2200, max: 2399, order: 19, color: '#0891b2', icon: 'fa-gem', frame: 'avf-diamond' },
  { name: '星耀V', min: 2400, max: 2649, order: 20, color: '#af52de', icon: 'fa-star', frame: 'avf-star' },
  { name: '星耀IV', min: 2650, max: 2899, order: 21, color: '#af52de', icon: 'fa-star', frame: 'avf-star' },
  { name: '星耀III', min: 2900, max: 3149, order: 22, color: '#af52de', icon: 'fa-star', frame: 'avf-star' },
  { name: '星耀II', min: 3150, max: 3399, order: 23, color: '#af52de', icon: 'fa-star', frame: 'avf-star' },
  { name: '星耀I', min: 3400, max: 3649, order: 24, color: '#af52de', icon: 'fa-star', frame: 'avf-star' },
  { name: '最强王者', min: 3650, max: 3999, order: 25, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '非凡王者', min: 4000, max: 4999, order: 26, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '无双王者', min: 5000, max: 5999, order: 27, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '绝世王者', min: 6000, max: 6999, order: 28, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '至圣王者', min: 7000, max: 7999, order: 29, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '荣耀王者', min: 8000, max: 8999, order: 30, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  { name: '传奇王者', min: 9000, max: 999999, order: 31, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' }
];
/* 运行时段位表：优先 snapshot.config.tier_rules，非法/缺失回退内置 TIERS */
let activeTiers = TIERS.slice();
function buildActiveTiers() {
  try {
    const tr = appData.config && appData.config.tier_rules;
    if (Array.isArray(tr) && tr.length >= 2 && tr.length <= 60) {
      const arr = tr.map(t => ({ name: String(t.name || '').trim(), min: Number(t.min) }));
      if (arr.every(t => t.name && Number.isInteger(t.min))) {
        arr.sort((a, b) => a.min - b.min);
        const strict = arr.every((t, i) => i === 0 || t.min > arr[i - 1].min);
        if (strict && arr[0].min === 0) {
          const palette = ['#b45309', '#64748b', '#b45309', '#0e7490', '#0891b2', '#af52de', '#ea580c'];
          activeTiers = arr.map((t, i) => {
            const builtin = TIERS.find(x => x.name === t.name);
            const nextMin = i + 1 < arr.length ? arr[i + 1].min - 1 : 999999;
            return {
              name: t.name, min: t.min, max: nextMin, order: i + 1,
              color: builtin ? builtin.color : palette[i % palette.length],
              icon: builtin ? builtin.icon : 'fa-shield-halved',
              frame: builtin ? builtin.frame : ''
            };
          });
          return;
        }
      }
    }
  } catch (e) { /* 非法回退 */ }
  activeTiers = TIERS.slice();
}
function tierOf(p) {
  const x = Math.max(0, p || 0);
  return activeTiers.find(t => x >= t.min && x <= t.max) || activeTiers[activeTiers.length - 1];
}

/* ---------- 状态 ---------- */
let appData = { students: [], groups: [], rules: [], announcements: [], config: {}, serverTime: 0 };
const ui = { tab: 'students', rank: 'individual', search: '', selected: new Set(), batchMode: false, recentRecords: [], biw: { data: null, history: [], historyMode: false, period: 'current' } };
let isOnline = navigator.onLine;

const $ = id => document.getElementById(id);

function getGroup(id) {
  const g = appData.groups.find(x => x.id === id);
  return g || { id: 0, name: '未分组', color: '#8e8e93' };
}
function groupTagHTML(s) {
  const g = getGroup(s.group_id);
  if (!g.id) {
    return `<span class="grp-tag" style="background:var(--fill);color:var(--text-3)"><span class="grp-dot" style="background:#8e8e93"></span>未分组</span>`;
  }
  const n = appData.groups.findIndex(x => x.id === g.id) + 1;
  return `<span class="grp-tag" style="background:${g.color}1a;color:${g.color}"><span class="grp-dot" style="background:${g.color}"></span>第${n}组 · ${CP.esc(g.name)}</span>`;
}
function metaLine(s) {
  const parts = [];
  if (s.student_no) parts.push('学号 ' + s.student_no);
  return parts.join(' · ');
}

/* ---------- 数据加载 ---------- */
function parseSnapshot(d) {
  const x = (d && d.data) ? d.data : (d || {});
  return {
    students: x.students || [], groups: x.groups || [], rules: x.rules || [],
    announcements: x.announcements || [], config: x.config || {}, serverTime: x.serverTime || 0
  };
}
let lastSig = '';
function dataSig() {
  return JSON.stringify([
    appData.students.map(s => [s.id, s.points, s.group_id, s.name, s.student_no]),
    appData.groups.map(g => [g.id, g.name, g.color, g.signature]),
    appData.rules.map(r => [r.reason, r.points, r.type]),
    appData.config.avatar_frame_cards, appData.config.avatar_frame_leaderboard, appData.config.avatar_frame_tier,
    appData.config.tier_rules,
    appData.announcements.length, appData.announcements.map(a => [a.uid, a.edited, a.updated_at]).join(',')
  ]);
}
async function refreshData() {
  try {
    const d = await CP.api('/snapshot');
    appData = parseSnapshot(d);
    isOnline = true;
    setConn(true);
  } catch (e) {
    isOnline = false;
    setConn(false);
  }
  buildActiveTiers();
  const sig = dataSig();
  const same = sig === lastSig;
  if (same) return; // 数据签名未变，完全不碰 DOM（保留搜索/选中/弹窗/滚动）
  lastSig = sig;
  renderStats();
  renderCards();
  renderRankings();
  renderBadge();
  loadRecentRecords();
}

async function loadRecentRecords() {
  try {
    const d = await CP.api('/records?limit=15');
    let list = [];
    if (Array.isArray(d)) list = d;
    else if (Array.isArray(d.data)) list = d.data;
    else if (d.data && Array.isArray(d.data.list)) list = d.data.list;
    ui.recentRecords = list;
    renderHistory();
  } catch (e) { /* 轮询静默 */ }
}

/* ---------- 连接状态 ---------- */
function setConn(on) {
  const dot = $('conn-dot'), txt = $('conn-text');
  if (!dot || !txt) return;
  dot.className = on ? 'dot-on' : 'dot-off';
  txt.textContent = on ? '已连接' : '离线';
}

/* ---------- 统计 ---------- */
function renderStats() {
  const t = appData.students.length;
  const g = appData.groups.length;
  const avg = t ? (appData.students.reduce((s, x) => s + (x.points || 0), 0) / t) : 0;
  const max = t ? Math.max.apply(null, appData.students.map(s => s.points || 0)) : 0;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  // 中栏顶部 4 项
  set('top-groups', g); set('top-students', t); set('top-avg', avg.toFixed(2)); set('top-max', max);
  // 左栏统计卡 4 项
  set('ls-groups', g); set('ls-students', t); set('ls-avg', avg.toFixed(2)); set('ls-max', max);
}

/* ---------- 未读角标 ---------- */
function renderBadge() {
  const n = CP.unreadCount(appData.announcements);
  const el = $('ann-badge');
  if (el) {
    el.textContent = n > 99 ? '99+' : String(n);
    el.style.display = n > 0 ? 'flex' : 'none';
  }
}

/* ---------- 学生 / 小组卡片 ---------- */
function cardsHTML() {
  if (ui.tab === 'groups') {
    if (!appData.groups.length) {
      return `<div class="empty" style="grid-column:1/-1"><i class="fas fa-users"></i><p>暂无小组数据</p></div>`;
    }
    return appData.groups.map((g, idx) => {
      const members = appData.students.filter(s => s.group_id === g.id);
      const avg = members.length ? (members.reduce((s, x) => s + (x.points || 0), 0) / members.length) : 0;
      return `
        <div class="card grp-card fade-in" style="--c:${g.color}">
          <div class="grp-head">
            <div class="grp-title">
              ${g.avatar
                ? (CP.resolveAvatar(g.avatar).img
                  ? `<div class="grp-icon" style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex:none;border:2px solid ${g.color};display:flex;align-items:center;justify-content:center"><img src="${CP.esc(CP.resolveAvatar(g.avatar).img)}" style="width:100%;height:100%;object-fit:cover" draggable="false"></div>`
                  : `<div class="grp-icon" style="width:44px;height:44px;border-radius:50%;flex:none;border:2px solid ${g.color};display:flex;align-items:center;justify-content:center;font-size:22px;background:${g.color}1a">${CP.esc(g.avatar)}</div>`)
                : `<div class="grp-icon" style="background:${g.color}1a;color:${g.color}"><i class="fas fa-users"></i></div>`}
              <div style="min-width:0">
                <div class="grp-name">${CP.esc(g.name)}<span class="grp-num" style="background:${g.color}1a;color:${g.color}">第${idx + 1}组</span></div>
                <div class="grp-count">${members.length} 名成员</div>
              </div>
            </div>
            <div style="flex:none">
              <div class="grp-avg" style="color:${g.color}">${avg.toFixed(2)}</div>
              <div class="grp-avg-l">平均积分</div>
            </div>
          </div>
          ${g.signature ? `<div class="grp-sig">${CP.esc(g.signature)}</div>` : ''}
          <div class="grp-members">
            ${members.length === 0 ? '<span style="font-size:12px;color:var(--text-3);font-style:italic">暂无成员</span>' : members.map(s => `<span class="mc">${CP.esc(s.name)}</span>`).join('')}
          </div>
          <div class="grp-actions">
            <button class="btn btn-primary btn-sm" data-selgroup="${g.id}"><i class="fas fa-check-double"></i> 选择整组</button>
          </div>
        </div>`;
    }).join('');
  }
  return '';
}
function stuInnerHTML(s, t, f, sel) {
  const cb = ui.batchMode ? `<input type="checkbox" class="stu-cb" ${sel ? 'checked' : ''}>` : '';
  return `
    ${cb}
    ${CP.avatarHTML(s.avatar, { size: 46, frame: f })}
    <div class="stu-info">
      <div class="stu-name">${CP.esc(s.name)}<span class="stu-tag">${groupTagHTML(s)}</span></div>
      <div class="stu-meta">${CP.esc(metaLine(s))}</div>
    </div>
    <div style="flex:none">
      <div class="stu-pts ${s.points < 0 ? 'neg' : ''}">${s.points}</div>
      <div class="stu-pts-l">积分</div>
    </div>
    <div class="stu-actions">
      <button class="stu-btn stu-btn-add" data-quick="${s.id}|add"><i class="fas fa-plus"></i> 加分</button>
      <button class="stu-btn stu-btn-sub" data-quick="${s.id}|sub"><i class="fas fa-minus"></i> 减分</button>
    </div>`;
}
function renderCards() {
  const c = $('cards');
  c.className = 'cards ' + (ui.tab === 'students' ? 'students' : '');
  if (ui.tab === 'groups') { c.innerHTML = cardsHTML(); return; }
  // 学生视图：先清掉上一次小组视图残留的卡片/空态（keyed 补丁只维护 .stu-card）
  c.querySelectorAll('.grp-card, .empty').forEach(el => el.remove());
  // 学生视图：按 sid keyed 补丁，只更新变动文本/类名，不重设 <img>
  let list = filteredStudents();
  if (!list.length) {
    c.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fas fa-user-graduate"></i><p>${ui.search ? '未找到匹配学生' : '暂无学生数据'}</p></div>`;
    return;
  }
  const showFrame = appData.config.avatar_frame_cards === '1';
  const seen = new Set();
  list.forEach(s => {
    seen.add(s.id);
    let card = c.querySelector(`.stu-card[data-sid="${s.id}"]`);
    const t = tierOf(s.points);
    const f = showFrame ? t.frame : '';
    const sel = ui.selected.has(s.id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'card stu-card fade-in';
      card.dataset.sid = s.id;
      if (ui.batchMode) card.setAttribute('data-toggle', s.id);
      card.innerHTML = stuInnerHTML(s, t, f, sel);
      c.appendChild(card);
    } else {
      card.classList.toggle('selected', sel);
      card.classList.toggle('batch', ui.batchMode);
      if (ui.batchMode) card.setAttribute('data-toggle', s.id); else card.removeAttribute('data-toggle');
      // 只更新变动节点：积分、组标、姓名，不碰头像 img
      const pts = card.querySelector('.stu-pts');
      if (pts) { pts.textContent = s.points; pts.classList.toggle('neg', s.points < 0); }
      const tag = card.querySelector('.stu-tag');
      if (tag) tag.innerHTML = groupTagHTML(s);
      const cb = card.querySelector('.stu-cb');
      if (cb) cb.checked = sel;
    }
  });
  c.querySelectorAll('.stu-card').forEach(el => { if (!seen.has(Number(el.dataset.sid))) el.remove(); });
}

/* ---------- 分段控件 / 批量 ---------- */
function switchTab(tab) {
  ui.tab = tab;
  $('tab-stu').classList.toggle('active', tab === 'students');
  $('tab-grp').classList.toggle('active', tab === 'groups');
  $('btn-batch').style.display = tab === 'students' ? '' : 'none';
  if (tab === 'groups' && ui.batchMode) exitBatch();
  renderCards();
}
function exitBatch() {
  ui.batchMode = false; ui.selected.clear();
  $('batch-bar').style.display = 'none';
  const b = $('btn-batch');
  b.className = 'btn btn-soft btn-sm';
  b.innerHTML = '<i class="fas fa-check-square"></i> 批量选择';
}
function toggleBatchMode() {
  ui.batchMode = !ui.batchMode;
  const b = $('btn-batch');
  if (ui.batchMode) {
    $('batch-bar').style.display = 'flex';
    b.className = 'btn btn-danger btn-sm';
    b.innerHTML = '<i class="fas fa-xmark"></i> 退出选择';
  } else {
    exitBatch();
  }
  updateCount();
  renderCards();
}
function updateCount() { const el = $('batch-count'); if (el) el.textContent = ui.selected.size; }
function toggleSelect(id) {
  if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
  updateCount();
  const card = document.querySelector(`.stu-card[data-sid="${id}"]`);
  if (card) {
    card.classList.toggle('selected', ui.selected.has(id));
    const cb = card.querySelector('input[type=checkbox]');
    if (cb) cb.checked = ui.selected.has(id);
  } else renderCards();
}
function filteredStudents() {
  let list = appData.students;
  if (ui.search) {
    const q = ui.search.toLowerCase();
    list = list.filter(s => (s.name || '').toLowerCase().includes(q) || String(s.student_no || '').toLowerCase().includes(q));
  }
  return list;
}
function selectAllStudents() { filteredStudents().forEach(s => ui.selected.add(s.id)); updateCount(); renderCards(); }
function clearSelection() { ui.selected.clear(); updateCount(); renderCards(); }
function selectGroup(gid) {
  if (ui.tab !== 'students') switchTab('students');
  if (!ui.batchMode) { ui.batchMode = true; $('batch-bar').style.display = 'flex'; const b = $('btn-batch'); b.className = 'btn btn-danger btn-sm'; b.innerHTML = '<i class="fas fa-xmark"></i> 退出选择'; }
  ui.selected.clear();
  appData.students.filter(s => s.group_id === gid).forEach(s => ui.selected.add(s.id));
  updateCount(); renderCards();
  CP.toast(`已选择「${getGroup(gid).name}」${ui.selected.size} 名学生`, 'info');
}

/* ---------- 单人快捷加减分 ---------- */
function quickChange(sid, type) {
  const s = appData.students.find(x => x.id === sid);
  if (!s) return;
  const rules = appData.rules.filter(r => r.type === type);
  if (!rules.length) return CP.toast('暂无该类型规则', 'error');
  const opText = type === 'add' ? '加分' : '减分';
  const sign = type === 'add' ? '+' : '-';
  const box = CP.modal(`
    <h3>${opText} — ${CP.esc(s.name)}</h3>
    <p style="color:var(--text-2);margin:0 0 14px">当前积分 <b>${s.points}</b></p>
    <div class="form-row"><label class="form-label">原因</label>
      <select id="qc-reason" class="form-select">
        ${rules.map(r => `<option value="${CP.esc(r.reason)}" data-p="${r.points}">${CP.esc(r.reason)} (${sign}${Math.abs(r.points)})</option>`).join('')}
      </select></div>
    <div class="form-row"><label class="form-label">积分值</label>
      <input id="qc-points" type="number" class="form-input" value="${Math.abs(rules[0] && rules[0].points) || 10}" min="1" style="text-align:center;font-weight:700;font-size:18px">
      <div class="quick-pts">
        <button type="button" data-addval="5">${sign}5</button>
        <button type="button" data-addval="10">${sign}10</button>
        <button type="button" data-addval="20">${sign}20</button>
      </div></div>
    <div class="form-row" id="qc-custom-row" style="display:none"><label class="form-label">自定义原因（1-30字）</label>
      <input id="qc-custom-reason" type="text" class="form-input" maxlength="30" placeholder="必填，说明本次操作原因"></div>
    <div class="modal-foot">
      <button class="btn" data-act="cancel">取消</button>
      <button class="btn ${type === 'add' ? 'btn-success' : 'btn-danger'}" data-act="ok">${opText}</button>
    </div>`, { size: 'sm' });
  box.querySelector('#qc-reason').onchange = function () {
    const isCustom = this.value === '自定义';
    box.querySelector('#qc-custom-row').style.display = isCustom ? '' : 'none';
    const p = this.options[this.selectedIndex].getAttribute('data-p');
    if (isCustom) { box.querySelector('#qc-points').value = ''; }
    else if (p) box.querySelector('#qc-points').value = Math.abs(parseInt(p) || 0);
  };
  box.querySelectorAll('[data-addval]').forEach(b => b.onclick = () => {
    const inp = box.querySelector('#qc-points');
    inp.value = Math.max(1, (parseInt(inp.value) || 0) + parseInt(b.getAttribute('data-addval')));
  });
  box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
  box.querySelector('[data-act=ok]').onclick = () => doQuickChange(sid, type, box);
}
async function doQuickChange(sid, type, box) {
  const s = appData.students.find(x => x.id === sid);
  if (!s) return;
  const isCustom = box.querySelector('#qc-reason').value === '自定义';
  let reason, p;
  if (isCustom) {
    reason = (box.querySelector('#qc-custom-reason').value || '').trim();
    if (!reason || reason.length > 30) return CP.toast('自定义原因需 1-30 字', 'warn');
    p = parseInt(box.querySelector('#qc-points').value) || 0;
    if (!Number.isInteger(p) || p < 1 || p > 100) return CP.toast('积分值需 1-100 整数', 'warn');
  } else {
    reason = box.querySelector('#qc-reason').value;
    p = parseInt(box.querySelector('#qc-points').value) || 0;
  }
  p = type === 'sub' ? -Math.abs(p) : Math.abs(p);
  const op = { studentId: sid, points: p, reason, type: type === 'sub' ? 'sub' : 'add' };
  if (isCustom) op.custom = 1;
  try {
    await CP.api('/points/batch', { method: 'POST', body: { operations: [op] } });
    CP.toast(`${s.name} ${p > 0 ? '加' : '减'} ${Math.abs(p)} 分`, 'success');
    CP.closeModal();
    refreshData();
  } catch (e) { CP.failToast(e); }
}

/* ---------- 批量加减分 ---------- */
function showBatchPoints(type) {
  const rules = appData.rules.filter(r => r.type === type);
  if (!rules.length) return CP.toast('暂无该类型规则', 'error');
  const opText = type === 'add' ? '批量加分' : '批量减分';
  const sign = type === 'add' ? '+' : '-';
  const targetText = ui.selected.size > 0 ? `已选 ${ui.selected.size} 名学生` : '将对所有学生操作';
  const box = CP.modal(`
    <h3>${opText}</h3>
    <p style="color:var(--text-2);margin:0 0 14px">${CP.esc(targetText)}</p>
    <div class="form-row"><label class="form-label">原因</label>
      <select id="bp-reason" class="form-select">
        ${rules.map(r => `<option value="${CP.esc(r.reason)}" data-p="${r.points}">${CP.esc(r.reason)} (${sign}${Math.abs(r.points)})</option>`).join('')}
      </select></div>
    <div class="form-row"><label class="form-label">积分值</label>
      <input id="bp-points" type="number" class="form-input" value="${Math.abs(rules[0] && rules[0].points) || 10}" min="1" style="text-align:center;font-weight:700;font-size:18px">
      <div class="quick-pts">
        <button type="button" data-addval="5">${sign}5</button>
        <button type="button" data-addval="10">${sign}10</button>
        <button type="button" data-addval="20">${sign}20</button>
      </div></div>
    <div class="form-row" id="bp-custom-row" style="display:none"><label class="form-label">自定义原因（1-30字）</label>
      <input id="bp-custom-reason" type="text" class="form-input" maxlength="30" placeholder="必填，说明本次操作原因"></div>
    <div class="modal-foot">
      <button class="btn" data-act="cancel">取消</button>
      <button class="btn ${type === 'add' ? 'btn-success' : 'btn-danger'}" data-act="ok">${opText}</button>
    </div>`, { size: 'sm' });
  box.querySelector('#bp-reason').onchange = function () {
    const isCustom = this.value === '自定义';
    box.querySelector('#bp-custom-row').style.display = isCustom ? '' : 'none';
    const p = this.options[this.selectedIndex].getAttribute('data-p');
    if (isCustom) { box.querySelector('#bp-points').value = ''; }
    else if (p) box.querySelector('#bp-points').value = Math.abs(parseInt(p) || 0);
  };
  box.querySelectorAll('[data-addval]').forEach(b => b.onclick = () => {
    const inp = box.querySelector('#bp-points');
    inp.value = Math.max(1, (parseInt(inp.value) || 0) + parseInt(b.getAttribute('data-addval')));
  });
  box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
  box.querySelector('[data-act=ok]').onclick = () => doBatchPoints(type, box);
}
async function doBatchPoints(type, box) {
  const isCustom = box.querySelector('#bp-reason').value === '自定义';
  let reason, p;
  if (isCustom) {
    reason = (box.querySelector('#bp-custom-reason').value || '').trim();
    if (!reason || reason.length > 30) return CP.toast('自定义原因需 1-30 字', 'warn');
    p = parseInt(box.querySelector('#bp-points').value) || 0;
    if (!Number.isInteger(p) || p < 1 || p > 100) return CP.toast('积分值需 1-100 整数', 'warn');
  } else {
    reason = box.querySelector('#bp-reason').value;
    p = parseInt(box.querySelector('#bp-points').value) || 0;
  }
  p = type === 'sub' ? -Math.abs(p) : Math.abs(p);
  let targets = ui.selected.size > 0 ? appData.students.filter(s => ui.selected.has(s.id)) : appData.students.slice();
  if (!targets.length) return CP.toast('没有目标学生', 'error');
  const ops = targets.map(s => { const o = { studentId: s.id, points: p, reason, type: type === 'sub' ? 'sub' : 'add' }; if (isCustom) o.custom = 1; return o; });
  try {
    await CP.api('/points/batch', { method: 'POST', body: { operations: ops } });
    CP.toast(`已为 ${targets.length} 名学生${type === 'add' ? '加' : '减'} ${Math.abs(p)} 分`, 'success');
    CP.closeModal();
    if (ui.batchMode) { ui.selected.clear(); updateCount(); exitBatch(); renderCards(); }
    refreshData();
  } catch (e) { CP.failToast(e); }
}

/* ---------- 最近操作（右栏） ---------- */
function renderHistory() {
  const c = $('hist-list');
  if (!c) return;
  if (!ui.recentRecords.length) { c.innerHTML = '<div style="text-align:center;padding:18px;color:var(--text-3);font-size:12px">暂无记录</div>'; return; }
  c.innerHTML = ui.recentRecords.slice(0, 15).map(r => {
    const isAdd = r.points > 0;
    return `
      <div class="hist-item">
        <div class="hist-ic" style="background:${isAdd ? 'var(--green-soft)' : 'var(--red-soft)'};color:${isAdd ? 'var(--green)' : 'var(--red)'}"><i class="fas fa-${isAdd ? 'plus' : 'minus'}"></i></div>
        <div class="hist-txt">
          <div><span class="hist-name">${CP.esc(r.student_name)}</span> <b style="color:${isAdd ? 'var(--green)' : 'var(--red)'}">${isAdd ? '+' : ''}${r.points}</b></div>
          <div class="text-3" style="font-size:11px">${CP.esc(r.reason || '')}</div>
          <div class="hist-time">${CP.fmtTime(r.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

/* ---------- 排行榜 ---------- */
function switchRank(type) {
  ui.rank = type;
  $('rk-stu').classList.toggle('active', type === 'individual');
  $('rk-grp').classList.toggle('active', type === 'group');
  $('rk-tier').classList.toggle('active', type === 'tier');
  $('rk-biw').classList.toggle('active', type === 'biweekly');
  if (type === 'biweekly') loadBiweekly(ui.biw.period);
  renderRankings();
}
/* ---------- 双周榜（v4.1） ---------- */
async function loadBiweekly(period) {
  try {
    const d = await CP.api('/rankings/biweekly?period=' + encodeURIComponent(period));
    const x = (d && d.data) ? d.data : d;
    ui.biw.data = x;
    if (x && Array.isArray(x.history)) ui.biw.history = x.history;
  } catch (e) { ui.biw.data = null; }
  if (ui.rank === 'biweekly') renderRankings();
}
function fmtRange(ms) { return CP.fmtDate(ms).slice(5); }
function fmtRangeEnd(ms) { return CP.fmtDate(ms - 1).slice(5); }
function renderBiweekly(c) {
  if (ui.biw.historyMode) {
    // 历史周期列表
    const h = ui.biw.history || [];
    c.innerHTML = `<div class="biw-back"><button class="btn btn-sm" id="biw-back"><i class="fas fa-arrow-left"></i> 当前周期</button></div>` +
      (h.length ? h.map(p => `
        <div class="rank-item biw-item" data-biw-period="${p.period_index}">
          <div class="rk-info" style="flex:1">
            <div class="rk-name">${fmtRange(p.period_start)} ~ ${fmtRangeEnd(p.period_end)}</div>
            <div class="rk-sub">第 ${p.period_index + 1} 期</div>
          </div>
          <i class="fas fa-chevron-right text-3"></i>
        </div>`).join('') : '<div class="empty" style="padding:20px"><p>暂无历史周期</p></div>');
    const back = $('biw-back'); if (back) back.onclick = () => { ui.biw.historyMode = false; loadBiweekly('current'); };
    c.querySelectorAll('[data-biw-period]').forEach(el => el.onclick = () => {
      ui.biw.historyMode = false;
      loadBiweekly(Number(el.dataset.biwPeriod));
    });
    return;
  }
  const x = ui.biw.data;
  if (!x || !Array.isArray(x.rows) || !x.rows.length) { c.innerHTML = emptyRank(); return; }
  const rangeTxt = `${fmtRange(x.period_start)} ~ ${fmtRangeEnd(x.period_end)}`;
  const suffix = x.not_started ? ' · 明日开始' : (x.is_current ? ' · 进行中' : '');
  c.innerHTML = `
    <div class="biw-head">
      <div class="biw-range">${rangeTxt}${suffix}</div>
      <button class="btn btn-sm btn-soft" id="biw-hist"><i class="fas fa-clock-rotate-left"></i> 历史排行</button>
    </div>` + x.rows.map((r, i) => {
    const pos = i + 1, posCls = pos <= 3 ? 'p' + pos : '';
    const up = r.delta_avg >= 0;
    const gAv = (appData.groups.find(g => g.id === r.group_id || g.name === r.group_name) || {}).avatar;
    const avHTML = gAv
      ? (CP.resolveAvatar(gAv).img
        ? `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;overflow:hidden;flex:none;border:2px solid ${r.color}"><img src="${CP.esc(CP.resolveAvatar(gAv).img)}" style="width:100%;height:100%;object-fit:cover" draggable="false"></div>`
        : `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;flex:none;border:2px solid ${r.color};display:flex;align-items:center;justify-content:center;font-size:16px;background:${r.color}1a">${CP.esc(gAv)}</div>`)
      : `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;background:${r.color}1a;color:${r.color};display:flex;align-items:center;justify-content:center;flex:none"><i class="fas fa-users"></i></div>`;
    return `
      <div class="rank-item">
        <div class="rk-pos ${posCls}">${pos}</div>
        ${avHTML}
        <div class="rk-info">
          <div class="rk-name">${CP.esc(r.group_name)}</div>
          <div class="rk-sub">${r.member_count} 名成员 · 平均分 ${Number(r.avg_start).toFixed(2)} → ${Number(r.avg_end).toFixed(2)}</div>
        </div>
        <div class="rk-pts" style="color:${up ? 'var(--green)' : 'var(--red)'}">${up ? '+' : ''}${Number(r.delta_avg).toFixed(2)}</div>
      </div>`;
  }).join('');
  const bh = $('biw-hist'); if (bh) bh.onclick = () => { ui.biw.historyMode = true; renderRankings(); };
}

function renderRankings() {
  const c = $('rank-list');
  const fLeader = appData.config.avatar_frame_leaderboard === '1';
  const fTier = appData.config.avatar_frame_tier === '1';
  if (ui.rank === 'biweekly') { renderBiweekly(c); return; }
  if (ui.rank === 'individual') {
    const sorted = appData.students.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    if (!sorted.length) { c.innerHTML = emptyRank(); return; }
    c.innerHTML = sorted.map((s, i) => {
      const g = getGroup(s.group_id);
      const t = tierOf(s.points);
      const pos = i + 1, posCls = pos <= 3 ? 'p' + pos : '';
      const f = fLeader ? t.frame : '';
      const sub = [g.id ? g.name : '未分组', s.student_no ? '学号 ' + s.student_no : ''].filter(Boolean).join(' · ');
      return `
        <div class="rank-item">
          <div class="rk-pos ${posCls}">${pos}</div>
          ${CP.avatarHTML(s.avatar, { size: 32, frame: f })}
          <div class="rk-info">
            <div class="rk-name">${CP.esc(s.name)}</div>
            <div class="rk-sub">${CP.esc(sub)}</div>
          </div>
          <div class="rk-pts ${s.points < 0 ? 'neg' : ''}">${s.points}</div>
        </div>`;
    }).join('');
  } else if (ui.rank === 'group') {
    const gs = appData.groups.map(g => {
      const ms = appData.students.filter(s => s.group_id === g.id);
      const avg = ms.length ? (ms.reduce((s, x) => s + (x.points || 0), 0) / ms.length) : 0;
      const origIdx = appData.groups.findIndex(x => x.id === g.id);
      return Object.assign({}, g, { avg, count: ms.length, origIdx });
    }).sort((a, b) => b.avg - a.avg);
    if (!gs.length) { c.innerHTML = emptyRank(); return; }
    c.innerHTML = gs.map((g, i) => {
      const pos = i + 1, posCls = pos <= 3 ? 'p' + pos : '';
      const avHTML = g.avatar
        ? (CP.resolveAvatar(g.avatar).img
          ? `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;overflow:hidden;flex:none;border:2px solid ${g.color}"><img src="${CP.esc(CP.resolveAvatar(g.avatar).img)}" style="width:100%;height:100%;object-fit:cover" draggable="false"></div>`
          : `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;flex:none;border:2px solid ${g.color};display:flex;align-items:center;justify-content:center;font-size:16px;background:${g.color}1a">${CP.esc(g.avatar)}</div>`)
        : `<div class="rk-av" style="width:32px;height:32px;border-radius:9px;background:${g.color}1a;color:${g.color};display:flex;align-items:center;justify-content:center;flex:none"><i class="fas fa-users"></i></div>`;
      return `
        <div class="rank-item">
          <div class="rk-pos ${posCls}">${pos}</div>
          ${avHTML}
          <div class="rk-info">
            <div class="rk-name">${CP.esc(g.name)}<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;background:${g.color}1a;color:${g.color};margin-left:5px">第${g.origIdx + 1}组</span></div>
            <div class="rk-sub">${g.count} 名成员</div>
          </div>
          <div class="rk-pts">${g.avg.toFixed(2)}</div>
        </div>`;
    }).join('');
  } else {
    const withT = appData.students.map(s => Object.assign({}, s, { tier: tierOf(s.points) })).sort((a, b) => b.tier.order - a.tier.order || (b.points || 0) - (a.points || 0));
    if (!withT.length) { c.innerHTML = emptyRank(); return; }
    const dist = {};
    withT.forEach(s => { dist[s.tier.name] = (dist[s.tier.name] || 0) + 1; });
    let html = `
      <div class="tier-dist">
        <div class="tier-dist-t">段位分布</div>
        <div class="tier-dist-l">
          ${Object.entries(dist).map(([name, count]) => {
            const t = TIERS.find(x => x.name === name) || TIERS[0];
            return `<button class="tier-pill" style="color:${t.color}" data-tier="${CP.esc(name)}">${CP.esc(name)} · ${count}</button>`;
          }).join('')}
        </div>
      </div>`;
    html += withT.map(s => {
      const g = getGroup(s.group_id);
      const t = s.tier;
      const isTop = t.order === 31;
      const range = t.max - t.min;
      const prog = isTop ? 100 : Math.min(100, Math.round(((s.points - t.min) / range) * 100));
      const f = fTier ? t.frame : '';
      const sub = [g.id ? g.name : '未分组', s.student_no ? '学号 ' + s.student_no : ''].filter(Boolean).join(' · ');
      return `
        <div class="rank-item" style="flex-direction:column;align-items:stretch;padding:10px">
          <div style="display:flex;align-items:center;gap:10px">
            ${CP.avatarHTML(s.avatar, { size: 34, frame: f })}
            <div class="rk-info">
              <div class="rk-name">${CP.esc(s.name)}</div>
              <div class="rk-sub">${CP.esc(sub)}</div>
            </div>
            <div class="rk-pts" style="color:${t.color}">${s.points}</div>
          </div>
          <div class="tier-bar-wrap" style="background:${t.color}0d">
            <div class="tier-bar-h">
              <i class="fas ${t.icon}" style="color:${t.color};font-size:12px"></i>
              <span class="tier-bar-n" style="color:${t.color}">${t.name}</span>
              <span class="tier-bar-r">${isTop ? t.min + '+' : t.min + '-' + t.max}</span>
            </div>
            <div class="tier-bar"><div class="tier-bar-f" style="width:${prog}%;background:${t.color}"></div></div>
            <div class="tier-bar-fo">${isTop ? '已达最高段位' : (s.points >= t.max ? '已达本段位上限' : `还需 ${t.max - s.points + 1} 分晋级`)}</div>
          </div>
        </div>`;
    }).join('');
    c.innerHTML = html;
    c.querySelectorAll('[data-tier]').forEach(b => b.onclick = () => showTierStudents(b.getAttribute('data-tier')));
  }
}
function emptyRank() { return '<div class="empty" style="padding:26px"><i class="fas fa-ranking"></i><p>暂无数据</p></div>'; }

/* ---------- 段位学生弹窗 ---------- */
function showTierStudents(tierName) {
  const students = appData.students.filter(s => tierOf(s.points).name === tierName);
  const t = TIERS.find(x => x.name === tierName) || TIERS[0];
  CP.modal(`
    <h3 style="color:${t.color}"><i class="fas ${t.icon}" style="margin-right:7px"></i>${CP.esc(tierName)}</h3>
    <p class="text-2" style="margin:0 0 12px">共 ${students.length} 名学生</p>
    ${students.length === 0 ? '<div class="empty"><i class="fas fa-user"></i><p>暂无学生</p></div>' : `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${students.map(s => {
        const g = getGroup(s.group_id);
        const meta = [g.id ? g.name : '未分组', s.student_no ? '学号 ' + s.student_no : '无学号'].join(' · ');
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface-2);border-radius:11px">
            ${CP.avatarHTML(s.avatar, { size: 38 })}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700">${CP.esc(s.name)}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:1px">${CP.esc(meta)}</div>
            </div>
            <div style="font-size:15px;font-weight:800;color:${t.color}">${s.points}</div>
          </div>`;
      }).join('')}
    </div>`}
    <div class="modal-foot"><button class="btn" data-act="close">关闭</button></div>`, { size: 'md' })
    .querySelector('[data-act=close]').onclick = () => CP.closeModal();
}

/* ---------- 段位说明弹窗 ---------- */
function showTierHelp() {
  if ($('right-panel')) closeRankDrawer();
  const groups = [
    { title: '青铜段位', color: '#b45309', list: TIERS.filter(t => t.name.includes('青铜')) },
    { title: '白银段位', color: '#64748b', list: TIERS.filter(t => t.name.includes('白银')) },
    { title: '黄金段位', color: '#b45309', list: TIERS.filter(t => t.name.includes('黄金')) },
    { title: '铂金段位', color: '#0e7490', list: TIERS.filter(t => t.name.includes('铂金')) },
    { title: '钻石段位', color: '#0891b2', list: TIERS.filter(t => t.name.includes('钻石')) },
    { title: '星耀段位', color: '#af52de', list: TIERS.filter(t => t.name.includes('星耀')) },
    { title: '王者段位', color: '#ea580c', list: TIERS.filter(t => t.name.includes('王者')) }
  ];
  CP.modal(`
    <h3><i class="fas fa-crown" style="color:var(--orange);margin-right:7px"></i>段位说明</h3>
    <div style="max-height:66vh;overflow-y:auto">
      ${groups.map(g => `
        <div class="tier-group">
          <div class="tier-group-h" style="background:${g.color}12;color:${g.color}">
            <i class="fas ${g.list[0].icon}"></i> ${g.title}
          </div>
          <div class="tier-group-b">
            <div class="tier-grid">
              ${g.list.map(it => `
                <div class="tier-cell">
                  <div style="font-weight:700;color:${g.color}">${it.name}</div>
                  <div class="font-size:12px;color:var(--text-2);margin-top:3px">积分 ${it.min}${it.max >= 999999 ? '+' : '‑' + it.max}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>`).join('')}
      <div style="padding:12px 14px;background:var(--orange-soft);border-radius:11px">
        <div style="font-size:12px;font-weight:700;color:var(--orange);margin-bottom:6px">晋级规则</div>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--orange);line-height:1.8">
          <li>青铜 / 白银 / 黄金 / 铂金：每 100 积分晋升一个小段</li>
          <li>钻石段位：每 200 积分晋升（V → I）</li>
          <li>星耀段位：每 250 积分晋升（V → I）</li>
          <li>王者段位：达到指定积分即可晋升相应王者段位</li>
        </ul>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" data-act="close">关闭</button></div>`, { size: 'lg' })
    .querySelector('[data-act=close]').onclick = () => CP.closeModal();
}

/* ---------- 事件绑定（委托） ---------- */
function bindEvents() {
  $('search-input').addEventListener('input', function () { ui.search = this.value; renderCards(); });
  $('tab-stu').onclick = () => switchTab('students');
  $('tab-grp').onclick = () => switchTab('groups');
  $('btn-batch').onclick = toggleBatchMode;
  $('sel-all').onclick = selectAllStudents;
  $('sel-clear').onclick = clearSelection;
  $('batch-add').onclick = () => showBatchPoints('add');
  $('batch-sub').onclick = () => showBatchPoints('sub');
  $('rk-stu').onclick = () => switchRank('individual');
  $('rk-grp').onclick = () => switchRank('group');
  $('rk-tier').onclick = () => switchRank('tier');
  $('rk-biw').onclick = () => switchRank('biweekly');
  $('tier-help').onclick = showTierHelp;

  // 卡片区委托
  $('cards').addEventListener('click', e => {
    const q = e.target.closest('[data-quick]');
    if (q) { e.stopPropagation(); const [sid, type] = q.getAttribute('data-quick').split('|'); quickChange(Number(sid), type); return; }
    const sg = e.target.closest('[data-selgroup]');
    if (sg) { selectGroup(Number(sg.getAttribute('data-selgroup'))); return; }
    const tg = e.target.closest('[data-toggle]');
    if (tg) { toggleSelect(Number(tg.getAttribute('data-toggle'))); return; }
  });

  // 移动端抽屉
  $('mobile-btn').onclick = () => { $('sidebar').classList.add('open'); $('drawer-overlay').classList.add('show'); };
  $('drawer-overlay').onclick = closeSidebar;
  $('mobile-rank-btn').onclick = () => toggleRankDrawer();
  $('side-logo').onclick = () => { location.href = '/index.html'; };
  document.addEventListener('cp:read-change', renderBadge);
  document.addEventListener('cp:title', e => {
    const lt = $('logo-text'); if (lt) lt.textContent = e.detail;
    const mt = $('m-title'); if (mt) mt.textContent = e.detail;
  });
  const lt0 = $('logo-text'); if (lt0) lt0.textContent = CP.siteTitle;
  const mt0 = $('m-title'); if (mt0) mt0.textContent = CP.siteTitle;
  const mb1 = $('more-menu-btn'); if (mb1) mb1.addEventListener('click', () => CP.moreMenu(mb1));
  const mb2 = $('more-menu-btn-desktop'); if (mb2) mb2.addEventListener('click', () => CP.moreMenu(mb2));
  // ext_links + biweekly toggle
  CP.loadBootstrap().then(() => {
    const box = $('ext-links'); if (box) {
      const L = CP.bootstrap.ext_links || {};
      const items = [
        ['后台管理', '/admin', 'fas fa-screwdriver-wrench'],
        ['github', L.github, 'fa-brands fa-github'],
        ['home', L.home, 'fas fa-house'],
        ['blog', L.blog, 'fas fa-blog'],
      ];
      box.innerHTML = items.filter(i => i[1]).map(i => `<a href="${CP.esc(i[1])}" target="_blank" rel="noopener" class="icon-btn" title="${i[0]}"><i class="${i[2]}"></i></a>`).join('');
    }
    // biweekly toggle
    const biw = $('rk-biw');
    if (biw) {
      const en = CP.bootstrap.biweekly_rank_enabled;
      if (en === '0' || en === 0) {
        biw.style.display = 'none';
        if (biw.classList.contains('active')) { biw.classList.remove('active'); const rs = $('rk-stu'); if (rs) rs.click(); }
      }
    }
  });
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('drawer-overlay').classList.remove('show');
}
function openRankDrawer() {
  $('right-panel').classList.add('open');
  $('rank-overlay').classList.add('show');
}
function closeRankDrawer() {
  $('right-panel').classList.remove('open');
  $('rank-overlay').classList.remove('show');
}
function toggleRankDrawer() {
  if ($('right-panel').classList.contains('open')) closeRankDrawer(); else openRankDrawer();
}
document.addEventListener('click', e => { if (e.target === $('rank-overlay')) closeRankDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRankDrawer(); });
window.addEventListener('resize', () => { if (window.innerWidth > 1024) closeRankDrawer(); });

/* ---------- 启动 ---------- */
(async function init() {
  CP.applyTitle();
  const ok = await CP.requireDevice();
  if (!ok) return; // 已跳转 /start
  bindEvents();
  await refreshData();
  CP.poll(async () => { await refreshData(); }, 5000);
  window.addEventListener('online', () => { isOnline = true; setConn(true); CP.toast('网络已恢复', 'success'); });
  window.addEventListener('offline', () => { isOnline = false; setConn(false); });
})();

/* ---------- 系统公告（v4.2）：铃铛 + 横向日期卡片弹窗 + Markdown + 自动弹一次 ---------- */
(function sysAnn() {
  let list = [];
  const bellIds = ['sys-ann-bell-fe', 'sys-ann-bell-desktop'];
  function getClosed() { try { return JSON.parse(localStorage.getItem('closed_sys_ann_uids') || '[]'); } catch (e) { return []; } }
  function saveClosed(uids) { try { localStorage.setItem('closed_sys_ann_uids', JSON.stringify(uids.slice(-200))); } catch (e) {} }
  function isClosed(uid) { return getClosed().includes(uid); }

  function updateBadge() {
    const unread = list.filter(a => !isClosed(a.uid)).length;
    bellIds.forEach(id => {
      const bell = document.getElementById(id);
      if (!bell) return;
      let badge = bell.querySelector('.dot-badge');
      if (unread > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'dot-badge'; bell.appendChild(badge); }
        badge.textContent = unread > 99 ? '99+' : unread;
      } else if (badge) badge.remove();
    });
  }

  function wd(ms) { return ['周日','周一','周二','周三','周四','周五','周六'][new Date(ms).getDay()]; }

  function openModal(selUid) {
    if (!list.length) return CP.toast('暂无公告', 'info');
    const sorted = list.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    let cur = selUid || sorted[0].uid;
    const box = CP.modal('', { size: 'lg' });
    function renderBody() {
      const a = sorted.find(x => String(x.uid) === String(cur)) || sorted[0];
      const cards = sorted.map(x =>
        `<button class="sys-date-card ${String(x.uid) === String(a.uid) ? 'active' : ''}" data-uid="${CP.esc(x.uid)}">
          <div class="sys-date-md">${new Date(x.created_at).getMonth() + 1}月${new Date(x.created_at).getDate()}日</div>
          <div class="sys-date-wd">${wd(x.created_at)}</div>
        </button>`).join('');
      box.innerHTML = `
        <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-bullhorn" style="color:var(--orange)"></i> 系统公告</h3>
        <div class="sys-date-strip">${cards}</div>
        <div class="sys-ann-body">
          <div class="sys-ann-title">${CP.esc(a.title)}</div>
          <div class="sys-ann-meta">${CP.esc(a.created_by || '管理员')} · ${CP.fmtTime(a.created_at, true)}</div>
          <div class="md-body">${CP.mdToHtml(a.content || '')}</div>
        </div>
        <div class="modal-foot"><button class="btn btn-primary" data-act="know">我知道了</button></div>`;
      box.querySelectorAll('[data-uid]').forEach(b => b.onclick = () => { cur = b.dataset.uid; renderBody(); });
      box.querySelector('[data-act=know]').onclick = () => {
        const closed = getClosed();
        sorted.forEach(x => { if (!closed.includes(x.uid)) closed.push(x.uid); });
        saveClosed(closed);
        CP.closeModal();
        updateBadge();
      };
    }
    renderBody();
  }

  function load() {
    return fetch('/api/system-announcements')
      .then(r => r.json())
      .then(d => { list = (d && d.data) || []; updateBadge(); })
      .catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', () => {
    bellIds.forEach(id => {
      const bell = document.getElementById(id);
      if (bell) bell.addEventListener('click', () => openModal());
    });
    load().then(() => {
      const fresh = list.filter(a => !isClosed(a.uid));
      if (fresh.length) setTimeout(() => openModal(fresh[0].uid), 900);
    });
  });
})();

