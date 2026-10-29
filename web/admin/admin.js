/* ============================================================
   班级积分系统 v4.0 — 后台 admin 单页应用
   依赖 ../assets/common.js（CP.*）与 ../assets/apple.css
   ============================================================ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  // 缓存加固：IIFE 入口立即强制登录面板可见，杜绝 setup/forgot 残留露出
  try {
    var _sp = $('setup-panel'), _lp = $('login-panel'), _fp = $('forgot-panel');
    if (_sp) _sp.classList.add('hidden');
    if (_fp) _fp.classList.add('hidden');
    if (_lp) _lp.classList.remove('hidden');
  } catch (e) {}

  /* ---------- 全局状态 ---------- */
  let currentUser = null;
  let appData = { students: [], groups: [], rules: [], announcements: [], config: {} };
  let uiState = {
    page: 'students',
    studentSearch: '', studentBatch: false, studentSel: new Set(),
    groupBatch: false, groupSel: new Set(),
    ruleSelAdd: new Set(), ruleSelSub: new Set(),
    rankTab: 'individual',
    annCat: '全部', annEditingId: null,
    annView: 'home', annRange: 'week', annPub: '', annYear: 0, annMonth: 0, annDay: 0,
    biPeriod: 'current', biData: null, biHistory: null, biShowHistory: false,
    fmUnread: 0,
    fmPeriod: 'week', fmList: [], fmDetailId: null,
  };
  let pollTimer = null;
  let _usersCache = [];
  const CATEGORIES = ['通知公告', '作业提醒', '考试成绩', '班级活动', '其他'];

  /* ---------- 段位体系（31 级，阈值逐字沿用旧数据） ---------- */
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
    { name: '传奇王者', min: 9000, max: 999999, order: 31, color: '#ea580c', icon: 'fa-crown', frame: 'avf-king' },
  ];
  function getTierList() {
    try {
      let tr = appData.config.tier_rules;
      if (typeof tr === 'string') tr = JSON.parse(tr);
      if (Array.isArray(tr) && tr.length >= 2 && Number(tr[0].min) === 0 &&
          tr.every((t, i) => i === 0 || Number(t.min) > Number(tr[i - 1].min))) {
        return tr.map((t, i) => {
          const built = TIERS.find(x => x.name === t.name);
          const nextMin = i + 1 < tr.length ? Number(tr[i + 1].min) : null;
          return {
            name: t.name, min: Number(t.min), max: nextMin != null ? nextMin - 1 : 999999,
            order: i + 1, color: built ? built.color : '#8e8e93',
            icon: built ? built.icon : 'fa-crown', frame: built ? built.frame : '',
          };
        });
      }
    } catch (e) {}
    return TIERS;
  }
  function tierOf(p) { const L = getTierList(); const x = Math.max(0, p || 0); return L.find(t => x >= t.min && x <= t.max) || L[L.length - 1]; }
  function getGroup(id) { return appData.groups.find(g => g.id === id) || { id: null, name: '未分组', color: '#8e8e93' }; }
  function dateStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  /* ============================================================
     认证
     ============================================================ */
  function showLoginScreen() {
    $('admin-app').style.display = 'none';
    $('login-screen').style.display = 'flex';
    showLogin();
  }
  function showSetup(username) {
    $('setup-panel').classList.remove('hidden');
    $('login-panel').classList.add('hidden');
    $('forgot-panel').classList.add('hidden');
    $('setup-user-label').textContent = username;
  }
  function showLogin() {
    $('forgot-panel').classList.add('hidden');
    $('setup-panel').classList.add('hidden');
    $('login-panel').classList.remove('hidden');
  }
  function showForgot() {
    $('login-panel').classList.add('hidden');
    $('setup-panel').classList.add('hidden');
    $('forgot-panel').classList.remove('hidden');
  }
  async function initAuth() {
    // 登录面板默认已可见（HTML 不加 hidden）；status 只决定是否切到设置面板
    try {
      const st = await CP.api('/auth/status');
      if (!st.hasTeacherPassword) showSetup('teacher');
      else if (!st.hasAdminPassword) showSetup('admin');
      else showLogin();
    } catch (e) {
      // 网络错误保持登录面板可见，不切走
      showLogin();
      CP.toast('无法连接服务器，请稍后重试', 'error');
    }
  }
  function setBtnLoading(btn, on, text) {
    if (!btn) return;
    btn.disabled = on;
    if (on) { btn.dataset.orig = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> ' + (text || '请稍候'); }
    else btn.innerHTML = btn.dataset.orig || btn.innerHTML;
  }
  async function doSetup() {
    const p1 = $('setup-pwd').value, p2 = $('setup-pwd2').value;
    if (p1.length < 4) return CP.toast('密码至少 4 位', 'warn');
    if (p1 !== p2) return CP.toast('两次密码不一致', 'warn');
    const username = $('setup-user-label').textContent;
    const btn = event && event.currentTarget;
    setBtnLoading(btn, true, '设置中…');
    try {
      await CP.api('/auth/setup', { method: 'POST', body: { username, password: p1 } });
      CP.toast('密码设置成功', 'success');
      await initAuth();
      $('login-username').value = username;
    } catch (e) { CP.failToast(e, '设置失败'); }
    finally { setBtnLoading(btn, false); }
  }
  async function doLogin() {
    const username = $('login-username').value.trim();
    const password = $('login-pwd').value;
    if (!username) return CP.toast('请输入账户名', 'warn');
    if (!password) return CP.toast('请输入密码', 'warn');
    const btn = event && event.currentTarget;
    setBtnLoading(btn, true, '登录中…');
    try {
      const res = await CP.api('/auth/login', { method: 'POST', body: { username, password } });
      if (res.needSetup) return CP.toast('该账户尚未设置密码', 'warn');
      CP.setAdminToken(res.token);
      try {
        localStorage.setItem('cp_admin_role', res.role);
        localStorage.setItem('cp_admin_name', res.display_name || username);
      } catch (e) {}
      enterAdmin(res.role, res.display_name || username);
    } catch (e) { CP.toast(e.message || '登录失败', 'error'); setBtnLoading(btn, false); }
  }
  function fillAccount(name) {
    $('login-username').value = name;
    $('login-pwd').focus();
  }
  function siteSwitcher(anchorEl) {
    // 若 common.js 已提供 CP.siteSwitcher 且可用则直接用（popover 吸附点击的图标）；否则回退到本后台自绘 modal
    const anchor = anchorEl || document.activeElement || null;
    try {
      if (window.CP && typeof CP.openSiteSwitcher === 'function') { CP.openSiteSwitcher(anchor); return; }
    } catch (e) { /* fall through */ }
    const cur = location.hostname;
    const items = [
      { url: 'https://points.example.com', label: '主站', desc: 'points.example.com' },
      { url: 'https://points1.example.com', label: '备用站', desc: 'points1.example.com' },
    ];
    CP.modal(`<h3>切换站点</h3>
      <p class="text-3" style="font-size:12px;margin:0 0 12px">跳转到对应站点的后台（当前：${CP.esc(cur)}）</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${items.map(it => `<div class="flex aic gap-10" style="padding:12px;background:var(--fill);border-radius:12px;cursor:pointer" onclick="location.href='${it.url}/admin/'">
          <i class="fas fa-server" style="color:var(--primary)"></i>
          <div style="flex:1"><b>${it.label}</b><div class="text-3" style="font-size:11px">${it.desc}</div></div>
          ${cur === it.url.replace('https://','') ? '<span class="badge" style="background:rgba(52,199,89,.15);color:var(--green)">当前</span>' : '<i class="fas fa-chevron-right text-3"></i>'}
        </div>`).join('')}
      </div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button></div>`);
  }
  async function sendCode() {
    const email = $('forgot-email').value.trim();
    if (!email) return CP.toast('请输入救援邮箱', 'warn');
    try {
      await CP.api('/auth/send-code', { method: 'POST', body: { email } });
      CP.toast('验证码已发送到邮箱', 'success');
    } catch (e) { CP.failToast(e, '发送失败'); }
  }
  async function doReset() {
    const username = $('forgot-username').value.trim();
    const email = $('forgot-email').value.trim();
    const code = $('forgot-code').value.trim();
    const np = $('forgot-newpwd').value;
    if (np.length < 4) return CP.toast('密码至少 4 位', 'warn');
    try {
      await CP.api('/auth/reset-password', { method: 'POST', body: { username, email, code, newPassword: np } });
      CP.toast('密码重置成功', 'success');
      showLogin();
    } catch (e) { CP.failToast(e, '重置失败'); }
  }
  function logout() {
    CP.confirm('退出登录', '确定退出登录吗？').then(ok => {
      if (!ok) return;
      CP.clearAdminToken();
      try { localStorage.removeItem('cp_admin_role'); localStorage.removeItem('cp_admin_name'); } catch (e) {}
      location.reload();
    });
  }

  /* ============================================================
     主界面 / 导航 / 数据
     ============================================================ */
  function updateUserBar() {
    if (!currentUser) return;
    const av = $('user-avatar');
    if (currentUser.avatar) {
      av.innerHTML = `<img src="${CP.esc(currentUser.avatar.startsWith('data:') || currentUser.avatar.startsWith('/') ? currentUser.avatar : '/api/file?path=' + encodeURIComponent(currentUser.avatar))}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      av.textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();
    }
    $('user-name').textContent = currentUser.display_name || currentUser.username;
  }
  function enterAdmin(role, displayName) {
    const username = role === 'super' ? 'admin' : 'teacher';
    currentUser = { username, role, display_name: displayName || username };
    $('login-screen').style.display = 'none';
    $('admin-app').style.display = 'grid';
    $('user-avatar').textContent = (displayName || username).charAt(0).toUpperCase();
    $('user-name').textContent = displayName || username;
    $('user-role').textContent = role === 'super' ? '超级管理员' : '班主任';
    $('logo-sub').textContent = role === 'super' ? 'Super Admin' : 'Teacher';
    renderNav();
    renderSideExtLinks();
    refreshData().then(() => switchPage('students')).catch(() => switchPage('students'));
    startPoll();
    hydrateProfile();
    // 检查新系统公告
    setTimeout(() => checkNewSysAnns(), 500);
  }
  // 登录/刷新后立即拉取个人资料（含头像），避免首屏长期停留在字母占位
  async function hydrateProfile() {
    try {
      const me2 = await CP.api('/auth/me');
      const info = (me2 && me2.data) || me2;
      if (info && currentUser) {
        currentUser.avatar = info.avatar || '';
        if (info.display_name) currentUser.display_name = info.display_name;
        updateUserBar();
      }
    } catch (e) {}
  }
  function renderNav() {
    const isSuper = currentUser.role === 'super';
    const item = (page, icon, label, opts) => {
      let badge = '';
      if (page === 'front-messages' && uiState.fmUnread > 0) badge = uiState.fmUnread > 99 ? '99+' : uiState.fmUnread;
      if (page === 'system-announcements' && sysAnnUnreadCount() > 0) {
        const n = sysAnnUnreadCount(); badge = n > 99 ? '99+' : n;
      }
      if (page === 'chat' && window.__chatUnread > 0) badge = window.__chatUnread > 99 ? '99+' : window.__chatUnread;
      const preview = page === 'chat' ? `<span class="chat-nav-preview" id="chat-nav-preview"></span>` : '';
      return `<button class="nav-item" data-page="${page}" onclick="App.navClick('${page}',${opts&&opts.ext?1:0})"><i class="fas ${icon}"></i><span class="nav-item-body"><span>${label}</span>${preview}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button>`;
    };
    let html = '';
    html += `<div class="nav-sec"><div class="nav-sec-t">数据管理</div>
      ${item('students', 'fa-user-graduate', '学生信息')}
      ${item('groups', 'fa-users', '小组信息')}
      ${item('rules', 'fa-sliders-h', '积分规则')}</div>`;
    html += `<div class="nav-sec"><div class="nav-sec-t">动态与排行</div>
      ${item('system-announcements', 'fa-bullhorn', '系统公告')}
      ${item('rankings', 'fa-trophy', '排行榜')}
      ${item('tier-rules', 'fa-crown', '段位规则')}
      ${item('chat', 'fa-comments', '群聊', {ext:1})}</div>`;
    html += `<div class="nav-sec"><div class="nav-sec-t">记录与备份</div>
      ${item('records', 'fa-clock-rotate-left', '历史记录', {ext:1})}
      ${item('export', 'fa-file-export', '导出记录')}
      ${item('backup', 'fa-cloud', '数据备份')}</div>`;
    html += `<div class="nav-sec"><div class="nav-sec-t">安全与设置</div>
      ${item('security', 'fa-shield-halved', '账号安全')}
      ${item('settings', 'fa-gear', '系统设置')}</div>`;
    if (isSuper) {
      html += `<div class="nav-sec"><div class="nav-sec-t" style="color:var(--orange)">超级管理</div>
        ${item('super-users', 'fa-user-shield', '账户管理')}
        ${item('super-logins', 'fa-right-to-bracket', '登录日志')}
        ${item('super-audit', 'fa-clipboard-list', '操作审计')}
        ${item('super-devices', 'fa-mobile-screen', '设备管理')}
        ${item('super-sites', 'fa-server', '站点管理')}
        ${item('super-extlinks', 'fa-link', '快捷链接')}</div>`;
    }
    $('nav-scroll').innerHTML = html;
  }
  function navClick(page, isExt) {
    if (page === 'records') {
      // 超管进入后台历史记录页（含拟造加减分、拟造角标）；其余角色沿用前台统一记录页
      if (currentUser.role === 'super') { switchPage('records'); return; }
      location.href = '/history?from=admin'; return;
    }
    if (page === 'chat') { location.href = (currentUser.role === 'super') ? '/chat/admin' : '/chat/teacher'; return; }
    switchPage(page);
  }
  /* v4.5 聚合更多菜单（CP.moreMenu(anchor) 由 common.js 提供） */
  function moreMenu(anchor) {
    try {
      if (CP.moreMenu) return CP.moreMenu(anchor);
    } catch (e) {}
    // 兜底：自绘三行 modal
    CP.modal(`<h3>更多</h3>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn" style="justify-content:flex-start" onclick="CP.closeModal();App.siteSwitcher(this)"><i class="fas fa-server"></i> 切换站点</button>
        <button class="btn" style="justify-content:flex-start" onclick="CP.closeModal();App.feedback()"><i class="fas fa-comment-dots"></i> 反馈</button>
        <button class="btn" style="justify-content:flex-start" onclick="CP.closeModal();App.versionToast()"><i class="fas fa-circle-info"></i> 版本</button>
      </div>`);
  }
  /* v4.5 侧栏底部外链 */
  function renderSideExtLinks() {
    const box = $('side-ext-links'); if (!box) return;
    let ext = (window.CP && CP.bootstrap && CP.bootstrap.ext_links) || appData.config.ext_links || {};
    if (typeof ext === 'string') { try { ext = JSON.parse(ext); } catch (e) { ext = {}; } }
    const items = [];
    items.push({ url: '/', icon: 'fas fa-display', label: '前台首页' });
    if (ext.github) items.push({ url: ext.github, icon: 'fa-brands fa-github', label: 'GitHub' });
    if (ext.home) items.push({ url: ext.home, icon: 'fas fa-house', label: '主页' });
    if (ext.blog) items.push({ url: ext.blog, icon: 'fas fa-blog', label: '博客' });
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="side-ext-links-row">` + items.map(it =>
      `<a href="${CP.esc(it.url)}" target="_blank" rel="noopener" title="${CP.esc(it.label)}"><i class="${it.icon}"></i></a>`).join('') + `</div>`;
  }
  function closeSidebar() {
    const sb = $('sidebar'); if (sb) sb.classList.remove('open');
    const ov = $('overlay'); if (ov) ov.classList.remove('show');
  }
  async function refreshData() {
    try {
      const res = await CP.api('/snapshot');
      if (res && res.data) appData = Object.assign({}, appData, res.data);
    } catch (e) {}
    try {
      const cfg = await CP.api('/config');
      if (cfg && cfg.data) appData.config = Object.assign({}, appData.config, cfg.data);
    } catch (e) {}
    if (appData.config && appData.config.site_title) {
      document.title = appData.config.site_title + ' · 后台';
      $('logo-text').textContent = appData.config.site_title;
    }
  }
  async function switchPage(page) {
    uiState.page = page;
    document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    closeSidebar();
    await refreshData();
    _lastSig = ''; // 切页强制首绘
    const fn = PAGE_RENDERERS[page];
    if (fn) fn();
  }
  function refreshPage() { return switchPage(uiState.page); }
  function goHome() { return switchPage('students'); }

  /* 5 秒静默刷新：签名比对，无变化不重绘 */
  let _lastSig = '';
  function dataSig() {
    try {
      return JSON.stringify({
        s: appData.students.map(x => [x.id, x.name, x.points, x.group_id, x.avatar || '']),
        g: appData.groups.map(x => [x.id, x.name, x.color, x.slogan || '']),
        r: appData.rules.map(x => [x.uid, x.reason, x.type, x.points, x.is_builtin || 0]),
        a: (appData.announcements || []).map(x => [x.uid, x.title, x.updated_at || x.created_at, x.edited ? 1 : 0]),
      });
    } catch (e) { return ''; }
  }
  function startPoll() {
    if (pollTimer) pollTimer.stop();
    pollTimer = CP.poll(async () => {
      if (document.querySelector('.modal-back.show')) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      const page = uiState.page;
      if (page === 'front-messages') { renderFmPage(); return; }
      refreshFmBadge();
      loadSysAnns();
      if (!['students', 'groups', 'rules', 'announcements', 'rankings'].includes(page)) return;
      await refreshData();
      const sig = dataSig();
      if (sig === _lastSig) return; // 数据无变化，跳过重绘（防闪动）
      _lastSig = sig;
      const fn = PAGE_RENDERERS[page];
      if (fn) fn();
    }, 5000);
  }

  /* ============================================================
     学生信息
     ============================================================ */
  function renderStudentsPage() {
    const total = appData.students.length;
    const grps = appData.groups.length;
    const avg = total ? (appData.students.reduce((s, x) => s + x.points, 0) / total) : 0;
    const maxP = total ? Math.max.apply(null, appData.students.map(s => s.points)) : 0;
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">学生信息</h2>
        <span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.showImportStudents()"><i class="fas fa-file-import"></i> 导入</button>
        <button class="btn btn-primary" onclick="App.showAddStudent()"><i class="fas fa-user-plus"></i> 新增学生</button>
        <button class="btn ${uiState.studentBatch ? 'btn-danger' : 'btn-soft'}" onclick="App.toggleStudentBatch()"><i class="fas fa-${uiState.studentBatch ? 'x' : 'check-square'}"></i> ${uiState.studentBatch ? '退出选择' : '批量选择'}</button>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="v">${grps}</div><div class="k">小组数量</div></div>
        <div class="stat-tile"><div class="v">${total}</div><div class="k">学生总数</div></div>
        <div class="stat-tile"><div class="v">${avg.toFixed(2)}</div><div class="k">平均积分</div></div>
        <div class="stat-tile"><div class="v">${maxP}</div><div class="k">最高积分</div></div>
      </div>
      <div class="search-wrap mb-12"><i class="fas fa-search"></i>
        <input id="stu-search" class="form-input" placeholder="搜索姓名或学号..." value="${CP.esc(uiState.studentSearch)}" autocomplete="off">
      </div>
      ${uiState.studentBatch ? `<div class="batch-bar">
        <span>已选 <span class="n" id="stu-batch-n">${uiState.studentSel.size}</span> 名学生</span>
        <span class="spacer"></span>
        <button class="btn btn-soft btn-sm" onclick="App.selectAllStudents()">全选</button>
        <button class="btn btn-soft btn-sm" onclick="App.clearStudentSel()">清空</button>
        <button class="btn btn-danger btn-sm" onclick="App.batchDelStudents()"><i class="fas fa-trash"></i> 删除</button>
      </div>` : ''}
      <div class="stu-grid" id="stu-cards"></div>
    </div>`;
    renderStuCards();
    const inp = $('stu-search');
    if (inp) inp.addEventListener('input', function () { uiState.studentSearch = this.value; renderStuCards(); });
  }
  function renderStuCards() {
    const c = $('stu-cards'); if (!c) return;
    const isSuper = currentUser.role === 'super';
    let list = appData.students;
    if (uiState.studentSearch) {
      const q = uiState.studentSearch.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.student_no || '').toLowerCase().includes(q));
    }
    if (!list.length) {
      c.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fas fa-user-graduate"></i><p>${uiState.studentSearch ? '未找到匹配学生' : '暂无学生数据'}</p></div>`;
      return;
    }
    const fCards = appData.config.avatar_frame_cards === '1';
    c.innerHTML = list.map(s => {
      const g = getGroup(s.group_id);
      const sel = uiState.studentSel.has(s.id);
      const chip = g.id
        ? `<span class="group-chip" style="background:${g.color}22;color:${g.color}">${CP.esc(g.name)}</span>`
        : `<span class="group-chip" style="background:var(--fill);color:var(--text-3)">未分组</span>`;
      const no = s.student_no ? `<span class="text-3">学号 ${CP.esc(s.student_no)}</span>` : '';
      const frameCls = fCards ? tierOf(s.points).frame : '';
      const clickAttr = uiState.studentBatch ? `onclick="App.toggleStuSelect(${s.id},event)"` : '';
      const cb = uiState.studentBatch ? `<input type="checkbox" style="width:17px;height:17px;flex:none;margin-top:10px" ${sel ? 'checked' : ''}>` : '';
      return `<div class="stu-card ${sel ? 'sel' : ''} ${uiState.studentBatch ? 'batch' : ''}" data-sid="${s.id}" ${clickAttr}>
        <div class="stu-head">${cb}${CP.avatarHTML(s.avatar, { size: 42, frame: frameCls })}
          <div class="stu-info">
            <div class="stu-name">${CP.esc(s.name)}</div>
            <div class="stu-meta">${chip} ${no}</div>
          </div>
          <div style="flex:none;text-align:right"><div class="stu-pts ${s.points < 0 ? 'neg' : ''}">${s.points}</div><div class="stu-pts-l">积分</div></div>
        </div>
        <div class="stu-actions">
          <button class="btn btn-soft btn-sm" onclick="event.stopPropagation();App.showEditStudent(${s.id})"><i class="fas fa-edit"></i> 编辑</button>
          ${isSuper ? `<button class="btn btn-sm" style="background:var(--orange-soft);color:var(--orange)" onclick="event.stopPropagation();App.showSuperSetPoints(${s.id})"><i class="fas fa-bolt"></i> 直改</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  function toggleStudentBatch() { uiState.studentBatch = !uiState.studentBatch; uiState.studentSel.clear(); renderStudentsPage(); }
  function toggleStuSelect(id, e) {
    if (e && e.target && e.target.tagName === 'INPUT') { if (e.target.checked) uiState.studentSel.add(id); else uiState.studentSel.delete(id); }
    else { if (uiState.studentSel.has(id)) uiState.studentSel.delete(id); else uiState.studentSel.add(id); }
    const card = document.querySelector(`.stu-card[data-sid="${id}"]`);
    if (card) { card.classList.toggle('sel', uiState.studentSel.has(id)); const cb = card.querySelector('input[type=checkbox]'); if (cb) cb.checked = uiState.studentSel.has(id); }
    const bn = $('stu-batch-n'); if (bn) bn.textContent = uiState.studentSel.size;
  }
  function selectAllStudents() {
    let list = appData.students;
    if (uiState.studentSearch) { const q = uiState.studentSearch.toLowerCase(); list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.student_no || '').toLowerCase().includes(q)); }
    list.forEach(s => uiState.studentSel.add(s.id));
    renderStudentsPage();
  }
  function clearStudentSel() { uiState.studentSel.clear(); renderStudentsPage(); }
  async function batchDelStudents() {
    const ids = Array.from(uiState.studentSel);
    if (!ids.length) return CP.toast('未选择学生', 'warn');
    const ok = await CP.confirm('批量删除学生', `确定删除选中的 ${ids.length} 名学生吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await CP.api('/students/batch-delete', { method: 'POST', body: { ids } });
      CP.toast(`已删除 ${ids.length} 名学生`, 'success');
      uiState.studentSel.clear(); uiState.studentBatch = false;
      switchPage('students');
    } catch (e) { CP.failToast(e, '删除失败'); }
  }
  function groupOptionsHtml(selId) {
    return `<option value="">未分组</option>` + appData.groups.map(g => `<option value="${g.id}" ${g.id === selId ? 'selected' : ''}>${CP.esc(g.name)}</option>`).join('');
  }
  function showAddStudent() {
    CP.modal(`<h3>新增学生</h3>
      <div class="form-row"><label class="form-label">姓名 *</label><input id="ns-name" class="form-input"></div>
      <div class="form-row"><label class="form-label">学号</label><input id="ns-no" class="form-input"></div>
      <div class="form-row"><label class="form-label">小组</label><select id="ns-group" class="form-select">${groupOptionsHtml(null)}</select></div>
      <div class="form-row"><label class="form-label">初始积分</label><input id="ns-points" type="number" class="form-input" value="0"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doAddStudent()">添加</button></div>`);
  }
  async function doAddStudent() {
    const name = $('ns-name').value.trim();
    if (!name) return CP.toast('请输入姓名', 'warn');
    try {
      await CP.api('/students', { method: 'POST', body: {
        name, student_no: $('ns-no').value.trim(),
        group_id: parseInt($('ns-group').value) || null,
        points: parseInt($('ns-points').value) || 0,
      }});
      CP.toast('添加成功', 'success'); CP.closeModal(); switchPage('students');
    } catch (e) { CP.failToast(e, '添加失败'); }
  }
  function showEditStudent(id) {
    const s = appData.students.find(x => x.id === id); if (!s) return;
    CP.modal(`<h3>编辑学生</h3>
      <div class="form-row"><label class="form-label">姓名</label><input id="es-name" class="form-input" value="${CP.esc(s.name)}"></div>
      <div class="form-row"><label class="form-label">学号</label><input id="es-no" class="form-input" value="${CP.esc(s.student_no || '')}"></div>
      <div class="form-row"><label class="form-label">小组</label><select id="es-group" class="form-select">${groupOptionsHtml(s.group_id)}</select></div>
      <div class="form-row"><label class="form-label">头像（Emoji 或图片 URL）</label><input id="es-avatar" class="form-input" value="${CP.esc(s.avatar || '👦')}"></div>
      <div class="form-row"><label class="form-label">或上传头像图片</label><input type="file" id="es-file" accept="image/*"></div>
      <div class="modal-foot">
        <button class="btn btn-danger" onclick="App.doDelStudent(${id})">删除</button>
        <button class="btn" onclick="CP.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.doUpdateStudent(${id})">保存</button>
      </div>`);
  }
  async function doUpdateStudent(id) {
    const s = appData.students.find(x => x.id === id); if (!s) return;
    const name = $('es-name').value.trim();
    if (!name) return CP.toast('请输入姓名', 'warn');
    let avatar = $('es-avatar').value.trim() || '👦';
    const file = $('es-file').files[0];
    if (file) {
      const fd = new FormData(); fd.append('file', file);
      try {
        const up = await CP.api('/upload', { method: 'POST', body: fd });
        avatar = up.url;
      } catch (e) { return CP.failToast(e, '图片上传失败'); }
    }
    try {
      await CP.api(`/students/${id}`, { method: 'PUT', body: {
        name, student_no: $('es-no').value.trim(),
        group_id: parseInt($('es-group').value) || null,
        points: s.points, avatar,
      }});
      CP.toast('保存成功', 'success'); CP.closeModal(); switchPage('students');
    } catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function doDelStudent(id) {
    const ok = await CP.confirm('删除学生', '确定删除此学生吗？此操作不可恢复。');
    if (!ok) return;
    try {
      await CP.api(`/students/${id}`, { method: 'DELETE' });
      CP.toast('已删除', 'success'); CP.closeModal(); switchPage('students');
    } catch (e) { CP.failToast(e, '删除失败'); }
  }
  function showImportStudents() {
    CP.modal(`<h3>批量导入学生</h3>
      <p class="text-2" style="font-size:13px;margin:0 0 12px">每行：姓名,学号,小组名,初始积分（后三项可省略）</p>
      <div class="form-row"><textarea id="imp-stu" class="form-textarea" style="min-height:200px" placeholder="张三,01,第一小组,50&#10;李四,02,第一小组,60"></textarea></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doImportStudents()">导入</button></div>`);
  }
  async function doImportStudents() {
    const text = $('imp-stu').value.trim();
    if (!text) return CP.toast('请输入数据', 'warn');
    const lines = text.split('\n').filter(l => l.trim());
    let ok = 0;
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      const name = parts[0]; if (!name) continue;
      const no = parts[1] || '', groupName = parts[2], pts = parts[3];
      let group_id = null;
      if (groupName) {
        let g = appData.groups.find(x => x.name === groupName);
        if (!g) { try { const r = await CP.api('/groups', { method: 'POST', body: { name: groupName, color: '#007aff' } }); await refreshData(); g = appData.groups.find(x => x.name === groupName); } catch (e) {} }
        if (g) group_id = g.id;
      }
      try { await CP.api('/students', { method: 'POST', body: { name, student_no: no, group_id, points: parseInt(pts) || 0 } }); ok++; } catch (e) {}
    }
    CP.toast(`成功导入 ${ok} 名学生`, 'success'); CP.closeModal(); switchPage('students');
  }

  /* ============================================================
     小组信息
     ============================================================ */
  const GROUP_COLORS = ['#007aff','#34c759','#ff9500','#ff3b30','#af52de','#5ac8fa','#5856d6','#ff2d55','#a2845e','#8e8e93','#30b0c7','#bf5af2'];
  function colorPickerHtml(name, sel) {
    // 末尾追加"自定义"：彩虹渐变圆点覆盖透明 color input
    const selIsCustom = sel && !GROUP_COLORS.includes(sel);
    return `<div class="color-pick">` + GROUP_COLORS.map(c => `
      <label><input type="radio" name="${name}" value="${c}" ${c === sel ? 'checked' : ''}>
        <span class="dot" style="background:${c}"></span></label>`).join('') + `
      <label style="position:relative"><input type="radio" name="${name}" value="__custom__" ${selIsCustom ? 'checked' : ''} style="position:absolute;opacity:0;pointer-events:none">
        <span class="dot" style="background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"></span>
        <input type="color" id="${name}-custom-input" value="${selIsCustom ? sel : '#007aff'}"
          style="position:absolute;inset:0;opacity:0;cursor:pointer" onchange="App.pickColor('${name}')"></label>
    </div>`;
  }
  function pickColor(name) {
    // 自定义被选中时：勾选自定义 radio 并把 color input 值同步过去
    const radio = document.querySelector(`input[name="${name}"][value="__custom__"]`);
    if (radio) radio.checked = true;
  }
  function readColor(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    if (!checked) return GROUP_COLORS[0];
    if (checked.value === '__custom__') {
      return $(`${name}-custom-input`).value || GROUP_COLORS[0];
    }
    return checked.value;
  }
  // 小组头像 HTML：有 avatar 用 avatarHTML + 组色头像框；无则 fa-users 图标 + 10% 组色底
  function groupAvatarHtml(g, size = 40, radius = '10px') {
    if (g.avatar) {
      return CP.avatarHTML(g.avatar, { size, radius, border: g.color });
    }
    return `<div class="grp-icon" style="width:${size}px;height:${size}px;border-radius:${radius};background:${g.color}1c;color:${g.color};display:flex;align-items:center;justify-content:center;flex:none"><i class="fas fa-users"></i></div>`;
  }
  function renderGroupsPage() {
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">小组信息</h2>
        <span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.showImportGroups()"><i class="fas fa-file-import"></i> 导入</button>
        <button class="btn btn-primary" onclick="App.showAddGroup()"><i class="fas fa-plus"></i> 新增小组</button>
        <button class="btn ${uiState.groupBatch ? 'btn-danger' : 'btn-soft'}" onclick="App.toggleGroupBatch()"><i class="fas fa-${uiState.groupBatch ? 'x' : 'check-square'}"></i> ${uiState.groupBatch ? '退出选择' : '批量选择'}</button>
      </div>
      ${uiState.groupBatch ? `<div class="batch-bar">
        <span>已选 <span class="n">${uiState.groupSel.size}</span> 个小组</span>
        <span class="spacer"></span>
        <button class="btn btn-soft btn-sm" onclick="App.clearGroupSel()">清空</button>
        <button class="btn btn-danger btn-sm" onclick="App.batchDelGroups()"><i class="fas fa-trash"></i> 删除</button>
      </div>` : ''}
      <div class="grp-grid">
        ${appData.groups.length === 0 ? '<div class="empty" style="grid-column:1/-1"><i class="fas fa-users"></i><p>暂无小组</p></div>' :
          appData.groups.map((g, idx) => {
            const members = appData.students.filter(s => s.group_id === g.id);
            const avg = members.length ? members.reduce((s, x) => s + x.points, 0) / members.length : 0;
            const sel = uiState.groupSel.has(g.id);
            const clickAttr = uiState.groupBatch ? `onclick="App.toggleGrpSelect(${g.id},event)"` : '';
            return `<div class="grp-card ${sel ? 'sel' : ''}" style="--c:${g.color}" ${clickAttr}>
              <div class="grp-head">
                <div class="flex aic gap-10" style="min-width:0">
                  ${groupAvatarHtml(g)}
                  <div style="min-width:0">
                    <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${CP.esc(g.name)}<span class="badge" style="background:${g.color}1c;color:${g.color}">第${idx + 1}组</span></div>
                    <div class="text-3" style="font-size:11px;margin-top:2px">${members.length} 名成员 · 平均 ${avg.toFixed(2)} 分</div>
                  </div>
                </div>
              </div>
              ${g.signature ? `<div class="grp-sig">${CP.esc(g.signature)}</div>` : ''}
              <div class="grp-members">${members.length === 0 ? '<span class="text-3" style="font-size:11px;font-style:italic">暂无成员</span>' : members.map(s => `<span class="member-chip">${CP.esc(s.name)}</span>`).join('')}</div>
              <button class="btn btn-soft btn-sm" onclick="event.stopPropagation();App.showEditGroup(${g.id})"><i class="fas fa-edit"></i> 编辑</button>
            </div>`;
          }).join('')}
      </div>
    </div>`;
  }
  function toggleGroupBatch() { uiState.groupBatch = !uiState.groupBatch; uiState.groupSel.clear(); renderGroupsPage(); }
  function toggleGrpSelect(id, e) {
    if (e && e.target && e.target.tagName === 'INPUT') { if (e.target.checked) uiState.groupSel.add(id); else uiState.groupSel.delete(id); }
    else { if (uiState.groupSel.has(id)) uiState.groupSel.delete(id); else uiState.groupSel.add(id); }
    renderGroupsPage();
  }
  function clearGroupSel() { uiState.groupSel.clear(); renderGroupsPage(); }
  async function batchDelGroups() {
    const ids = Array.from(uiState.groupSel);
    if (!ids.length) return CP.toast('未选择小组', 'warn');
    const ok = await CP.confirm('批量删除小组', `确定删除选中的 ${ids.length} 个小组吗？组内学生将变为未分组状态。`);
    if (!ok) return;
    try {
      await CP.api('/groups/batch-delete', { method: 'POST', body: { ids } });
      CP.toast(`已删除 ${ids.length} 个小组`, 'success');
      uiState.groupSel.clear(); uiState.groupBatch = false;
      switchPage('groups');
    } catch (e) { CP.failToast(e, '删除失败'); }
  }
  function showAddGroup() {
    CP.modal(`<h3>新增小组</h3>
      <div class="form-row"><label class="form-label">小组名称 *</label><input id="ng-name" class="form-input"></div>
      <div class="form-row"><label class="form-label">口号（可选）</label><input id="ng-sig" class="form-input"></div>
      <div class="form-row"><label class="form-label">颜色</label>${colorPickerHtml('ng-color', GROUP_COLORS[0])}</div>
      <div class="form-row"><label class="form-label">头像（Emoji 或图片 URL，留空=默认）</label><input id="ng-avatar" class="form-input" placeholder="如 🐯 或 /api/file/uploads/xxx.png"></div>
      <div class="form-row"><label class="form-label">或上传头像图片</label><input id="ng-avatar-file" type="file" accept="image/*" onchange="App.uploadGroupAvatar('ng-avatar')"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doAddGroup()">添加</button></div>`);
  }
  async function uploadGroupAvatar(inputId) {
    const f = document.getElementById(inputId + '-file');
    const file = f && f.files && f.files[0];
    if (!file) return;
    try {
      const fd = new FormData(); fd.append('file', file);
      const up = await CP.api('/upload', { method: 'POST', body: fd });
      const u = (up && (up.data || up)) || {};
      const url = u.url || u.file_url || '';
      if (url) { $(inputId).value = url; CP.toast('头像已上传', 'success'); }
      else CP.failToast(new Error(up.error || '未返回文件地址'), '上传失败');
    } catch (e) { CP.failToast(e, '上传失败'); }
  }
  async function doAddGroup() {
    const name = $('ng-name').value.trim();
    if (!name) return CP.toast('请输入名称', 'warn');
    const color = readColor('ng-color');
    const avatar = ($('ng-avatar').value || '').trim();
    try {
      await CP.api('/groups', { method: 'POST', body: { name, color, signature: $('ng-sig').value.trim(), avatar } });
      CP.toast('添加成功', 'success'); CP.closeModal(); switchPage('groups');
    } catch (e) { CP.failToast(e, '添加失败'); }
  }
  function showEditGroup(id) {
    const g = appData.groups.find(x => x.id === id); if (!g) return;
    CP.modal(`<h3>编辑小组</h3>
      <div class="form-row"><label class="form-label">小组名称</label><input id="eg-name" class="form-input" value="${CP.esc(g.name)}"></div>
      <div class="form-row"><label class="form-label">口号（可选）</label><input id="eg-sig" class="form-input" value="${CP.esc(g.signature || '')}"></div>
      <div class="form-row"><label class="form-label">颜色</label>${colorPickerHtml('eg-color', g.color)}</div>
      <div class="form-row"><label class="form-label">头像（Emoji 或图片 URL，留空=默认）</label><input id="eg-avatar" class="form-input" value="${CP.esc(g.avatar || '')}"></div>
      <div class="form-row"><label class="form-label">或上传头像图片</label><input id="eg-avatar-file" type="file" accept="image/*" onchange="App.uploadGroupAvatar('eg-avatar')"></div>
      <div class="modal-foot">
        <button class="btn btn-soft" onclick="App.resetGroupAvatar()">恢复默认头像</button>
        <button class="btn btn-danger" onclick="App.doDelGroup(${id})">删除</button>
        <button class="btn" onclick="CP.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.doUpdateGroup(${id})">保存</button>
      </div>`);
  }
  function resetGroupAvatar() { const i = document.getElementById('eg-avatar'); if (i) i.value = ''; CP.toast('已清空头像', 'success'); }
  async function doUpdateGroup(id) {
    const name = $('eg-name').value.trim();
    if (!name) return CP.toast('请输入名称', 'warn');
    const color = readColor('eg-color');
    const avatar = ($('eg-avatar').value || '').trim();
    try {
      await CP.api(`/groups/${id}`, { method: 'PUT', body: { name, color, signature: $('eg-sig').value.trim(), avatar } });
      CP.toast('保存成功', 'success'); CP.closeModal(); switchPage('groups');
    } catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function doDelGroup(id) {
    const ok = await CP.confirm('删除小组', '确定删除此小组吗？组内学生将变为未分组状态。');
    if (!ok) return;
    try { await CP.api(`/groups/${id}`, { method: 'DELETE' }); CP.toast('已删除', 'success'); CP.closeModal(); switchPage('groups'); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }
  function showImportGroups() {
    CP.modal(`<h3>批量导入小组</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">每行一个小组名称</p>
      <div class="form-row"><textarea id="imp-grp" class="form-textarea" style="min-height:200px" placeholder="第一小组&#10;第二小组&#10;第三小组"></textarea></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doImportGroups()">导入</button></div>`);
  }
  async function doImportGroups() {
    const text = $('imp-grp').value.trim();
    if (!text) return CP.toast('请输入数据', 'warn');
    const lines = text.split('\n').filter(l => l.trim());
    let ok = 0;
    for (let i = 0; i < lines.length; i++) {
      try { await CP.api('/groups', { method: 'POST', body: { name: lines[i].trim(), color: GROUP_COLORS[i % GROUP_COLORS.length] } }); ok++; } catch (e) {}
    }
    CP.toast(`成功导入 ${ok} 个小组`, 'success'); CP.closeModal(); switchPage('groups');
  }

  /* ============================================================
     积分规则
     ============================================================ */
  function renderRulesPage() {
    const addR = appData.rules.filter(r => r.type === 'add');
    const subR = appData.rules.filter(r => r.type === 'sub');
    const renderList = (list, type) => {
      const selSet = type === 'add' ? uiState.ruleSelAdd : uiState.ruleSelSub;
      if (!list.length) return '<div class="empty"><i class="fas fa-inbox"></i><p>暂无规则</p></div>';
      return `<div class="rule-list" data-rtype="${type}">` + list.map((r, idx) => {
        const builtin = !!r.is_builtin;
        const pts = type === 'add' ? `+${r.points}` : `-${r.points}`;
        return `
        <div class="rule-row" draggable="true" data-uid="${r.uid}" data-type="${type}" data-idx="${idx}"
          ondragstart="App.dragRuleStart(event,'${type}')" ondragover="App.dragRuleOver(event,'${type}')" ondrop="App.dropRule(event,'${type}')" ondragend="App.dragRuleEnd(event)"
          ${builtin ? 'style="opacity:.6"' : ''}>
          <i class="fas fa-grip-vertical" style="color:var(--text-3);margin-right:2px;cursor:grab;font-size:12px"></i>
          <input type="checkbox" style="width:16px;height:16px;flex:none" ${builtin || !selSet ? 'disabled' : (selSet.has(r.id) ? 'checked' : '')} onchange="App.toggleRuleSel('${type}',${r.id},this.checked)">
          <div class="rule-reason">${CP.esc(r.reason)} ${builtin ? '<span class="badge" style="font-size:10px;background:var(--fill);color:var(--text-3)">内置</span>' : ''}</div>
          <div class="rule-pts ${type}">${pts}</div>
          <button class="icon-btn" style="color:var(--blue);${builtin ? 'pointer-events:none;opacity:.4' : ''}" ${builtin ? 'title="内置规则不可修改"' : 'title="编辑规则"'} onclick="App.showEditRule(${r.id},'${type}')"><i class="fas fa-pen"></i></button>
          <button class="icon-btn" style="color:var(--red);${builtin ? 'pointer-events:none;opacity:.4' : ''}" ${builtin ? 'title="内置规则不可修改"' : ''} onclick="App.doDelRule(${r.id})"><i class="fas fa-trash"></i></button>
        </div>`;
      }).join('') + `</div>`;
    };
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">积分规则</h2></div>
      <div class="rules-grid">
        <div>
          <div class="flex aic gap-6 mb-8 wrap" style="margin-bottom:10px">
            <h3 style="color:var(--green);font-size:14px">加分规则</h3>
            <span class="spacer"></span>
            <button class="btn btn-soft btn-sm" onclick="App.showBatchAddRule('add')"><i class="fas fa-list"></i> 批量</button>
            <button class="btn btn-danger btn-sm" onclick="App.batchDelRules('add')"><i class="fas fa-trash"></i> 删除</button>
            <button class="btn btn-primary btn-sm" onclick="App.showAddRule('add')"><i class="fas fa-plus"></i> 新增</button>
          </div>
          ${renderList(addR, 'add')}
        </div>
        <div>
          <div class="flex aic gap-6 mb-8 wrap" style="margin-bottom:10px">
            <h3 style="color:var(--red);font-size:14px">减分规则</h3>
            <span class="spacer"></span>
            <button class="btn btn-soft btn-sm" onclick="App.showBatchAddRule('sub')"><i class="fas fa-list"></i> 批量</button>
            <button class="btn btn-danger btn-sm" onclick="App.batchDelRules('sub')"><i class="fas fa-trash"></i> 删除</button>
            <button class="btn btn-primary btn-sm" onclick="App.showAddRule('sub')"><i class="fas fa-plus"></i> 新增</button>
          </div>
          ${renderList(subR, 'sub')}
        </div>
      </div>
    </div>`;
  }
  function toggleRuleSel(type, id, checked) { const s = type === 'add' ? uiState.ruleSelAdd : uiState.ruleSelSub; if (checked) s.add(id); else s.delete(id); }

  // ---- 规则拖拽排序（同 type 列表内） ----
  let _dragRuleUid = null;
  function dragRuleStart(e, type) {
    const row = e.currentTarget;
    _dragRuleUid = row.dataset.uid;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', _dragRuleUid); } catch {}
    row.style.opacity = '0.4';
  }
  function dragRuleOver(e, type) {
    if (!_dragRuleUid) return;
    const row = e.currentTarget;
    if (row.dataset.type !== type || row.dataset.uid === _dragRuleUid) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.style.background = 'var(--fill)';
  }
  async function dropRule(e, type) {
    e.preventDefault();
    const target = e.currentTarget;
    target.style.background = '';
    if (!_dragRuleUid || target.dataset.type !== type || target.dataset.uid === _dragRuleUid) return;
    // 取当前该 type 列表 DOM 顺序
    const list = target.parentElement;
    const rows = Array.from(list.querySelectorAll('.rule-row'));
    const dragIdx = rows.findIndex(r => r.dataset.uid === _dragRuleUid);
    const targetIdx = rows.findIndex(r => r.dataset.uid === target.dataset.uid);
    if (dragIdx < 0 || targetIdx < 0) return;
    // 重排 DOM（乐观）
    if (dragIdx < targetIdx) list.insertBefore(rows[dragIdx], target.nextSibling);
    else list.insertBefore(rows[dragIdx], target);
    // 提交：重新计算 sort_order
    const newRows = Array.from(list.querySelectorAll('.rule-row'));
    const orders = newRows.map((r, i) => ({ uid: r.dataset.uid, sort_order: i + 1 }));
    _dragRuleUid = null;
    try {
      await CP.api('/rules/reorder', { method: 'POST', body: { orders } });
      // 同步本地 appData
      for (const o of orders) {
        const r = appData.rules.find(x => x.uid === o.uid);
        if (r) r.sort_order = o.sort_order;
      }
      CP.toast('排序已保存', 'success');
    } catch (err) {
      CP.failToast(err, '排序保存失败');
      switchPage('rules');
    }
  }
  function dragRuleEnd(e) {
    e.currentTarget.style.opacity = '';
    document.querySelectorAll('.rule-row').forEach(r => r.style.background = '');
    _dragRuleUid = null;
  }
  async function batchDelRules(type) {
    const s = type === 'add' ? uiState.ruleSelAdd : uiState.ruleSelSub;
    const ids = Array.from(s);
    if (!ids.length) return CP.toast('请勾选要删除的规则', 'warn');
    const ok = await CP.confirm('批量删除规则', `确定删除选中的 ${ids.length} 条${type === 'add' ? '加分' : '减分'}规则吗？`);
    if (!ok) return;
    let n = 0;
    for (const id of ids) { try { await CP.api(`/rules/${id}`, { method: 'DELETE' }); n++; } catch (e) {} }
    s.clear(); CP.toast(`已删除 ${n} 条规则`, 'success'); switchPage('rules');
  }
  function showAddRule(type) {
    CP.modal(`<h3>新增${type === 'add' ? '加分' : '减分'}规则</h3>
      <div class="form-row"><label class="form-label">原因</label><input id="ar-reason" class="form-input"></div>
      <div class="form-row"><label class="form-label">积分值</label><input id="ar-points" type="number" class="form-input" value="${type === 'add' ? 10 : 5}" min="1"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doAddRule('${type}')">添加</button></div>`);
  }
  async function doAddRule(type) {
    const reason = $('ar-reason').value.trim();
    let points = Math.abs(parseInt($('ar-points').value) || 0);
    if (!reason) return CP.toast('请输入原因', 'warn');
    if (points <= 0) return CP.toast('积分值必须为正整数', 'warn');
    try { await CP.api('/rules', { method: 'POST', body: { type, reason, points } }); CP.toast('添加成功', 'success'); CP.closeModal(); switchPage('rules'); }
    catch (e) { CP.failToast(e, '添加失败'); }
  }
  function showEditRule(id, type) {
    const r = appData.rules.find(x => x.id === id);
    if (!r) return;
    if (r.is_builtin) return CP.toast('内置规则不可修改', 'warn');
    CP.modal(`<h3>编辑${type === 'add' ? '加分' : '减分'}规则</h3>
      <div class="form-row"><label class="form-label">原因</label><input id="er-reason" class="form-input" value="${CP.esc(r.reason)}"></div>
      <div class="form-row"><label class="form-label">积分值（正整数）</label><input id="er-points" type="number" class="form-input" value="${Math.abs(r.points)}" min="1"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doEditRule(${id},'${type}')">保存</button></div>`);
  }
  async function doEditRule(id, type) {
    const r = appData.rules.find(x => x.id === id);
    if (!r) return;
    const reason = $('er-reason').value.trim();
    let points = Math.abs(parseInt($('er-points').value) || 0);
    if (!reason) return CP.toast('请输入原因', 'warn');
    if (points <= 0) return CP.toast('积分值必须为正整数', 'warn');
    try {
      await CP.api(`/rules/${id}`, { method: 'PUT', body: { reason, points, type } });
      CP.toast('已保存', 'success'); CP.closeModal(); switchPage('rules');
    } catch (e) { CP.failToast(e, '保存失败'); }
  }
  function showBatchAddRule(type) {
    CP.modal(`<h3>批量新增${type === 'add' ? '加分' : '减分'}规则</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">每行一条：原因,积分值</p>
      <div class="form-row"><textarea id="bar-text" class="form-textarea" style="min-height:200px" placeholder="${type === 'add' ? '主动发言,5&#10;帮助同学,10' : '迟到,-5&#10;未交作业,-10'}"></textarea></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doBatchAddRule('${type}')">批量添加</button></div>`);
  }
  async function doBatchAddRule(type) {
    const text = $('bar-text').value.trim();
    if (!text) return CP.toast('请输入数据', 'warn');
    const lines = text.split('\n').filter(l => l.trim());
    let n = 0;
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 2) continue;
      const reason = parts[0]; let pts = parseInt(parts[1]);
      if (isNaN(pts)) continue;
      pts = Math.abs(pts); // 统一存正数，sub 由 type 表达方向
      try { await CP.api('/rules', { method: 'POST', body: { type, reason, points: pts } }); n++; } catch (e) {}
    }
    CP.toast(`成功添加 ${n} 条规则`, 'success'); CP.closeModal(); switchPage('rules');
  }
  async function doDelRule(id) {
    const ok = await CP.confirm('删除规则', '确定删除此规则吗？');
    if (!ok) return;
    try { await CP.api(`/rules/${id}`, { method: 'DELETE' }); CP.toast('已删除', 'success'); switchPage('rules'); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }

  /* ============================================================
     班级动态（与前台 /new 同构：最近三卡 + 历史按发布者递归）
     ============================================================ */
  function dayStart(t) { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }
  function weekStart(t) { const d = new Date(dayStart(t)); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.getTime(); }
  function monthStart(t) { const d = new Date(t); d.setDate(1); d.setHours(0,0,0,0); return d.getTime(); }
  function annFiltered() {
    return appData.announcements.filter(a => uiState.annCat === '全部' || (a.category || '通知公告') === uiState.annCat);
  }
  function annCardHtml(a) {
    const total = a.device_total || 0, rc = a.read_count || 0;
    const allRead = total > 0 && rc >= total;
    return `
      <div class="ann-card" onclick="App.showAnnDetail(${a.id})">
        <div class="ann-card-head">
          <div class="ann-card-title">${CP.esc(a.title)}</div>
          <div class="ann-card-actions" onclick="event.stopPropagation()">
            ${a.file_url ? `<a class="icon-btn" href="${CP.esc(a.file_url)}" target="_blank" title="查看附件"><i class="fas fa-paperclip"></i></a>` : ''}
            ${a.edited ? `<button class="icon-btn" style="color:var(--blue)" title="历史版本" onclick="App.showAnnVersions(${a.id})"><i class="fas fa-clock-rotate-left"></i></button>` : ''}
            <button class="icon-btn" style="color:var(--orange)" title="编辑" onclick="App.showEditAnn(${a.id})"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" style="color:var(--red)" title="删除" onclick="App.doDelAnn(${a.id})"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="ann-card-meta">
          <span class="badge" style="background:var(--fill);color:var(--text-2);font-weight:500">${CP.esc(a.category || '通知公告')}</span>
          ${a.edited ? `<span class="badge" style="background:rgba(255,149,0,.15);color:var(--orange)" title="编辑人：${CP.esc(a.editor || '')}"><i class="fas fa-pen" style="font-size:9px"></i> 已编辑 · ${CP.fmtTime(a.updated_at || a.created_at, true)}</span>` : ''}
          ${a.file_name ? `<span class="badge" style="background:var(--primary-soft);color:var(--primary)"><i class="fas fa-paperclip" style="font-size:9px"></i> ${CP.esc(a.file_name)}</span>` : ''}
        </div>
        <div class="ann-card-foot">
          <span class="ann-card-time"><i class="far fa-clock"></i> ${CP.fmtTime(a.created_at, true)}</span>
          <span class="badge" style="${allRead ? 'background:rgba(52,199,89,.15);color:var(--green)' : 'background:rgba(255,149,48,.12);color:var(--orange)'}">${allRead ? '全部已读' : (total === 0 ? '未读' : '已读 ' + rc + '/' + total)}</span>
        </div>
      </div>`;
  }
  function renderAnnPage() {
    const list = annFiltered();
    const now = Date.now();
    const ws = weekStart(now), ms = monthStart(now);
    const ranges = [
      { key: 'week', label: '本周消息', desc: '本周发布的动态', icon: 'fa-calendar-week' },
      { key: 'lastweek', label: '上周消息', desc: '上一个自然周', icon: 'fa-calendar' },
      { key: 'month', label: '本月消息', desc: '本月发布的动态', icon: 'fa-calendar-days' },
    ];
    const inRange = (a, key) => {
      const t = a.created_at;
      if (key === 'week') return t >= ws;
      if (key === 'lastweek') { const lws = ws - 7*86400000; return t >= lws && t < ws; }
      if (key === 'month') return t >= ms;
      return true;
    };
    // 按发布者分组（历史递归）
    const pubs = {};
    list.forEach(a => { const p = a.author || 'teacher'; (pubs[p] = pubs[p] || []).push(a); });
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">班级动态</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary" onclick="App.showAddAnn()"><i class="fas fa-plus"></i> 发布公告</button>
      </div>
      <div class="chip-row" style="margin-bottom:16px">
        ${['全部', ...CATEGORIES].map(c => `<button class="chip ${uiState.annCat === c ? 'on' : ''}" onclick="App.setAnnCat('${c}')">${c}</button>`).join('')}
      </div>
      ${annBreadcrumb()}
      <div id="ann-body"></div>
    </div>`;
    const body = $('ann-body');

    if (uiState.annView === 'range') {
      const r = uiState.annRange;
      const items = list.filter(a => inRange(a, r));
      body.innerHTML = items.length ? `<div class="ann-cards">` + items.map(annCardHtml).join('') + `</div>`
        : '<div class="empty"><i class="fas fa-inbox"></i><p>该时间段暂无动态</p></div>';
      return;
    }
    if (uiState.annView === 'pub') {
      const pub = uiState.annPub;
      const items = list.filter(a => (a.author || 'teacher') === pub);
      const years = {};
      items.forEach(a => { const y = new Date(a.created_at).getFullYear(); (years[y] = years[y] || []).push(a); });
      body.innerHTML = `<div class="ann-cards">` + Object.keys(years).sort((a,b)=>b-a).map(y => `
        <div class="ann-card" onclick="App.annGoYear('${pub}',${y})">
          <div class="ann-card-head"><div class="ann-card-title"><i class="fas fa-calendar" style="margin-right:8px;color:var(--text-3)"></i>${y} 年</div>
          <div class="ann-card-actions"><span class="text-3" style="font-size:12px">${years[y].length} 条 <i class="fas fa-chevron-right text-3"></i></span></div></div>
        </div>`).join('') + `</div>`;
      return;
    }
    if (uiState.annView === 'year') {
      const pub = uiState.annPub, y = uiState.annYear;
      const items = list.filter(a => (a.author || 'teacher') === pub && new Date(a.created_at).getFullYear() === y);
      const months = {};
      items.forEach(a => { const m = new Date(a.created_at).getMonth(); (months[m] = months[m] || []).push(a); });
      body.innerHTML = `<div class="ann-cards">` + Object.keys(months).sort((a,b)=>b-a).map(m => `
        <div class="ann-card" onclick="App.annGoMonth(${m})">
          <div class="ann-card-head"><div class="ann-card-title"><i class="fas fa-calendar" style="margin-right:8px;color:var(--text-3)"></i>${y} 年 ${Number(m)+1} 月</div>
          <div class="ann-card-actions"><span class="text-3" style="font-size:12px">${months[m].length} 条 <i class="fas fa-chevron-right text-3"></i></span></div></div>
        </div>`).join('') + `</div>`;
      return;
    }
    if (uiState.annView === 'month') {
      const pub = uiState.annPub, y = uiState.annYear, m = uiState.annMonth;
      const items = list.filter(a => (a.author || 'teacher') === pub && new Date(a.created_at).getFullYear() === y && new Date(a.created_at).getMonth() === m);
      const days = {};
      items.forEach(a => { const d = new Date(a.created_at).getDate(); (days[d] = days[d] || []).push(a); });
      body.innerHTML = `<div class="ann-cards">` + Object.keys(days).sort((a,b)=>b-a).map(d => `
        <div class="ann-card" onclick="App.annGoDay(${d})">
          <div class="ann-card-head"><div class="ann-card-title"><i class="fas fa-calendar-day" style="margin-right:8px;color:var(--text-3)"></i>${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}</div>
          <div class="ann-card-actions"><span class="text-3" style="font-size:12px">${days[d].length} 条 <i class="fas fa-chevron-right text-3"></i></span></div></div>
        </div>`).join('') + `</div>`;
      return;
    }
    if (uiState.annView === 'day') {
      const { pub, y, m, d } = uiState;
      const items = list.filter(a => (a.author || 'teacher') === pub &&
        new Date(a.created_at).getFullYear() === y && new Date(a.created_at).getMonth() === m && new Date(a.created_at).getDate() === d);
      body.innerHTML = items.length ? `<div class="ann-cards">` + items.map(annCardHtml).join('') + `</div>`
        : '<div class="empty"><p>当日暂无动态</p></div>';
      return;
    }
    // home: 最近三卡 + 历史按发布者
    body.innerHTML = `
      <h3 class="sec-t">最近消息</h3>
      <div class="grid gap-14" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:20px">
        ${ranges.map(r => {
          const n = list.filter(a => inRange(a, r.key)).length;
          return `<div class="card" style="padding:16px;cursor:pointer" onclick="App.annGoRange('${r.key}')">
            <i class="fas ${r.icon}" style="color:var(--primary);font-size:22px"></i>
            <div style="font-weight:700;margin-top:8px">${r.label}</div>
            <div class="text-3" style="font-size:12px;margin-top:2px">${r.desc}</div>
            <div style="font-size:22px;font-weight:800;margin-top:8px;color:var(--primary)">${n}</div>
          </div>`;
        }).join('')}
      </div>
      <h3 class="sec-t">历史消息</h3>
      ${Object.keys(pubs).length === 0 ? '<p class="text-3" style="font-size:13px">暂无动态</p>' :
        `<div class="ann-cards">` + Object.keys(pubs).sort().map(p => `
        <div class="ann-card" onclick="App.annGoPub('${p}')">
          <div class="ann-card-head">
            <div class="ann-card-title"><i class="fas fa-user" style="margin-right:8px;color:var(--text-3)"></i>${CP.esc(p)}</div>
            <div class="ann-card-actions"><span class="text-3" style="font-size:12px">${pubs[p].length} 条 <i class="fas fa-chevron-right text-3"></i></span></div>
          </div>
        </div>`).join('') + `</div>`}
    `;
  }
  function annBreadcrumb() {
    const v = uiState.annView;
    const home = `<a href="javascript:void(0)" onclick="App.annGoHome()" style="color:var(--primary)">班级动态</a>`;
    if (v === 'range') return `<div class="text-3" style="font-size:12px;margin-bottom:12px">${home} / ${uiState.annRange === 'week' ? '本周消息' : uiState.annRange === 'lastweek' ? '上周消息' : '本月消息'}</div>`;
    if (v === 'pub') return `<div class="text-3" style="font-size:12px;margin-bottom:12px">${home} / ${CP.esc(uiState.annPub)} / 年</div>`;
    if (v === 'year') return `<div class="text-3" style="font-size:12px;margin-bottom:12px">${home} / ${CP.esc(uiState.annPub)} / ${uiState.annYear} 年</div>`;
    if (v === 'month') return `<div class="text-3" style="font-size:12px;margin-bottom:12px">${home} / ${CP.esc(uiState.annPub)} / ${uiState.annYear} 年 ${uiState.annMonth + 1} 月</div>`;
    if (v === 'day') return `<div class="text-3" style="font-size:12px;margin-bottom:12px">${home} / ${CP.esc(uiState.annPub)} / ${uiState.annYear}-${String(uiState.annMonth+1).padStart(2,'0')}-${String(uiState.annDay).padStart(2,'0')}</div>`;
    return '';
  }
  function annGoHome() { uiState.annView = 'home'; renderAnnPage(); }
  function annGoRange(r) { uiState.annView = 'range'; uiState.annRange = r; renderAnnPage(); }
  function annGoPub(p) { uiState.annView = 'pub'; uiState.annPub = p; renderAnnPage(); }
  function annGoYear(p, y) { uiState.annView = 'year'; uiState.annPub = p; uiState.annYear = y; renderAnnPage(); }
  function annGoMonth(m) { uiState.annView = 'month'; uiState.annMonth = Number(m); renderAnnPage(); }
  function annGoDay(d) { uiState.annView = 'day'; uiState.annDay = Number(d); renderAnnPage(); }
  function setAnnCat(c) { uiState.annCat = c; renderAnnPage(); }
  function showAnnDetail(id) {
    const a = appData.announcements.find(x => x.id === id); if (!a) return;
    const total = a.device_total || 0, rc = a.read_count || 0;
    CP.modal(`<h3>${CP.esc(a.title)}</h3>
      <div class="text-3" style="font-size:12px;margin-bottom:12px">${CP.esc(a.category || '')} · ${CP.fmtTime(a.created_at, true)} · ${a.edited ? '已编辑' : ''} 已读 ${rc}/${total}</div>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;max-height:60vh;overflow:auto">${CP.esc(a.content || '(无正文)')}</div>
      ${a.file_name ? `<div style="margin-top:12px"><a class="btn btn-soft btn-sm" href="${CP.esc(a.file_url)}" target="_blank"><i class="fas fa-paperclip"></i> ${CP.esc(a.file_name)}</a></div>` : ''}
      <div class="modal-foot"><button class="btn btn-primary" onclick="CP.closeModal()">关闭</button></div>`);
  }
  function showAddAnn(draft) {
    uiState.annEditingId = null;
    draft = draft || {};
    const cat = draft.category || '通知公告';
    CP.modal(`<h3>${draft.id ? '编辑班级动态' : '发布班级动态'}</h3>
      <div class="form-row"><label class="form-label">标题 *</label><input id="an-title" class="form-input" value="${CP.esc(draft.title || '')}"></div>
      <div class="form-row"><label class="form-label">分类</label><select id="an-category" class="form-select">
        ${CATEGORIES.map(c => `<option value="${c}" ${c === cat ? 'selected' : ''}>${c}</option>`).join('')}
      </select></div>
      <div class="form-row"><label class="form-label">正文</label><textarea id="an-content" class="form-textarea">${CP.esc(draft.content || '')}</textarea></div>
      <div class="form-row"><label class="form-label">附件（可选）</label><input type="file" id="an-file">
        ${draft.fileName ? `<div class="form-hint">当前附件：${CP.esc(draft.fileName)}（不重新选择则保留）</div>` : ''}
        ${draft.fileNote ? `<div class="form-hint" style="color:var(--red)">${CP.esc(draft.fileNote)}</div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doAddAnn()"><i class="fas fa-cloud-arrow-up"></i> ${draft.id ? '保存修改' : '发布'}</button></div>`);
  }
  function showEditAnn(id) {
    const a = appData.announcements.find(x => x.id === id); if (!a) return;
    uiState.annEditingId = id;
    showAddAnn({ id, title: a.title, content: a.content, category: a.category || '通知公告', fileName: a.file_name });
  }
  async function doAddAnn() {
    const id = uiState.annEditingId;
    const title = $('an-title').value.trim();
    if (!title) return CP.toast('请输入标题', 'warn');
    const content = $('an-content').value.trim();
    const category = $('an-category').value;
    const file = $('an-file').files[0];
    const fileNote = file ? '' : '';
    CP.closeModal();
    const card = CP.uploadCard(id ? '保存修改' : '发布班级动态');
    try {
      const payload = { title, content, category };
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        const up = await CP.api('/upload', { method: 'POST', body: fd, onProgress: (l, t) => card.progress(l, t) });
        Object.assign(payload, { file_url: up.url, file_name: up.name, file_type: up.type, file_size: up.size });
      } else {
        card.stage('正在保存…');
      }
      await CP.api(id ? `/announcements/${id}` : '/announcements', { method: id ? 'PUT' : 'POST', body: payload });
      card.done();
      CP.toast(id ? '已保存' : '发布成功', 'success');
      uiState.annEditingId = null;
      if (uiState.page === 'announcements') await switchPage('announcements');
    } catch (e) {
      card.fail();
      CP.failToast(e, id ? '保存失败' : '发布失败');
      showAddAnn({ id, title, content, category, fileNote });
    }
  }
  async function showAnnVersions(id) {
    CP.modal('<h3>历史版本</h3><p class="text-3" style="font-size:12px">加载中…</p>');
    try {
      const res = await CP.api(`/announcements/${id}/versions`);
      const list = res.data || [];
      if (!list.length) { CP.modal('<h3>历史版本</h3><p class="text-3" style="font-size:13px">暂无历史版本</p><div class="modal-foot"><button class="btn btn-primary" onclick="CP.closeModal()">关闭</button></div>'); return; }
      CP.modal(`<h3>历史版本</h3>
        <div style="max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:10px">
        ${list.map(v => `<div style="padding:12px;background:var(--fill);border-radius:12px">
          <div class="flex aic" style="gap:8px"><b style="font-size:14px">${CP.esc(v.title)}</b>
            <span class="text-3" style="font-size:11px">${CP.esc(v.editor || '')} · ${CP.fmtTime(v.created_at, true)}</span></div>
          <div class="text-2" style="font-size:13px;margin-top:6px;white-space:pre-wrap">${CP.esc(v.content || '(无正文)')}</div>
          ${v.file_name ? `<div style="margin-top:6px"><a class="btn btn-soft btn-sm" href="${CP.esc(v.file_url)}" target="_blank"><i class="fas fa-paperclip"></i> 下载 ${CP.esc(v.file_name)}</a></div>` : ''}
        </div>`).join('')}
        </div>
        <div class="modal-foot"><button class="btn btn-primary" onclick="CP.closeModal()">关闭</button></div>`);
    } catch (e) { CP.failToast(e, '加载历史版本失败'); }
  }
  async function doDelAnn(id) {
    const ok = await CP.confirm('删除动态', '确定删除此动态吗？');
    if (!ok) return;
    try { await CP.api(`/announcements/${id}`, { method: 'DELETE' }); CP.toast('已删除', 'success'); switchPage('announcements'); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }

  /* ============================================================
     排行榜
     ============================================================ */
  function renderRankingsPage() {
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">排行榜</h2>
        <div class="segmented">
          <button data-t="individual" class="${uiState.rankTab === 'individual' ? 'active' : ''}" onclick="App.switchRankTab('individual')"><i class="fas fa-user"></i> 个人</button>
          <button data-t="group" class="${uiState.rankTab === 'group' ? 'active' : ''}" onclick="App.switchRankTab('group')"><i class="fas fa-users"></i> 小组</button>
          <button data-t="tier" class="${uiState.rankTab === 'tier' ? 'active' : ''}" onclick="App.switchRankTab('tier')"><i class="fas fa-crown"></i> 段位</button>
        </div>
      </div>
      <div id="rank-page-content"></div>
    </div>`;
    renderRankPageContent();
  }
  function switchRankTab(t) {
    uiState.rankTab = t;
    document.querySelectorAll('.segmented button[data-t]').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    renderRankPageContent();
  }
  function renderRankPageContent() {
    const c = $('rank-page-content'); if (!c) return;
    const type = uiState.rankTab;
    const fLeader = appData.config.avatar_frame_leaderboard === '1';
    const fTier = appData.config.avatar_frame_tier === '1';
    if (type === 'individual') {
      const sorted = appData.students.slice().sort((a, b) => b.points - a.points);
      if (!sorted.length) { c.innerHTML = '<div class="empty"><i class="fas fa-trophy"></i><p>暂无学生</p></div>'; return; }
      c.innerHTML = `<div class="rank-list">` + sorted.map((s, i) => {
        const g = getGroup(s.group_id);
        const t = tierOf(s.points);
        const pos = i + 1;
        const sub = [g.id ? g.name : '未分组', s.student_no ? '学号 ' + s.student_no : ''].filter(Boolean).join(' · ');
        return `<div class="rank-item">
          <div class="rk-pos ${pos <= 3 ? 'p' + pos : ''}">${pos}</div>
          ${CP.avatarHTML(s.avatar, { size: 30, frame: fLeader ? t.frame : '' })}
          <div class="rk-info"><div class="rk-name">${CP.esc(s.name)}</div><div class="rk-sub">${CP.esc(sub)}</div></div>
          <div class="rk-pts ${s.points < 0 ? 'neg' : ''}">${s.points}</div>
        </div>`;
      }).join('') + `</div>`;
    } else if (type === 'group') {
      const gs = appData.groups.map(g => {
        const ms = appData.students.filter(s => s.group_id === g.id);
        const avg = ms.length ? ms.reduce((s, x) => s + x.points, 0) / ms.length : 0;
        return Object.assign({}, g, { avg, count: ms.length, origIdx: appData.groups.findIndex(x => x.id === g.id) });
      }).sort((a, b) => b.avg - a.avg);
      if (!gs.length) { c.innerHTML = '<div class="empty"><i class="fas fa-users"></i><p>暂无小组</p></div>'; return; }
      c.innerHTML = `<div class="rank-list">` + gs.map((g, i) => {
        const pos = i + 1;
        const avHTML = g.avatar
          ? (CP.resolveAvatar(g.avatar).img
            ? `<div class="rk-av" style="width:30px;height:30px;border-radius:8px;overflow:hidden;flex:none;border:2px solid ${g.color}"><img src="${CP.esc(CP.resolveAvatar(g.avatar).img)}" style="width:100%;height:100%;object-fit:cover" draggable="false"></div>`
            : `<div class="rk-av" style="width:30px;height:30px;border-radius:8px;flex:none;border:2px solid ${g.color};display:flex;align-items:center;justify-content:center;font-size:14px;background:${g.color}1c">${CP.esc(g.avatar)}</div>`)
          : `<div class="rk-av" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${g.color}1c;color:${g.color};flex:none"><i class="fas fa-users"></i></div>`;
        return `<div class="rank-item">
          <div class="rk-pos ${pos <= 3 ? 'p' + pos : ''}">${pos}</div>
          ${avHTML}
          <div class="rk-info">
            <div class="rk-name">${CP.esc(g.name)} <span class="badge" style="background:${g.color}1c;color:${g.color}">第${g.origIdx + 1}组</span></div>
            <div class="rk-sub">${g.count} 名成员 · 平均</div>
          </div>
          <div class="rk-pts">${g.avg.toFixed(2)}</div>
        </div>`;
      }).join('') + `</div>`;
    } else {
      const withT = appData.students.map(s => Object.assign({}, s, { tier: tierOf(s.points) })).sort((a, b) => b.tier.order - a.tier.order || b.points - a.points);
      if (!withT.length) { c.innerHTML = '<div class="empty"><i class="fas fa-crown"></i><p>暂无学生</p></div>'; return; }
      const dist = {};
      withT.forEach(s => { dist[s.tier.name] = (dist[s.tier.name] || 0) + 1; });
      let html = `<div class="tier-dist"><div class="tier-dist-t">段位分布</div><div class="tier-pills">` +
        Object.entries(dist).map(([name, count]) => {
          const t = TIERS.find(x => x.name === name) || TIERS[0];
          return `<button class="tier-pill" style="color:${t.color}" onclick="App.showTierStudents('${CP.esc(name)}')">${CP.esc(name)} · ${count}</button>`;
        }).join('') + `</div></div><div class="rank-list">`;
      html += withT.map(s => {
        const g = getGroup(s.group_id);
        const t = s.tier;
        const isTop = t.order === 31;
        const range = t.max - t.min;
        const prog = isTop ? 100 : Math.min(100, Math.round(((s.points - t.min) / range) * 100));
        const sub = [g.id ? g.name : '未分组', s.student_no ? '学号 ' + s.student_no : ''].filter(Boolean).join(' · ');
        return `<div class="rank-item" style="flex-direction:column;align-items:stretch;padding:10px">
          <div class="flex aic gap-10">
            ${CP.avatarHTML(s.avatar, { size: 34, frame: fTier ? t.frame : '' })}
            <div class="rk-info"><div class="rk-name">${CP.esc(s.name)}</div><div class="rk-sub">${CP.esc(sub)}</div></div>
            <div class="rk-pts" style="color:${t.color}">${s.points}</div>
          </div>
          <div class="tier-bar-wrap" style="background:${t.color}14">
            <div class="tier-bar-h"><i class="fas ${t.icon}" style="color:${t.color};font-size:11px"></i>
              <span class="tier-bar-n" style="color:${t.color}">${t.name}</span>
              <span class="tier-bar-r">${isTop ? t.min + '+' : t.min + '-' + t.max}</span></div>
            <div class="tier-bar"><div class="tier-bar-f" style="width:${prog}%;background:${t.color}"></div></div>
            <div class="tier-bar-fo">${isTop ? '已达最高段位' : (s.points >= t.max ? '已达本段位上限' : `还需 ${t.max - s.points + 1} 分晋级`)}</div>
          </div>
        </div>`;
      }).join('');
      html += `</div>`;
      c.innerHTML = html;
    }
  }
  function showTierStudents(tierName) {
    const students = appData.students.filter(s => tierOf(s.points).name === tierName);
    const t = TIERS.find(x => x.name === tierName) || TIERS[0];
    CP.modal(`<h3 style="color:${t.color}"><i class="fas ${t.icon}" style="margin-right:6px"></i>${CP.esc(tierName)}</h3>
      <p class="text-2" style="font-size:13px;margin:0 0 12px">共 ${students.length} 名学生</p>
      ${students.length === 0 ? '<div class="empty"><i class="fas fa-user"></i><p>暂无学生</p></div>' :
        '<div class="flex" style="flex-direction:column;gap:8px">' + students.map(s => {
          const g = getGroup(s.group_id);
          return `<div class="flex aic gap-10" style="padding:10px;background:var(--fill);border-radius:10px">
            ${CP.avatarHTML(s.avatar, { size: 36 })}
            <div class="flex1 min-w-0"><div style="font-size:13px;font-weight:600">${CP.esc(s.name)}</div>
              <div class="text-3" style="font-size:11px;margin-top:1px">${CP.esc(g.id ? g.name : '未分组')}</div></div>
            <div style="font-weight:800;color:${t.color}">${s.points}</div></div>`;
        }).join('') + '</div>'}
      <div class="modal-foot"><button class="btn btn-primary" onclick="CP.closeModal()">关闭</button></div>`);
  }

  /* ============================================================
     历史记录
     ============================================================ */
  function renderRecordsPage() {
    const isSuper = currentUser.role === 'super';
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">历史记录</h2>
        <span class="spacer"></span>
        ${isSuper ? `<button class="btn btn-warning btn-sm" onclick="App.showFabricate()"><i class="fas fa-flask"></i> 拟造加减分</button>` : ''}
        <input type="date" id="rec-start" class="form-input" style="width:150px">
        <input type="date" id="rec-end" class="form-input" style="width:150px">
        <button class="btn btn-soft" onclick="App.loadRecords()"><i class="fas fa-search"></i> 查询</button>
      </div>
      <div id="rec-box"><div class="empty"><span class="spinner"></span><p style="margin-top:10px">加载中…</p></div></div>
    </div>`;
    loadRecords();
  }
  function showFabricate() {
    const stuOpts = appData.students.map(s => `<option value="${s.id}">${CP.esc(s.name)}</option>`).join('');
    const grpOpts = appData.groups.map(g => `<option value="${g.id}">${CP.esc(g.name)}</option>`).join('');
    const box = CP.modal(`
      <h3><i class="fas fa-flask" style="color:var(--orange);margin-right:7px"></i>拟造加减分</h3>
      <p class="text-2" style="margin:0 0 12px">仅超管可见，会在记录中标记「拟造」。</p>
      <div class="form-row"><label class="form-label">对象类型</label>
        <select id="fb-target" class="form-select"><option value="student">学生</option><option value="group">小组</option></select></div>
      <div class="form-row"><label class="form-label">对象</label>
        <select id="fb-id-student" class="form-select">${stuOpts}</select>
        <select id="fb-id-group" class="form-select" style="display:none">${grpOpts}</select></div>
      <div class="form-row"><label class="form-label">原因</label>
        <input id="fb-reason" class="form-input" maxlength="50" placeholder="拟造原因"></div>
      <div class="form-row"><label class="form-label">分值（带符号）</label>
        <input id="fb-points" type="number" class="form-input" value="1" style="text-align:center;font-weight:700"></div>
      <div class="form-row"><label class="form-label">时间</label>
        <input id="fb-time" type="datetime-local" class="form-input"></div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">提交</button>
      </div>`, { size: 'sm' });
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    box.querySelector('#fb-time').value = now.toISOString().slice(0, 16);
    box.querySelector('#fb-target').onchange = function() {
      box.querySelector('#fb-id-student').style.display = this.value === 'student' ? '' : 'none';
      box.querySelector('#fb-id-group').style.display = this.value === 'group' ? '' : 'none';
    };
    box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
    box.querySelector('[data-act=ok]').onclick = async () => {
      const target = box.querySelector('#fb-target').value;
      const id = target === 'student' ? box.querySelector('#fb-id-student').value : box.querySelector('#fb-id-group').value;
      const reason = box.querySelector('#fb-reason').value.trim();
      const points = parseInt(box.querySelector('#fb-points').value);
      const timeStr = box.querySelector('#fb-time').value;
      const time = timeStr ? new Date(timeStr).getTime() : Date.now();
      if (!reason) return CP.toast('请填写原因', 'warn');
      if (!Number.isInteger(points) || points === 0) return CP.toast('分值需为非零整数', 'warn');
      try {
        await CP.api('/points/fabricate', { method: 'POST', body: { target, id: Number(id), reason, points, time } });
        CP.closeModal(); CP.toast('拟造成功', 'success'); loadRecords();
      } catch (e) { CP.failToast(e, '拟造失败'); }
    };
  }
  async function loadRecords() {
    const box = $('rec-box'); if (!box) return;
    const start = $('rec-start').value, end = $('rec-end').value;
    let q = '/records?limit=1000';
    if (start) q += '&start=' + new Date(start + 'T00:00:00').getTime();
    if (end) q += '&end=' + new Date(end + 'T23:59:59.999').getTime();
    const isSuper = currentUser.role === 'super';
    try {
      const res = await CP.api(q);
      const list = res.data || [];
      if (!list.length) { box.innerHTML = '<div class="empty"><i class="fas fa-inbox"></i><p>暂无记录</p></div>'; return; }
      box.innerHTML = `<div class="table-wrap tbl-scroll"><table class="cp-table">
        <thead><tr><th>时间</th><th>学生</th><th>小组</th><th>原因</th><th>操作者</th><th style="text-align:right">积分</th></tr></thead>
        <tbody>` + list.map(r => `<tr>
          <td class="text-3 nowrap">${CP.fmtTime(r.created_at, true)}</td>
          <td style="font-weight:600">${CP.esc(r.student_name || '-')}${isSuper && r.fabricated ? ' <span class="badge badge-orange" style="font-size:10px">拟造</span>' : ''}</td>
          <td class="text-3">${CP.esc(r.group_name || '未分组')}</td>
          <td>${CP.esc(r.reason || '')}</td>
          <td class="text-3" style="font-size:12px">${CP.esc(r.operator || '-')}</td>
          <td style="text-align:right;font-weight:700;color:${r.points > 0 ? 'var(--green)' : r.points < 0 ? 'var(--red)' : 'var(--text)'}">${r.points > 0 ? '+' : ''}${r.points}</td>
        </tr>`).join('') + `</tbody></table></div>
        <div class="text-3" style="text-align:center;padding:12px;font-size:12px">共 ${res.total || list.length} 条记录</div>`;
    } catch (e) { box.innerHTML = `<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>加载失败：${CP.esc(e.message || '')}</p></div>`; }
  }

  /* ============================================================
     导出记录
     ============================================================ */
  function renderExportPage() {
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">导出记录</h2></div>
      <div class="grid gap-14" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
        <div class="stat-tile">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">导出排行榜</div>
          <div class="text-3" style="font-size:12px;margin-bottom:12px">所有学生的排名、姓名、学号、小组、积分、段位</div>
          <button class="btn btn-primary btn-sm" onclick="App.exportRank()"><i class="fas fa-download"></i> 下载 CSV</button>
        </div>
        <div class="stat-tile">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">导出积分流水</div>
          <div class="text-3" style="font-size:12px;margin-bottom:12px">可按日期范围筛选，服务端生成 CSV</div>
          <button class="btn btn-soft btn-sm" onclick="App.showExportRecords()"><i class="fas fa-file-csv"></i> 设置并导出</button>
        </div>
      </div>
    </div>`;
  }
  function exportRank() {
    const rows = [['排名', '姓名', '学号', '小组', '积分', '段位']];
    appData.students.slice().sort((a, b) => b.points - a.points).forEach((s, i) => {
      const g = getGroup(s.group_id);
      rows.push([i + 1, s.name, s.student_no || '', g.name, s.points, tierOf(s.points).name]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `排行榜_${dateStr()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    CP.toast('导出成功', 'success');
  }
  function showExportRecords() {
    CP.modal(`<h3>导出积分流水</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">可指定日期范围，留空导出全部</p>
      <div class="form-row"><label class="form-label">开始日期</label><input type="date" id="exp-start" class="form-input"></div>
      <div class="form-row"><label class="form-label">结束日期</label><input type="date" id="exp-end" class="form-input"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doExportRecords()">导出 CSV</button></div>`);
  }
  async function authDownload(url, filename) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + CP.getAdminToken() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function doExportRecords() {
    const start = $('exp-start').value, end = $('exp-end').value;
    let q = '';
    if (start) q += '&start=' + new Date(start + 'T00:00:00').getTime();
    if (end) q += '&end=' + new Date(end + 'T23:59:59.999').getTime();
    CP.closeModal();
    try {
      await authDownload('/api/export/records?' + q, `积分记录_${dateStr()}.csv`);
      CP.toast('导出已开始', 'success');
    } catch (e) { CP.failToast(e, '导出失败'); }
  }

  /* ============================================================
     数据备份
     ============================================================ */
  function renderBackupPage() {
    uiState.backupSide = uiState.backupSide || 'server';
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">数据备份</h2>
        <span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.doBackupDownload()"><i class="fas fa-download"></i> 下载当前数据</button>
        <button class="btn btn-soft" onclick="App.showRestoreModal()"><i class="fas fa-upload"></i> 从本地文件恢复</button>
      </div>
      <div class="seg-tabs" style="display:flex;gap:6px;background:var(--fill);padding:4px;border-radius:12px;margin-bottom:14px">
        <button class="seg-tab ${uiState.backupSide==='server'?'active':''}" data-side="server" onclick="App.switchBackupSide('server')" style="flex:1;padding:8px;border:none;background:transparent;border-radius:9px;font-size:13px;cursor:pointer;color:${uiState.backupSide==='server'?'var(--text)':'var(--text-3)'};${uiState.backupSide==='server'?'background:var(--bg-elevated);box-shadow:var(--shadow);font-weight:600':''}"><i class="fas fa-display"></i> 服务器</button>
        <button class="seg-tab ${uiState.backupSide==='cloud'?'active':''}" data-side="cloud" onclick="App.switchBackupSide('cloud')" style="flex:1;padding:8px;border:none;background:transparent;border-radius:9px;font-size:13px;cursor:pointer;color:${uiState.backupSide==='cloud'?'var(--text)':'var(--text-3)'};${uiState.backupSide==='cloud'?'background:var(--bg-elevated);box-shadow:var(--shadow);font-weight:600':''}"><i class="fas fa-cloud"></i> Cloudflare</button>
      </div>
      <div id="bk-box"><div class="empty"><span class="spinner"></span><p style="margin-top:10px">加载中…</p></div></div>
    </div>`;
    loadBackupList();
  }
  function switchBackupSide(side) {
    uiState.backupSide = side;
    renderBackupPage();
  }
  async function loadBackupList() {
    const box = $('bk-box'); if (!box) return;
    const side = uiState.backupSide || 'server';
    let list = [], unreachable = false;
    try {
      const res = await CP.api('/backup/list?side=' + encodeURIComponent(side));
      list = (res && res.data) || [];
      if (res && res.unreachable) unreachable = true;
    } catch (e) {
      unreachable = true;
    }
    const totalBytes = list.reduce((s, b) => s + (Number(b.size) || 0), 0);
    const fmtSize = b => b >= 1048576 ? (b/1048576).toFixed(2) + ' MB' : (b/1024).toFixed(1) + ' KB';
    const infoHtml = `
      <div style="display:flex;align-items:center;gap:14px;padding:10px 14px;background:var(--fill);border-radius:12px;margin-bottom:14px;font-size:12px;color:var(--text-2)">
        <span><b style="color:var(--text)">${list.length}</b> 份备份</span>
        <span>占用 <b style="color:var(--text)">${fmtSize(totalBytes)}</b></span>
        <span class="spacer"></span>
        <button class="btn btn-primary btn-sm" onclick="App.doBackupCreate()"><i class="fas fa-cloud-arrow-up"></i> 立即备份</button>
      </div>`;
    if (unreachable) {
      box.innerHTML = infoHtml + '<div class="empty"><i class="fas fa-wifi"></i><p>另一处暂时无法连接</p></div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = infoHtml + '<div class="empty"><i class="fas fa-cloud"></i><p>暂无备份</p></div>';
      return;
    }
    const cards = list.slice().sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(b => {
      const key = b.key || b.r2_key || '';
      return `
      <div class="msg-card" style="display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:10px;background:var(--bg-elevated);border-radius:14px;box-shadow:var(--shadow)">
        <div style="width:38px;height:38px;border-radius:10px;background:var(--fill);display:flex;align-items:center;justify-content:center;color:var(--primary)"><i class="fas fa-database"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px">
            <span class="mono" style="font-size:12px">${CP.esc(b.filename)}</span>
            <span class="badge ${b.type === 'auto' ? 'badge-blue' : 'badge-orange'}" style="font-size:10px">${b.type === 'auto' ? '自动' : '手动'}</span>
          </div>
          <div class="text-3" style="font-size:11px;margin-top:3px">${CP.fmtTime(b.created_at)} · ${fmtSize(b.size)}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" title="下载" onclick="App.downloadBackup('${CP.esc(key)}')"><i class="fas fa-download"></i></button>
          <button class="icon-btn" title="恢复" onclick="App.restoreFromCloud('${CP.esc(key)}')"><i class="fas fa-rotate-left"></i></button>
          <button class="icon-btn" style="color:var(--red)" title="删除" onclick="App.deleteBackup('${CP.esc(key)}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
    box.innerHTML = infoHtml + cards;
  }
  async function doBackupCreate() {
    const side = uiState.backupSide || 'server';
    try {
      const res = await CP.api('/backup/create', { method: 'POST', body: { type: 'manual', side } });
      CP.toast(`备份成功（${((res.size || 0) / 1024).toFixed(1)} KB）`, 'success');
      loadBackupList();
    } catch (e) { CP.failToast(e, '备份失败'); }
  }
  async function doBackupDownload() {
    try {
      const res = await CP.api('/snapshot');
      const snap = (res && res.data) || {};
      const backup = { version: '4.0', exportedAt: new Date().toISOString(), students: snap.students, groups: snap.groups, rules: snap.rules, announcements: snap.announcements, config: snap.config };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `班级积分备份_${dateStr()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      CP.toast('下载成功', 'success');
    } catch (e) { CP.failToast(e, '下载失败'); }
  }
  async function downloadBackup(key) {
    const side = uiState.backupSide || 'server';
    try { await authDownload('/api/backup/download?key=' + encodeURIComponent(key) + '&side=' + encodeURIComponent(side), 'backup_' + dateStr() + '.json'); }
    catch (e) { CP.failToast(e, '下载失败'); }
  }
  async function restoreFromCloud(key) {
    const side = uiState.backupSide || 'server';
    const ok = await CP.confirm('恢复备份', '恢复将覆盖当前所有数据，确定继续？');
    if (!ok) return;
    try {
      const r = await fetch('/api/backup/download?key=' + encodeURIComponent(key) + '&side=' + encodeURIComponent(side), { headers: { Authorization: 'Bearer ' + CP.getAdminToken() } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      await CP.api('/backup/restore', { method: 'POST', body: { backupData: data } });
      CP.toast('恢复成功', 'success'); switchPage('backup');
    } catch (e) { CP.failToast(e, '恢复失败'); }
  }
  async function deleteBackup(key) {
    const side = uiState.backupSide || 'server';
    const ok = await CP.confirm('删除备份', '确定删除此备份吗？');
    if (!ok) return;
    try { await CP.api('/backup/delete', { method: 'POST', body: { key, side } }); CP.toast('已删除', 'success'); loadBackupList(); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }
  function showRestoreModal() {
    CP.modal(`<h3>从本地文件恢复</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">选择 JSON 备份文件，将覆盖当前数据</p>
      <div class="form-row"><input type="file" id="rf" accept=".json"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doRestoreFile()">导入并恢复</button></div>`);
  }
  async function doRestoreFile() {
    const file = $('rf').files[0];
    if (!file) return CP.toast('请选择文件', 'warn');
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await CP.api('/backup/restore', { method: 'POST', body: { backupData: data } });
      CP.toast('恢复成功', 'success'); CP.closeModal(); switchPage('backup');
    } catch (e) { CP.failToast(e, '恢复失败'); }
  }

  /* ============================================================
     账号安全
     ============================================================ */
  function renderSecurityPage() {
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">账号安全</h2></div>
      <div style="max-width:480px">
        <h3 class="sec-t">修改密码</h3>
        <div class="form-row"><label class="form-label">新密码</label><input type="password" id="sec-pwd" class="form-input" placeholder="至少 4 位" autocomplete="new-password"></div>
        <button class="btn btn-primary" onclick="App.doChangePwd()"><i class="fas fa-key"></i> 修改密码</button>
      </div>
    </div>`;
  }
  async function doChangePwd() {
    const np = $('sec-pwd').value;
    if (np.length < 4) return CP.toast('密码至少 4 位', 'warn');
    try { await CP.api('/auth/change-password', { method: 'POST', body: { newPassword: np } }); CP.toast('密码已修改', 'success'); $('sec-pwd').value = ''; }
    catch (e) { CP.failToast(e, '修改失败'); }
  }

  /* ============================================================
     系统设置（班级信息 / 激活码管理 / 头像框 / 邮件通知）
     ============================================================ */
  function renderSettingsPage() {
    const isSuper = currentUser.role === 'super';
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">系统设置</h2></div>

      <h3 class="sec-t">班级信息</h3>
      <div class="form-row"><label class="form-label">网站标题</label>
        <input id="set-sitetitle" class="form-input" value="${CP.esc(appData.config.site_title || '班级积分系统')}"></div>
      <button class="btn btn-primary" onclick="App.saveSiteTitle()"><i class="fas fa-save"></i> 保存</button>

      <h3 class="sec-t mt-20">激活码管理</h3>
      <p class="text-3" style="font-size:12px;margin:0 0 10px">给每台新设备生成一次性激活码；删除码会同时使其已激活设备失效。</p>
      <button class="btn btn-primary" style="margin-bottom:12px" onclick="App.showGenCode()"><i class="fas fa-key"></i> 生成激活码</button>
      <div id="dev-code-list"></div>

      <h3 class="sec-t mt-20">段位头像框</h3>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.avatar_frame_leaderboard === '1' ? 'checked' : ''} onchange="App.saveCfg('avatar_frame_leaderboard',this.checked)"><span class="slider"></span></label><span>个人排行榜显示头像框</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.avatar_frame_cards === '1' ? 'checked' : ''} onchange="App.saveCfg('avatar_frame_cards',this.checked)"><span class="slider"></span></label><span>学生卡片显示头像框</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.avatar_frame_tier === '1' ? 'checked' : ''} onchange="App.saveCfg('avatar_frame_tier',this.checked)"><span class="slider"></span></label><span>段位排行榜显示头像框</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.modal_blur_enabled !== '0' ? 'checked' : ''} onchange="App.saveCfg('modal_blur_enabled',this.checked)"><span class="slider"></span></label><span>弹窗背景模糊（低配设备可关闭）</span></div>

      <h3 class="sec-t mt-20">前台体验</h3>
      <div class="form-row"><label class="form-label">右键菜单标题</label>
        <input id="set-ctx-menu-title" class="form-input" value="${CP.esc(appData.config.ctx_menu_title || '你想干嘛？')}" placeholder="你想干嘛？"></div>
      <div class="form-row"><label class="form-label">一言卡片链接</label>
        <input id="set-saying-link" class="form-input" value="${CP.esc(appData.config.saying_link || 'https://uapis.cn')}" placeholder="https://uapis.cn"></div>
      <button class="btn btn-primary" onclick="App.saveFrontUI()"><i class="fas fa-save"></i> 保存前台设置</button>

      <h3 class="sec-t mt-20">通知与系统</h3>
      <div class="form-row"><label class="form-label">忘记密码救援邮箱</label>
        <input id="set-rescue-email" class="form-input" value="${CP.esc(appData.config.rescue_email || 'admin@example.com')}"></div>
      <div class="form-row"><label class="form-label">版本信息</label>
        <input id="set-system-version" class="form-input" value="${CP.esc(appData.config.system_version || 'v4.4（2026-10-15）')}"></div>
      <button class="btn btn-primary" onclick="App.saveSysInfo()"><i class="fas fa-save"></i> 保存系统信息</button>

      ${isSuper ? `
      <h3 class="sec-t mt-20">邮件通知（Resend）</h3>
      <div class="form-row"><label class="form-label">Resend API Key</label><div id="resend-key-area"></div></div>
      <div class="form-row"><label class="form-label">发件地址</label><input id="set-from" class="form-input" value="${CP.esc(appData.config.resend_from || 'onboarding@resend.dev')}"></div>
      <div class="form-row"><label class="form-label">通知接收邮箱</label><input id="set-notify-email" class="form-input" value="${CP.esc(appData.config.notify_email || 'admin@example.com')}" placeholder="admin@example.com"></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.notify_on_login === '1' ? 'checked' : ''} onchange="App.saveCfg('notify_on_login',this.checked)"><span class="slider"></span></label><span>登录后台时通知</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.notify_on_backup === '1' ? 'checked' : ''} onchange="App.saveCfg('notify_on_backup',this.checked)"><span class="slider"></span></label><span>备份成功时通知（手动/自动）</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.notify_on_device_code === '1' ? 'checked' : ''} onchange="App.saveCfg('notify_on_device_code',this.checked)"><span class="slider"></span></label><span>生成激活码时通知</span></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.notify_on_master_code === '1' ? 'checked' : ''} onchange="App.saveCfg('notify_on_master_code',this.checked)"><span class="slider"></span></label><span>万能激活码使用时通知</span></div>
      <button class="btn btn-primary" onclick="App.saveResendFrom()"><i class="fas fa-save"></i> 保存邮件设置</button>
      ` : ''}

      <h3 class="sec-t mt-20">群聊与通知（WxPusher）</h3>
      <p class="text-3" style="font-size:12px;margin:0 0 10px">新消息通过 WxPusher 推送到微信/Windows 客户端；三个成员（前台大屏 / 班主任 / 超管）分别绑定自己的 UID 即可收到。</p>
      <div class="form-row"><label class="form-label">群名</label>
        <input id="wxp-group-name" class="form-input" value="${CP.esc(appData.config.chat_group_name || '二班群')}"></div>
      ${isSuper ? `
      <div class="form-row"><label class="form-label">WxPusher AppToken</label>
        <input id="wxp-app-token" class="form-input" type="password" value="${CP.esc(appData.config.wxpusher_app_token || '')}" placeholder="留空则未配置"></div>
      <div class="switch-row"><label class="switch"><input type="checkbox" ${appData.config.wxpusher_enabled === '1' ? 'checked' : ''} onchange="App.saveWxpSettings({enabled:this.checked?'1':'0'})"><span class="slider"></span></label><span>启用 WxPusher 推送</span></div>
      ` : `<p class="text-3" style="font-size:12px">AppToken 与开关由超管配置。</p>`}
      <button class="btn btn-primary" onclick="App.saveWxpSettings()"><i class="fas fa-save"></i> 保存群聊设置</button>
      <div id="wxp-members-box" style="margin-top:12px"></div>
    `;
    if (isSuper) renderResendKeyArea();
    loadDeviceCodes();
    loadWxpMembers();
  }

  async function loadWxpMembers() {
    const box = $('wxp-members-box'); if (!box) return;
    try {
      const s = await CP.api('/wxpusher/status');
      const rows = [
        { key: 'front', name: s.me && s.me.role === 'front' ? s.me.name : '前台大屏（二班学生）' },
        { key: 'teacher', name: '班主任' },
        { key: 'admin', name: '超级管理员' },
      ];
      box.innerHTML = '<div class="table-wrap"><table class="cp-table"><thead><tr><th>成员</th><th>角色</th><th>状态</th><th style="width:200px">操作</th></tr></thead><tbody>' +
        rows.map(r => {
          const m = (s.members || []).find(x => x.member_key === r.key);
          const bound = m && m.bound;
          const roleName = m ? (m.role === 'super' ? '管理员' : m.role === 'teacher' ? '老师' : '前台') : r.key;
          return `<tr>
            <td>${CP.esc(m ? m.name : r.name)}</td>
            <td>${CP.esc(roleName)}</td>
            <td>${bound ? '<span class="badge badge-blue">已绑定</span>' : '<span class="badge">未绑定</span>'}</td>
            <td>
              ${bound ? `<button class="btn btn-sm btn-danger" onclick="App.wxpUnbind('${r.key}')">解绑</button>`
                      : `<button class="btn btn-sm btn-primary" onclick="App.wxpBind('${r.key}')">绑定</button>`}
            </td>
          </tr>`;
        }).join('') + '</tbody></table></div>';
    } catch (e) { box.innerHTML = '<p class="text-3">加载绑定状态失败</p>'; }
  }

  async function wxpBind(memberKey) {
    try {
      const r = await CP.api('/wxpusher/bind-qrcode', { method: 'POST', body: { member_key: memberKey } });
      if (!r.ok) { CP.toast(r.error || '绑定失败', 'error'); return; }
      CP.modal(`<h3>绑定：${CP.esc(memberKey)}</h3>
        <p style="font-size:13px;color:var(--text-2)">用 WxPusher App（手机/电脑客户端）扫码，或点关注链接完成绑定。</p>
        <div style="text-align:center;margin:8px 0">
          ${r.image ? `<img src="${CP.esc(r.image)}" style="max-width:240px;border:1px solid var(--line)">` : ''}
        </div>
        ${r.url ? `<p style="font-size:12px;word-break:break-all;color:var(--text-2)">关注链接：<br>${CP.esc(r.url)}</p>` : ''}
        <div class="modal-foot">
          ${r.url ? `<button class="btn" onclick="App.copyWxpUrl('${CP.esc(r.url)}')"><i class="fas fa-copy"></i> 复制关注链接</button>` : ''}
          <button class="btn btn-primary" onclick="CP.closeModal()">关闭</button>
        </div>`, { size: 'sm' });
    } catch (e) { CP.toast(e.message || '绑定失败', 'error'); }
  }

  async function wxpUnbind(memberKey) {
    try {
      await CP.api('/wxpusher/unbind', { method: 'POST', body: { member_key: memberKey } });
      CP.toast('已解绑', 'success');
      loadWxpMembers();
    } catch (e) { CP.toast(e.message || '解绑失败', 'error'); }
  }

  async function saveWxpSettings(extra) {
    try {
      const body = Object.assign({}, extra || {});
      const gn = $('wxp-group-name') && $('wxp-group-name').value;
      if (gn) body.group_name = gn;
      const at = $('wxp-app-token') && $('wxp-app-token').value;
      if (at) body.app_token = at;
      await CP.api('/wxpusher/settings', { method: 'POST', body });
      CP.toast('已保存', 'success');
      refreshData();
    } catch (e) { CP.toast(e.message || '保存失败', 'error'); }
  }

  async function copyWxpUrl(url) {
    try { await navigator.clipboard.writeText(url); CP.toast('已复制', 'success'); }
    catch { CP.toast('复制失败', 'error'); }
  }

  /* ----- 段位规则编辑 ----- */
  function currentTierRows() {
    try {
      let tr = appData.config.tier_rules;
      if (typeof tr === 'string') tr = JSON.parse(tr);
      if (Array.isArray(tr) && tr.length >= 2) {
        // 转换为 {name, from, to}
        return tr.map((t, i) => {
          const from = Number(t.min);
          const to = i + 1 < tr.length ? Number(tr[i + 1].min) - 1 : null;
          return { name: t.name, from, to };
        });
      }
    } catch (e) {}
    return getTierList().map((t, i) => ({ name: t.name, from: t.min, to: (getTierList()[i + 1] ? getTierList()[i + 1].min - 1 : null) }));
  }
  function renderTierRules() {
    const box = $('tier-rules-box'); if (!box) return;
    const rows = currentTierRows();
    box.innerHTML = `<p class="text-3" style="font-size:12px;margin:0 0 10px">填写每段分值范围，最后一段留空表示无上限。</p>
      <div class="table-wrap"><table class="cp-table"><thead><tr><th style="width:40px">#</th><th>段位名称</th><th style="width:130px">起（≥）</th><th style="width:130px">止（≤）</th><th style="width:60px"></th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr>
        <td class="text-3">${i + 1}</td>
        <td><input class="form-input tier-name" data-i="${i}" value="${CP.esc(r.name)}" style="padding:7px 10px"></td>
        <td><input class="form-input tier-from" data-i="${i}" type="number" value="${r.from}" ${i === 0 ? 'disabled' : ''} style="padding:7px 10px"></td>
        <td><input class="form-input tier-to" data-i="${i}" type="number" value="${r.to == null ? '' : r.to}" placeholder="无上限" style="padding:7px 10px"></td>
        <td><button class="icon-btn" style="color:var(--red)" onclick="App.tierDelRow(${i})"><i class="fas fa-trash"></i></button></td>
      </tr>`).join('') + `</tbody></table></div>`;
  }
  function tierAddRow() {
    const rows = currentTierRows();
    const last = rows[rows.length - 1];
    const newFrom = last.to == null ? (last.from + 100) : (last.to + 1);
    rows.push({ name: '新段位', from: newFrom, to: null });
    appData.config.tier_rules = rows.map(r => ({ name: r.name, min: r.from }));
    renderTierRules();
  }
  function tierDelRow(i) {
    const rows = currentTierRows();
    if (rows.length <= 2) return CP.toast('至少保留 2 个段位', 'warn');
    rows.splice(i, 1);
    appData.config.tier_rules = rows.map(r => ({ name: r.name, min: r.from }));
    renderTierRules();
  }
  async function saveTierRules() {
    const names = [...document.querySelectorAll('.tier-name')].map(x => x.value.trim());
    const froms = [...document.querySelectorAll('.tier-from')].map(x => Number(x.value));
    const tos = [...document.querySelectorAll('.tier-to')].map(x => x.value === '' ? null : Number(x.value));
    if (names.length < 2 || names.length > 60) return CP.toast('段位数量需在 2~60 之间', 'warn');
    if (names.some(n => !n)) return CP.toast('段位名称不能为空', 'warn');
    if (froms[0] !== 0) return CP.toast('首段起分必须为 0', 'warn');
    for (let i = 0; i < names.length; i++) {
      if (!Number.isInteger(froms[i]) || froms[i] < 0) return CP.toast(`第 ${i + 1} 段起分必须为非负整数`, 'warn');
      if (tos[i] != null && (!Number.isInteger(tos[i]) || tos[i] < froms[i])) return CP.toast(`第 ${i + 1} 段止分必须 ≥ 起分`, 'warn');
    }
    for (let i = 0; i < names.length - 1; i++) {
      if (tos[i] == null) return CP.toast(`第 ${i + 1} 段不是末段，止分不可留空`, 'warn');
      if (froms[i + 1] !== tos[i] + 1) return CP.toast(`第 ${i + 1} 段止分(${tos[i]}) 与下一段起分(${froms[i + 1]}) 不连续`, 'warn');
    }
    const payload = names.map((n, i) => ({ name: n, min: froms[i] }));
    try {
      await CP.api('/config', { method: 'PUT', body: { tier_rules: JSON.stringify(payload) } });
      appData.config.tier_rules = payload;
      CP.toast('段位规则已保存', 'success');
    } catch (e) { CP.failToast(e, '保存失败'); }
  }

  /* ----- 数据同步状态 ----- */
  async function saveSiteTitle() {
    const v = $('set-sitetitle').value.trim();
    try { await CP.api('/config', { method: 'PUT', body: { site_title: v } }); appData.config.site_title = v; document.title = v + ' · 后台'; $('logo-text').textContent = v; CP.toast('保存成功', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function saveCfg(key, val) {
    try {
      await CP.api('/config', { method: 'PUT', body: { [key]: val ? '1' : '0' } });
      appData.config[key] = val ? '1' : '0';
      // 弹窗背景模糊开关：立即生效，无需刷新
      if (key === 'modal_blur_enabled') {
        CP.bootstrap.modal_blur_enabled = val ? '1' : '0';
        CP.applyModalBlur();
      }
      CP.toast('已保存', 'success');
    }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function saveResendFrom() {
    const from = $('set-from').value.trim();
    const email = $('set-notify-email') ? $('set-notify-email').value.trim() : '';
    try { await CP.api('/config', { method: 'PUT', body: { resend_from: from, notify_email: email } }); CP.toast('邮件设置已保存', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  /* v4.4 系统信息保存 / 提示音 */
  async function saveSysInfo() {
    const body = {
      rescue_email: $('set-rescue-email').value.trim(),
      system_version: $('set-system-version').value.trim(),
    };
    try { await CP.api('/config', { method: 'PUT', body }); Object.assign(appData.config, body); CP.toast('系统信息已保存', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function saveFrontUI() {
    const body = {
      ctx_menu_title: $('set-ctx-menu-title').value.trim(),
      saying_link: $('set-saying-link').value.trim(),
    };
    try { await CP.api('/config', { method: 'PUT', body }); Object.assign(appData.config, body); CP.toast('前台设置已保存', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  function onNotifySoundChange() {
    const v = $('set-notify-sound').value;
    $('notify-sound-url-row').style.display = v === 'custom' ? '' : 'none';
  }
  async function uploadNotifySound() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/mpeg,audio/mp3';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const fd = new FormData(); fd.append('file', f);
        const r = await CP.api('/upload', { method: 'POST', body: fd });
        const url = r.url || (r.data && r.data.url) || '';
        $('set-notify-sound-url').value = url;
        CP.toast('已上传，记得点保存', 'success');
      } catch (e) { CP.failToast(e, '上传失败'); }
    };
    inp.click();
  }
  /* v4.4 段位规则独立页 */
  function renderTierRulesPage() {
    $('main-content').innerHTML = `
    <div class="card page-card">
      <div class="page-header"><h2 class="page-title" style="margin:0">段位规则</h2>
        <div class="flex aic gap-10">
          <button class="btn btn-soft btn-sm" onclick="App.tierAddRow()"><i class="fas fa-plus"></i> 新增段位</button>
          <button class="btn btn-primary btn-sm" onclick="App.saveTierRules()"><i class="fas fa-save"></i> 保存</button>
        </div></div>
      <p class="text-3" style="font-size:12px;margin:0 0 10px">按最低积分升序；首段最低分固定为 0；上限由下一段最低分推导，最高段无上限。</p>
      <div id="tier-rules-box"></div>
    </div>`;
    renderTierRules();
  }
  /* v4.4 super 站点管理 */
  function parseSites() {
    try {
      let s = appData.config.sites;
      if (typeof s === 'string') s = JSON.parse(s);
      if (Array.isArray(s)) return s.map(x => ({ name: x.name || '', url: x.url || '' }));
    } catch (e) {}
    return [{ name: '主站', url: 'https://points.example.com' }, { name: '备用站', url: 'https://points1.example.com' }];
  }
  function renderSuperSitesPage() {
    const sites = parseSites();
    $('main-content').innerHTML = `
    <div class="card page-card">
      <div class="page-header"><h2 class="page-title" style="margin:0">站点管理</h2>
        <button class="btn btn-primary btn-sm" onclick="App.sitesAddRow()"><i class="fas fa-plus"></i> 添加站点</button></div>
      <p class="text-3" style="font-size:12px;margin:0 0 12px">前台站点切换器显示以下站点列表；至少保留 1 个。</p>
      <div id="sites-list"></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="App.saveSites()"><i class="fas fa-save"></i> 保存站点列表</button>
    </div>`;
    renderSitesRows(sites);
  }
  function renderSitesRows(sites) {
    const box = $('sites-list'); if (!box) return;
    box.innerHTML = sites.map((s, i) => `
      <div class="flex aic gap-10" style="padding:10px;background:var(--fill);border-radius:12px;margin-bottom:8px" draggable="true" data-i="${i}">
        <i class="fas fa-grip-vertical text-3"></i>
        <span class="site-dot" data-url="${CP.esc(s.url)}" style="width:8px;height:8px;border-radius:50%;background:#ccc;display:inline-block"></span>
        <input class="form-input site-name" data-i="${i}" value="${CP.esc(s.name)}" style="max-width:140px;padding:7px 10px" placeholder="名称">
        <input class="form-input site-url" data-i="${i}" value="${CP.esc(s.url)}" style="flex:1;padding:7px 10px" placeholder="https://">
        <span class="site-latency text-3" style="font-size:11px;min-width:40px"></span>
        <button class="icon-btn" title="上移" onclick="App.sitesMoveRow(${i},-1)"><i class="fas fa-arrow-up"></i></button>
        <button class="icon-btn" title="下移" onclick="App.sitesMoveRow(${i},1)"><i class="fas fa-arrow-down"></i></button>
        <button class="icon-btn" style="color:var(--red)" onclick="App.sitesDelRow(${i})"><i class="fas fa-trash"></i></button>
      </div>`).join('');
    // v5.1: 拖拽排序
    box.querySelectorAll('[draggable]').forEach(row => {
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', row.dataset.i); });
      row.addEventListener('dragover', e => { e.preventDefault(); });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        const to = parseInt(row.dataset.i);
        if (isNaN(from) || isNaN(to) || from === to) return;
        const s = parseSites();
        const [item] = s.splice(from, 1);
        s.splice(to, 0, item);
        appData.config.sites = JSON.stringify(s);
        renderSitesRows(s);
      });
    });
    refreshSitesHealth();
  }
  async function refreshSitesHealth() {
    try {
      const r = await CP.api('/admin/sites-health', { handle401: false });
      if (!r || !r.sites) return;
      document.querySelectorAll('.site-dot').forEach(d => {
        const url = d.dataset.url;
        const h = r.sites.find(x => x.url === url);
        if (h && h.online) { d.style.background = '#30d158'; d.nextElementSibling.nextElementSibling.nextElementSibling.textContent = h.latency_ms + 'ms'; }
        else { d.style.background = '#ff3b30'; d.nextElementSibling.nextElementSibling.nextElementSibling.textContent = 'offline'; }
      });
    } catch {}
  }
  function sitesMoveRow(i, delta) {
    const s = parseSites();
    const j = i + delta;
    if (j < 0 || j >= s.length) return;
    const [item] = s.splice(i, 1);
    s.splice(j, 0, item);
    appData.config.sites = JSON.stringify(s);
    renderSitesRows(s);
  }
  function sitesAddRow() {
    const s = parseSites(); s.push({ name: '新站点', url: '' });
    appData.config.sites = JSON.stringify(s);
    renderSitesRows(s);
  }
  function sitesDelRow(i) {
    const s = parseSites();
    if (s.length <= 1) return CP.toast('至少保留 1 个站点', 'warn');
    s.splice(i, 1);
    appData.config.sites = JSON.stringify(s);
    renderSitesRows(s);
  }
  async function saveSites() {
    const names = [...document.querySelectorAll('.site-name')].map(x => x.value.trim());
    const urls = [...document.querySelectorAll('.site-url')].map(x => x.value.trim());
    if (!names.length || !urls.length) return;
    const sites = names.map((n, i) => ({ name: n, url: urls[i] })).filter(s => s.url);
    if (!sites.length) return CP.toast('至少保留 1 个有效站点', 'warn');
    try { await CP.api('/config', { method: 'PUT', body: { sites: JSON.stringify(sites) } }); appData.config.sites = JSON.stringify(sites); CP.toast('站点列表已保存', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  /* v4.4 super 快捷链接 */
  function parseExtLinks() {
    try {
      let e = appData.config.ext_links;
      if (typeof e === 'string') e = JSON.parse(e);
      if (e && typeof e === 'object') return { github: e.github||'', home: e.home||'', blog: e.blog||'' };
    } catch (e) {}
    return { github: '', home: '', blog: '' };
  }
  function renderSuperExtlinksPage() {
    const e = parseExtLinks();
    $('main-content').innerHTML = `
    <div class="card page-card">
      <div class="page-header"><h2 class="page-title" style="margin:0">快捷链接</h2></div>
      <p class="text-3" style="font-size:12px;margin:0 0 12px">前台底部显示的三个外链；留空则前台隐藏对应图标。</p>
      <div class="form-row"><label class="form-label"><i class="fa-brands fa-github"></i> GitHub</label><input id="el-github" class="form-input" value="${CP.esc(e.github)}" placeholder="https://github.com/..."></div>
      <div class="form-row"><label class="form-label"><i class="fas fa-house"></i> 主页</label><input id="el-home" class="form-input" value="${CP.esc(e.home)}" placeholder="https://"></div>
      <div class="form-row"><label class="form-label"><i class="fas fa-blog"></i> 博客</label><input id="el-blog" class="form-input" value="${CP.esc(e.blog)}" placeholder="https://"></div>
      <button class="btn btn-primary" onclick="App.saveExtLinks()"><i class="fas fa-save"></i> 保存</button>
    </div>`;
  }
  async function saveExtLinks() {
    const body = { ext_links: JSON.stringify({
      github: $('el-github').value.trim(),
      home: $('el-home').value.trim(),
      blog: $('el-blog').value.trim(),
    })};
    try { await CP.api('/config', { method: 'PUT', body }); appData.config.ext_links = body.ext_links; CP.toast('已保存', 'success'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  /* v4.4 反馈 / 版本 / 头像菜单 */
  function feedback() { try { if (CP.feedbackModal) return CP.feedbackModal(); } catch (e) {} CP.toast('反馈功能即将上线', 'warn'); }
  function versionToast() {
    const v = (appData.config && appData.config.system_version) || 'v4.4（2026-10-15）';
    try { if (CP.versionToast) return CP.versionToast(); } catch (e) {}
    CP.toast(v, 'info', 3000);
  }
  /* v4.6 头像 popover（吸附头像旁，遮罩/Esc/再点切换） */
  function closeAvatarPop() {
    document.querySelectorAll('.admin-popover').forEach(el => el.remove());
    document.removeEventListener('click', onAvatarPopOutside);
    document.removeEventListener('keydown', onAvatarPopEsc);
  }
  function onAvatarPopOutside(e) {
    if (!e.target.closest('.admin-popover') && !e.target.closest('#user-avatar')) closeAvatarPop();
  }
  function onAvatarPopEsc(e) { if (e.key === 'Escape') closeAvatarPop(); }
  function openPopover(anchorEl, html) {
    closeAvatarPop();
    const pop = document.createElement('div');
    pop.className = 'admin-popover';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    // 定位：anchor 旁，边缘避让
    const r = anchorEl.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    setTimeout(() => {
      document.addEventListener('click', onAvatarPopOutside);
      document.addEventListener('keydown', onAvatarPopEsc);
    }, 0);
    return pop;
  }
  function avatarMenu(ev) {
    if (ev) ev.stopPropagation();
    const me = currentUser;
    const av = me.avatar ? (me.avatar.startsWith('data:') || me.avatar.startsWith('/') ? me.avatar : '/api/file?path=' + encodeURIComponent(me.avatar)) : '';
    const html = `<div style="width:240px;padding:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--fill);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:18px">${av ? `<img src="${CP.esc(av)}" style="width:100%;height:100%;object-fit:cover">` : CP.esc((me.display_name||'?')[0])}</div>
        <div><div style="font-weight:600;font-size:14px">${CP.esc(me.display_name || me.username)}</div>
        <div class="text-3" style="font-size:11px">${me.role === 'super' ? '超级管理员' : '班主任'}</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" style="justify-content:flex-start;width:100%" onclick="App.showProfilePop(this)"><i class="fas fa-user"></i> 个人信息</button>
        <button class="btn" style="justify-content:flex-start;width:100%;color:var(--red)" onclick="App.logout()"><i class="fas fa-right-from-bracket"></i> 退出登录</button>
      </div>
    </div>`;
    openPopover(ev && ev.currentTarget ? ev.currentTarget : $('user-avatar'), html);
  }
  function showProfilePop(anchorBtn) {
    closeAvatarPop();
    const me = currentUser;
    const av = me.avatar ? (me.avatar.startsWith('data:') || me.avatar.startsWith('/') ? me.avatar : '/api/file?path=' + encodeURIComponent(me.avatar)) : '';
    const html = `<div style="width:280px;padding:14px">
      <h3 style="margin:0 0 10px;font-size:15px">个人信息</h3>
      <div class="flex aic gap-12" style="margin-bottom:10px">
        <div id="prof-av-preview" style="width:56px;height:56px;border-radius:50%;background:var(--fill);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:20px">${av ? `<img src="${CP.esc(av)}" style="width:100%;height:100%;object-fit:cover">` : CP.esc((me.display_name||'?')[0])}</div>
        <div class="flex1">
          <div class="form-label" style="font-size:11px">昵称</div>
          <input id="prof-name" class="form-input" value="${CP.esc(me.display_name || '')}" maxlength="12" style="padding:7px 10px">
        </div>
      </div>
      <div class="form-row" style="margin-bottom:10px"><label class="form-label" style="font-size:11px">更换头像</label>
        <input type="file" id="prof-av-file" accept="image/*"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm" onclick="App.closeAvatarPop()">取消</button>
        <button class="btn btn-primary btn-sm" onclick="App.saveProfile()"><i class="fas fa-save"></i> 保存</button>
      </div>
    </div>`;
    openPopover(anchorBtn || $('user-avatar'), html);
  }
  async function saveProfile() {
    const name = $('prof-name').value.trim();
    if (!name) return CP.toast('昵称不能为空', 'warn');
    const body = { display_name: name };
    const f = $('prof-av-file').files[0];
    if (f) {
      try {
        const dataUrl = await compressImage(f, 200 * 1024);
        body.avatar = dataUrl;
      } catch (e) { return CP.failToast(e, '图片处理失败'); }
    }
    try {
      await CP.api('/auth/profile', { method: 'PUT', body });
      Object.assign(currentUser, body);
      updateUserBar();
      closeAvatarPop();
      CP.toast('已保存', 'success');
    } catch (e) { CP.failToast(e, '保存失败'); }
  }
  function compressImage(file, maxBytes) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const MAX = 512;
        if (w > MAX || h > MAX) { const r = MAX / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = 0.85;
        let out = cv.toDataURL('image/jpeg', q);
        while (out.length > maxBytes && q > 0.3) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(img.src);
        resolve(out);
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = URL.createObjectURL(file);
    });
  }

  function renderResendKeyArea() {
    const area = $('resend-key-area'); if (!area) return;
    const has = appData.config.has_resend_key === '1';
    area.innerHTML = has
      ? `<div class="flex aic gap-10">
          <code class="mono" style="flex:1;padding:9px 12px;background:var(--fill);border-radius:10px;font-size:12px">${CP.esc(appData.config.resend_api_key_masked || '')}</code>
          <button class="btn btn-soft btn-sm" onclick="App.showChangeApi()">更改</button>
          <button class="btn btn-danger btn-sm" onclick="App.clearApi()">清除</button>
        </div>`
      : `<button class="btn btn-soft" onclick="App.showChangeApi()"><i class="fas fa-key"></i> 设置 API Key</button>`;
  }
  function showChangeApi() {
    CP.modal(`<h3>更改 Resend API Key</h3>
      <div class="form-row"><label class="form-label">新的 API Key</label><input id="new-api-key" type="password" class="form-input" placeholder="前往 resend.com 获取"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doChangeApi()">保存</button></div>`);
  }
  async function doChangeApi() {
    const key = $('new-api-key').value.trim();
    if (!key) { CP.closeModal(); return; }
    try {
      await CP.api('/config', { method: 'PUT', body: { resend_api_key: key } });
      CP.toast('API Key 已更新', 'success'); CP.closeModal();
      await refreshData(); renderResendKeyArea();
    } catch (e) { CP.failToast(e, '更新失败'); }
  }
  async function clearApi() {
    const ok = await CP.confirm('清除 API Key', '确定清除已配置的 Resend API Key 吗？清除后邮件通知将失效。');
    if (!ok) return;
    try {
      await CP.api('/config', { method: 'PUT', body: { resend_api_key: '' } });
      CP.toast('已清除', 'success'); await refreshData(); renderResendKeyArea();
    } catch (e) { CP.failToast(e, '清除失败'); }
  }

  /* ----- 激活码管理 ----- */
  async function loadDeviceCodes(hlCode) {
    const c = $('dev-code-list'); if (!c) return;
    try {
      const res = await CP.api('/device/list-codes');
      const list = res.data || [];
      if (!list.length) { c.innerHTML = '<p class="text-3" style="font-size:13px">暂无激活码，点上方按钮生成。</p>'; return; }
      c.innerHTML = list.map(d => {
        const used = !!d.used;
        const badge = used ? '<span class="badge badge-red">已使用</span>' : '<span class="badge badge-green">未使用</span>';
        const sub = used
          ? `用于 ${CP.esc(d.used_by || '未知设备')} · ${CP.fmtTime(d.used_at, true)}`
          : `创建于 ${CP.fmtTime(d.created_at)}`;
        return `<div class="row-item">
          <div class="row-icon" style="background:${used ? 'var(--fill)' : 'var(--orange-soft)'};color:${used ? 'var(--text-3)' : 'var(--orange)'}"><i class="fas fa-key"></i></div>
          <div class="row-main">
            <div class="code-val ${d.code === hlCode ? 'hl' : ''}">${CP.esc(d.code)}</div>
            <div class="row-s">${CP.esc(d.label || '未命名')} · ${sub}</div>
          </div>
          ${badge}
          <button class="icon-btn" title="复制" onclick="App.copyCode('${CP.esc(d.code)}')"><i class="fas fa-copy"></i></button>
          <button class="icon-btn" style="color:var(--red)" title="删除" onclick="App.delDeviceCode('${CP.esc(d.code)}')"><i class="fas fa-trash"></i></button>
        </div>`;
      }).join('');
    } catch (e) { c.innerHTML = '<p class="text-red" style="font-size:13px">加载失败：' + CP.esc(e.message || '') + '</p>'; }
  }
  function showGenCode() {
    CP.modal(`<h3>生成激活码</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">给激活码填个备注，方便识别用途。</p>
      <div class="form-row"><label class="form-label">备注 *</label><input id="gen-code-label" class="form-input" placeholder="例如：教室大屏"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doGenCode()">生成</button></div>`);
  }
  async function doGenCode() {
    const label = $('gen-code-label').value.trim();
    if (!label) return CP.toast('请填写备注', 'warn');
    try {
      const res = await CP.api('/device/generate-code', { method: 'POST', body: { label } });
      const code = res.code;
      CP.closeModal();
      CP.modal(`<h3><i class="fas fa-key" style="color:var(--orange);margin-right:6px"></i>设备激活码</h3>
        <div style="text-align:center;padding:18px;background:var(--primary-soft);border-radius:14px;margin-bottom:12px">
          <div class="code-val" id="code-display" style="font-size:24px">${CP.esc(code)}</div>
        </div>
        <p class="text-orange" style="font-size:12px;text-align:center;margin:0 0 8px"><i class="fas fa-triangle-exclamation"></i> 此码仅能激活一台设备，用后自动失效</p>
        <div class="modal-foot">
          <button class="btn" onclick="CP.closeModal()">我已保存</button>
          <button class="btn btn-primary" onclick="App.copyCode('${CP.esc(code)}')"><i class="fas fa-copy"></i> 复制</button>
        </div>`);
      loadDeviceCodes(code);
    } catch (e) { CP.failToast(e, '生成失败'); }
  }
  async function delDeviceCode(code) {
    const ok = await CP.confirm('删除激活码', `确定删除激活码 "${code}" 吗？\n\n删除激活码会同时使其已激活设备失效。`);
    if (!ok) return;
    try {
      const res = await CP.api('/device/delete-code', { method: 'POST', body: { code } });
      const n = (res && res.deletedDevices) || 0;
      CP.toast(n > 0 ? `已删除，同时失效 ${n} 台设备` : '已删除', 'success');
      loadDeviceCodes();
    } catch (e) { CP.failToast(e, '删除失败'); }
  }
  function copyCode(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => CP.toast('已复制到剪贴板', 'success')).catch(() => fallbackCopy(code));
    } else fallbackCopy(code);
  }
  function fallbackCopy(code) {
    const el = document.getElementById('code-display');
    if (!el) { CP.toast('复制失败，请手动选中复制', 'warn'); return; }
    const r = document.createRange(); r.selectNode(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    try { document.execCommand('copy'); CP.toast('已复制', 'success'); }
    catch (e) { CP.toast('复制失败，请手动选中复制', 'warn'); }
  }

  /* ============================================================
     超管：直改积分
     ============================================================ */
  function showSuperSetPoints(sid) {
    const s = appData.students.find(x => x.id === sid); if (!s) return;
    CP.modal(`<h3><i class="fas fa-bolt" style="color:var(--orange);margin-right:6px"></i>直改积分</h3>
      <p class="text-2" style="font-size:13px;margin:0 0 12px">${CP.esc(s.name)} · 当前 ${s.points} 分</p>
      <div style="padding:10px 12px;background:var(--orange-soft);border-radius:10px;font-size:12px;color:var(--orange);margin-bottom:14px;line-height:1.5">
        <i class="fas fa-circle-info"></i> 直接设定积分值，会写入流水与操作日志。
      </div>
      <div class="form-row"><label class="form-label">新的积分值</label>
        <input id="ssp-pts" type="number" class="form-input" style="text-align:center;font-weight:800;font-size:22px" value="${s.points}"></div>
      <div class="form-row"><label class="form-label">备注 / 原因</label><input id="ssp-note" class="form-input" placeholder="可选"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button>
        <button class="btn btn-primary" style="background:var(--orange)" onclick="App.doSuperSetPoints(${sid})">确认修改</button></div>`);
  }
  async function doSuperSetPoints(sid) {
    const points = parseInt($('ssp-pts').value);
    if (isNaN(points)) return CP.toast('请输入有效数字', 'warn');
    const note = $('ssp-note').value.trim();
    try {
      await CP.api('/super/set-points', { method: 'POST', body: { studentId: sid, points, note } });
      CP.toast('积分已修改', 'success'); CP.closeModal(); switchPage('students');
    } catch (e) { CP.failToast(e, '修改失败'); }
  }

  /* ============================================================
     超管：账户管理
     ============================================================ */
  async function renderSuperUsers() {
    let users = [];
    try { const res = await CP.api('/super/users'); users = res.data || []; _usersCache = users; }
    catch (e) { CP.failToast(e, '加载失败'); }
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">账户管理</h2><span class="spacer"></span>
        <button class="btn btn-primary" onclick="App.showAddUser()"><i class="fas fa-plus"></i> 新增账户</button></div>
      <div class="table-wrap tbl-scroll"><table class="cp-table">
        <thead><tr><th>用户名</th><th>角色</th><th>显示名</th><th>最后登录</th><th style="width:120px">操作</th></tr></thead>
        <tbody>` + users.map(u => `<tr>
          <td class="mono" style="font-weight:600">${CP.esc(u.username)}</td>
          <td><span class="badge ${u.role === 'super' ? 'badge-orange' : 'badge-blue'}">${u.role === 'super' ? '超管' : '老师'}</span></td>
          <td>${CP.esc(u.display_name || '-')}</td>
          <td class="text-3 nowrap" style="font-size:12px">${u.last_login ? CP.fmtTime(u.last_login, true) : '从未'}</td>
          <td><div class="btn-group">
            <button class="icon-btn" title="编辑" onclick="App.showEditUser(${u.id})"><i class="fas fa-edit"></i></button>
            ${u.username === 'admin' ? '' : `<button class="icon-btn" style="color:var(--red)" title="删除" onclick="App.delUser(${u.id},'${CP.esc(u.username)}')"><i class="fas fa-trash"></i></button>`}
          </div></td>
        </tr>`).join('') + `</tbody></table></div>
    </div>`;
  }
  function showAddUser() {
    CP.modal(`<h3>新增账户</h3>
      <div class="form-row"><label class="form-label">用户名 *</label><input id="nu-u" class="form-input"></div>
      <div class="form-row"><label class="form-label">密码 *</label><input id="nu-p" type="password" class="form-input" placeholder="至少 4 位"></div>
      <div class="form-row"><label class="form-label">昵称</label><input id="nu-d" class="form-input"></div>
      <div class="form-row"><label class="form-label">角色</label>
        <select id="nu-r" class="form-select"><option value="teacher">班主任</option><option value="super">超级管理员</option></select></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doAddUser()">添加</button></div>`);
  }
  async function doAddUser() {
    const username = $('nu-u').value.trim(), password = $('nu-p').value;
    const display_name = $('nu-d').value.trim(), role = $('nu-r').value;
    if (!username) return CP.toast('请输入用户名', 'warn');
    if (password.length < 4) return CP.toast('密码至少 4 位', 'warn');
    try { await CP.api('/super/users', { method: 'POST', body: { username, password, display_name, role } }); CP.toast('账户已创建', 'success'); CP.closeModal(); switchPage('super-users'); }
    catch (e) { CP.failToast(e, '创建失败'); }
  }
  function showEditUser(id) {
    const u = _usersCache.find(x => x.id === id); if (!u) return;
    CP.modal(`<h3>编辑账户</h3><p class="text-2" style="font-size:13px;margin:0 0 12px">${CP.esc(u.username)}</p>
      <div class="form-row"><label class="form-label">显示名</label><input id="eu-d" class="form-input" value="${CP.esc(u.display_name || '')}"></div>
      <div class="form-row"><label class="form-label">角色</label>
        <select id="eu-r" class="form-select"><option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>班主任</option><option value="super" ${u.role === 'super' ? 'selected' : ''}>超级管理员</option></select></div>
      <div class="form-row"><label class="form-label">新密码（留空不修改）</label><input id="eu-p" type="password" class="form-input" autocomplete="new-password"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="App.doUpdateUser(${u.id})">保存</button></div>`);
  }
  async function doUpdateUser(id) {
    const body = { display_name: $('eu-d').value.trim(), role: $('eu-r').value };
    const np = $('eu-p').value;
    if (np) { if (np.length < 4) return CP.toast('密码至少 4 位', 'warn'); body.newPassword = np; }
    try { await CP.api(`/super/users/${id}`, { method: 'PUT', body }); CP.toast('保存成功', 'success'); CP.closeModal(); switchPage('super-users'); }
    catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function delUser(id, un) {
    const ok = await CP.confirm('删除账户', `确定删除账户 "${un}" 吗？`);
    if (!ok) return;
    try { await CP.api(`/super/users/${id}`, { method: 'DELETE' }); CP.toast('已删除', 'success'); switchPage('super-users'); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }

  /* ============================================================
     超管：登录日志 / 操作审计
     ============================================================ */
  async function renderSuperLogins() {
    let logs = [];
    try { const res = await CP.api('/super/logins?limit=300'); logs = res.data || []; } catch (e) {}
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">登录日志</h2><span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.refreshPage()"><i class="fas fa-rotate"></i> 刷新</button></div>
      ${!logs.length ? '<div class="empty"><i class="fas fa-right-to-bracket"></i><p>暂无记录</p></div>' : `
      <div class="table-wrap tbl-scroll"><table class="cp-table">
        <thead><tr><th>时间</th><th>账户</th><th>角色</th><th>IP</th><th>UA</th><th>结果</th></tr></thead>
        <tbody>` + logs.map(l => `<tr>
          <td class="text-3 nowrap" style="font-size:12px">${CP.fmtTime(l.created_at, true)}</td>
          <td style="font-weight:600">${CP.esc(l.username || '-')}</td>
          <td><span class="badge ${l.role === 'super' ? 'badge-orange' : 'badge-blue'}">${l.role === 'super' ? '超管' : '老师'}</span></td>
          <td class="mono" style="font-size:11px">${CP.esc(l.ip || '-')}</td>
          <td class="ellip-cell" style="font-size:11px" title="${CP.esc(l.ua || '')}">${CP.esc(l.ua || '-')}</td>
          <td>${l.success ? '<span class="text-green" style="font-weight:600">成功</span>' : '<span class="text-red" style="font-weight:600">失败</span>'}</td>
        </tr>`).join('') + `</tbody></table></div>`}
    </div>`;
  }
  async function renderSuperAudit() {
    let logs = [];
    try { const res = await CP.api('/super/audit?limit=300'); logs = res.data || []; } catch (e) {}
    const names = { change_password: '修改密码', generate_device_code: '生成激活码', delete_device_code: '删除激活码', create_user: '创建账户', update_user: '编辑账户', delete_user: '删除账户', delete_device: '删除设备', super_set_points: '超管直改积分', batch_delete_students: '批量删除学生', batch_delete_groups: '批量删除小组', master_code: '万能码使用', device_code: '激活码使用', login: '登录', backup: '备份' };
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">操作审计</h2><span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.refreshPage()"><i class="fas fa-rotate"></i> 刷新</button></div>
      ${!logs.length ? '<div class="empty"><i class="fas fa-clipboard-list"></i><p>暂无记录</p></div>' : `
      <div class="table-wrap tbl-scroll"><table class="cp-table">
        <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>` + logs.map(l => `<tr>
          <td class="text-3 nowrap" style="font-size:12px">${CP.fmtTime(l.created_at, true)}</td>
          <td style="font-weight:600">${CP.esc(l.operator || '-')}</td>
          <td><span class="badge badge-blue">${CP.esc(names[l.action] || l.action)}</span></td>
          <td class="ellip-cell" style="font-size:12px" title="${CP.esc(l.target || '')}">${CP.esc(l.target || '-')}</td>
          <td class="ellip-cell" style="font-size:11px" title="${CP.esc(l.detail || '')}">${CP.esc(l.detail || '-')}</td>
          <td class="mono text-3 nowrap" style="font-size:11px">${CP.esc(l.ip || '-')}</td>
        </tr>`).join('') + `</tbody></table></div>`}
    </div>`;
  }

  /* ============================================================
     超管：设备管理（新页面）
     ============================================================ */
  async function renderSuperDevices() {
    let list = [];
    try { const res = await CP.api('/super/devices'); list = res.data || []; } catch (e) {}
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header"><h2 class="page-title" style="margin:0">设备管理</h2><span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.refreshPage()"><i class="fas fa-rotate"></i> 刷新</button></div>
      ${!list.length ? '<div class="empty"><i class="fas fa-mobile-screen"></i><p>暂无已激活设备</p></div>' : `
      <div class="table-wrap tbl-scroll"><table class="cp-table" style="min-width:880px">
        <thead><tr><th>设备名</th><th>UUID</th><th>指纹</th><th>激活码</th><th>IP</th><th>UA</th><th>激活时间</th><th>最后在线</th><th></th></tr></thead>
        <tbody>` + list.map(d => {
      const master = !!d.is_master;
      const codeCell = master
        ? '<span class="badge badge-orange" style="white-space:nowrap">调试码</span>'
        : `<span class="mono" style="font-size:12px;white-space:nowrap">${CP.esc(d.activation_code || '-')}</span>`;
      return `<tr>
        <td class="ellip-cell text-2 nowrap" style="font-weight:600;max-width:140px" title="${CP.esc(d.device_name || d.name || '')}">${CP.esc(d.device_name || d.name || '-')}</td>
        <td class="mono ellip-cell text-3 nowrap" style="font-size:11px;max-width:110px" title="${CP.esc(d.device_uuid || '')}">${CP.esc((d.device_uuid || '').slice(0, 8))}…</td>
        <td class="mono ellip-cell text-3 nowrap" style="font-size:11px;max-width:110px" title="${CP.esc(d.fingerprint || '')}">${CP.esc((d.fingerprint || '').slice(0, 8))}…</td>
        <td class="nowrap">${codeCell}</td>
        <td class="mono text-3 nowrap" style="font-size:11px">${CP.esc(d.ip || '-')}</td>
        <td class="ellip-cell text-3 nowrap" style="font-size:11px;max-width:220px" title="${CP.esc(d.ua || '')}">${CP.esc(d.ua || '-')}</td>
        <td class="text-3 nowrap" style="font-size:11px">${CP.fmtTime(d.created_at, true)}</td>
        <td class="text-3 nowrap" style="font-size:11px">${CP.fmtTime(d.last_seen)}</td>
        <td class="nowrap"><button class="icon-btn" style="color:var(--red)" onclick="App.delDevice(${d.id})"><i class="fas fa-trash"></i></button></td>
      </tr>`;
    }).join('') + `</tbody></table></div>`}
    </div>`;
  }
  async function delDevice(id) {
    const ok = await CP.confirm('删除设备', '删除后该设备将立即下线并需重新激活。');
    if (!ok) return;
    try { await CP.api(`/super/devices/${id}`, { method: 'DELETE' }); CP.toast('已删除', 'success'); switchPage('super-devices'); }
    catch (e) { CP.failToast(e, '删除失败'); }
  }

  /* ============================================================
     前台消息（设备 → 后台）— 双模块结构
     ============================================================ */
  function fmPeriodRange(period) {
    const now = new Date();
    const start = new Date(now);
    if (period === 'week') {
      // 本周一 00:00
      const day = now.getDay() || 7;
      start.setDate(now.getDate() - day + 1);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'lastweek') {
      const day = now.getDay() || 7;
      start.setDate(now.getDate() - day - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start: start.getTime(), end: end.getTime() };
    } else if (period === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    return { start: start.getTime(), end: now.getTime() };
  }
  async function renderFmPage() {
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">前台消息</h2>
        <span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.renderFmPage()"><i class="fas fa-rotate"></i> 刷新</button>
      </div>
      <div id="fm-content"><div class="empty"><span class="spinner"></span><p style="margin-top:10px">加载中…</p></div></div>
    </div>`;
    try {
      const res = await CP.api('/front-messages');
      const list = res.data || [];
      uiState.fmUnread = res.unread != null ? res.unread : list.filter(m => !m.is_read).length;
      uiState.fmList = list;
      updateFmBadge();
      renderFmContent();
    } catch (e) {
      const box = $('fm-content'); if (box) box.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>加载失败</p></div>';
    }
  }
  function renderFmContent() {
    const box = $('fm-content'); if (!box) return;
    const list = uiState.fmList;
    if (!list.length) { box.innerHTML = '<div class="empty"><i class="fas fa-envelope-open"></i><p>暂无前台消息</p></div>'; return; }

    // 模块一：最新消息（按周期统计）
    const periods = [
      { key: 'week', label: '本周', icon: 'fa-calendar-week' },
      { key: 'lastweek', label: '上周', icon: 'fa-calendar' },
      { key: 'month', label: '本月', icon: 'fa-calendar-days' },
    ];
    const periodCounts = {};
    periods.forEach(p => {
      const r = fmPeriodRange(p.key);
      periodCounts[p.key] = list.filter(m => {
        const t = Number(m.created_at) || 0;
        return t >= r.start && t <= r.end;
      }).length;
    });

    let html = `<div class="fm-section-title"><i class="fas fa-clock-rotate-left"></i> 最新消息</div>
      <div class="fm-period-cards">` + periods.map(p => `
        <div class="fm-period-card ${uiState.fmPeriod === p.key ? 'active' : ''}" onclick="App.setFmPeriod('${p.key}')">
          <div class="fm-period-label"><i class="fas ${p.icon}"></i> ${p.label}</div>
          <div class="fm-period-count">${periodCounts[p.key]}</div>
        </div>`).join('') + `</div>`;

    // 当前周期消息列表
    const r = fmPeriodRange(uiState.fmPeriod);
    const periodList = list.filter(m => {
      const t = Number(m.created_at) || 0;
      return t >= r.start && t <= r.end;
    });
    if (periodList.length) {
      html += `<div style="margin-bottom:8px">` + periodList.map(m => fmMessageCardHtml(m)).join('') + `</div>`;
    } else {
      html += `<div class="empty" style="padding:24px"><p>该周期暂无消息</p></div>`;
    }

    // 模块二：历史消息（按设备 → 年 → 月 → 日）
    html += `<div class="fm-section-title" style="margin-top:28px"><i class="fas fa-box-archive"></i> 历史消息</div>`;
    // 按设备分组
    const byDevice = {};
    list.forEach(m => {
      const dn = m.device_name || '未知设备';
      if (!byDevice[dn]) byDevice[dn] = [];
      byDevice[dn].push(m);
    });

    for (const [deviceName, msgs] of Object.entries(byDevice)) {
      html += `<div class="fm-device-group">
        <div class="fm-device-head"><i class="fas fa-mobile-screen"></i> ${CP.esc(deviceName)} <span class="text-3" style="font-weight:400;font-size:11px">(${msgs.length} 条)</span></div>`;
      // 按年分组
      const byYear = {};
      msgs.forEach(m => {
        const d = new Date(Number(m.created_at));
        const y = d.getFullYear();
        if (!byYear[y]) byYear[y] = {};
        const mo = d.getMonth() + 1;
        if (!byYear[y][mo]) byYear[y][mo] = {};
        const day = d.getDate();
        if (!byYear[y][mo][day]) byYear[y][mo][day] = [];
        byYear[y][mo][day].push(m);
      });
      const years = Object.keys(byYear).sort((a, b) => b - a);
      years.forEach(y => {
        html += `<div class="fm-year-group"><div class="fm-year-label">${y} 年</div>`;
        const months = Object.keys(byYear[y]).sort((a, b) => b - a);
        months.forEach(mo => {
          html += `<div class="fm-month-group"><div class="fm-month-label">${mo} 月</div>`;
          const days = Object.keys(byYear[y][mo]).sort((a, b) => b - a);
          days.forEach(day => {
            html += `<div class="fm-day-group"><div class="fm-day-label">${day} 日</div>`;
            byYear[y][mo][day].forEach(m => {
              html += fmMessageCardHtml(m);
            });
            html += `</div>`;
          });
          html += `</div>`;
        });
        html += `</div>`;
      });
      html += `</div>`;
    }

    box.innerHTML = html;
  }
  function fmMessageCardHtml(m) {
    const unread = !m.is_read;
    return `
      <div class="fm-message-card ${unread ? 'unread' : ''}" onclick="App.readFm(${m.id})">
        <div class="fm-msg-icon"><i class="fas ${unread ? 'fa-envelope' : 'fa-envelope-open'}"></i></div>
        <div class="fm-msg-body">
          <div class="fm-msg-title">${unread ? '<span class="fm-msg-unread-dot"></span>' : ''}${CP.esc(m.title)}</div>
          <div class="fm-msg-meta">${CP.esc(m.device_name || '')} · ${CP.fmtTime(m.created_at, true)}</div>
          ${m.content ? `<div class="fm-msg-preview">${CP.esc(m.content.length > 60 ? m.content.slice(0, 60) + '…' : m.content)}</div>` : ''}
          ${m.file_name ? `<div class="fm-msg-meta"><i class="fas fa-paperclip"></i> ${CP.esc(m.file_name)}</div>` : ''}
        </div>
        <div class="fm-msg-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" style="color:var(--red)" title="删除" onclick="App.delFm(${m.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }
  function setFmPeriod(p) { uiState.fmPeriod = p; renderFmContent(); }
  async function readFm(id) {
    try { await CP.api(`/front-messages/${id}/read`, { method: 'POST' }); } catch (e) {}
    // 更新本地状态并重新渲染
    const m = uiState.fmList.find(x => x.id === id);
    if (m) m.is_read = true;
    uiState.fmUnread = Math.max(0, uiState.fmUnread - 1);
    updateFmBadge();
    renderFmContent();
    // 显示详情
    const msg = uiState.fmList.find(x => x.id === id);
    if (msg) {
      CP.modal(`<h3>${CP.esc(msg.title)}</h3>
        <div class="text-3" style="font-size:12px;margin-bottom:12px">${CP.esc(msg.device_name || '')} · ${CP.fmtTime(msg.created_at, true)}</div>
        <div style="white-space:pre-wrap;line-height:1.7;color:var(--text-2)">${CP.esc(msg.content || '(无内容)')}</div>
        ${msg.file_name ? `<div style="margin-top:12px"><a class="btn btn-soft btn-sm" href="${CP.esc(msg.file_url || '#')}" target="_blank"><i class="fas fa-paperclip"></i> ${CP.esc(msg.file_name)}</a></div>` : ''}
        <div class="modal-foot"><button class="btn btn-primary" onclick="CP.closeModal()">关闭</button></div>`);
    }
  }
  async function delFm(id) {
    const ok = await CP.confirm('删除消息', '确定删除此前台消息吗？');
    if (!ok) return;
    try {
      await CP.api(`/front-messages/${id}`, { method: 'DELETE' });
      CP.toast('已删除', 'success');
      renderFmPage();
    } catch (e) { CP.failToast(e, '删除失败'); }
  }
  async function refreshFmBadge() {
    try {
      const res = await CP.api('/front-messages?is_read=0');
      uiState.fmUnread = res.unread != null ? res.unread : (Array.isArray(res.data) ? res.data.length : 0);
      updateFmBadge();
    } catch (e) {}
  }
  function updateFmBadge() {
    const b = $('fm-nav-badge');
    if (uiState.page === 'front-messages') return; // 当前页不显示角标
    if (uiState.fmUnread > 0) {
      if (b) { b.textContent = uiState.fmUnread > 99 ? '99+' : uiState.fmUnread; }
      else { const nav = document.querySelector('.nav-item[data-page="front-messages"]'); if (nav) nav.insertAdjacentHTML('beforeend', `<span class="nav-badge" id="fm-nav-badge">${uiState.fmUnread > 99 ? '99+' : uiState.fmUnread}</span>`); }
    } else if (b) b.remove();
  }

  /* ============================================================
     系统公告
     ============================================================ */
  let sysAnnList = [];
  let sysAnnExpandedId = null;

  function getClosedSysAnn() {
    try { return JSON.parse(localStorage.getItem('closed_sys_ann_uids') || '[]'); } catch (e) { return []; }
  }
  function saveClosedSysAnn(uids) {
    try { localStorage.setItem('closed_sys_ann_uids', JSON.stringify(uids.slice(-200))); } catch (e) {}
  }
  function isSysAnnClosed(uid) { return getClosedSysAnn().includes(uid); }

  async function loadSysAnns() {
    try {
      const res = await CP.api('/system-announcements', { handle401: false });
      sysAnnList = res.data || [];
      updateSysAnnBadge();
    } catch (e) { sysAnnList = []; }
  }
  function sysAnnUnreadCount() {
    return sysAnnList.filter(a => !isSysAnnClosed(a.uid)).length;
  }
  function updateSysAnnBadge() {
    const unread = sysAnnUnreadCount();
    const label = unread > 99 ? '99+' : unread;
    // 侧栏「系统公告」导航项红点
    const navBtn = document.querySelector('.nav-item[data-page="system-announcements"]');
    if (navBtn) {
      let nb = navBtn.querySelector('.nav-badge');
      if (unread > 0) { if (nb) nb.textContent = label; else navBtn.insertAdjacentHTML('beforeend', '<span class="nav-badge">' + label + '</span>'); }
      else if (nb) nb.remove();
    }
    // 更新移动端顶栏铃铛
    const mbell = $('mb-sys-ann-bell');
    if (mbell) {
      let mbadge = mbell.querySelector('.dot-badge');
      if (unread > 0) {
        if (mbadge) mbadge.textContent = label;
        else mbell.insertAdjacentHTML('beforeend', '<span class="dot-badge">' + label + '</span>');
      } else if (mbadge) mbadge.remove();
    }
  }

  async function renderSysAnnPage() {
    const isSuper = currentUser.role === 'super';
    $('main-content').innerHTML = `
    <div class="card page-card fade-in">
      <div class="page-header">
        <h2 class="page-title" style="margin:0">系统公告</h2>
        <span class="spacer"></span>
        <button class="btn btn-soft" onclick="App.renderSysAnnPage()"><i class="fas fa-rotate"></i> 刷新</button>
        ${isSuper ? `<button class="btn btn-primary" onclick="App.showAddSysAnn()"><i class="fas fa-plus"></i> 发布公告</button>` : ''}
      </div>
      <div id="sys-ann-list"><div class="empty"><span class="spinner"></span><p style="margin-top:10px">加载中…</p></div></div>
    </div>`;
    await loadSysAnns();
    renderSysAnnTimeline();
  }
  function mdSafe(text) {
    if (window.CP && CP.mdToHtml) { try { return CP.mdToHtml(text || ''); } catch (e) {} }
    return '<p style="white-space:pre-wrap;font-size:13px">' + CP.esc(text || '') + '</p>';
  }
  function renderSysAnnTimeline() {
    const box = $('sys-ann-list'); if (!box) return;
    const isSuper = currentUser.role === 'super';
    if (!sysAnnList.length) {
      box.innerHTML = '<div class="empty"><i class="fas fa-bullhorn"></i><p>暂无系统公告</p></div>';
      return;
    }
    box.innerHTML = `<div class="sys-ann-timeline">` + sysAnnList.map(a => {
      const expanded = sysAnnExpandedId === a.id;
      const time = CP.fmtTime(a.created_at, true);
      return `
        <div class="sys-ann-tl-item" style="${a.is_active === 0 ? 'opacity:.55' : ''}">
          <div class="sys-ann-tl-time">${time} · ${CP.esc(a.created_by || '管理员')} ${a.is_active === 0 ? '<span class="badge" style="background:var(--fill);color:var(--text-3)">已停用</span>' : ''}</div>
          <div class="sys-ann-tl-title" onclick="App.toggleSysAnnExpand(${a.id})">
            ${CP.esc(a.title)} <i class="fas ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}" style="font-size:10px;color:var(--text-3);float:right"></i>
          </div>
          ${expanded ? `<div class="sys-ann-tl-content md-body">${mdSafe(a.content || '')}</div>` : ''}
          ${isSuper && expanded ? `<div class="sys-ann-tl-actions">
            <button class="btn btn-soft btn-sm" onclick="App.showEditSysAnn(${a.id})"><i class="fas fa-pen"></i> 编辑</button>
            <button class="btn btn-sm" style="background:var(--fill);color:var(--text-2)" onclick="App.toggleSysAnnActive(${a.id})"><i class="fas ${a.is_active === 0 ? 'fa-eye' : 'fa-eye-slash'}"></i> ${a.is_active === 0 ? '启用' : '停用'}</button>
            <button class="btn btn-sm" style="background:var(--red-soft);color:var(--red)" onclick="App.delSysAnn(${a.id})"><i class="fas fa-trash"></i> 删除</button>
          </div>` : ''}
        </div>`;
    }).join('') + `</div>`;
  }
  function toggleSysAnnExpand(id) {
    sysAnnExpandedId = sysAnnExpandedId === id ? null : id;
    renderSysAnnTimeline();
  }
  function sysAnnEditorModal(title, a, saveBtn, saveFn) {
    CP.modal(`<h3>${title}</h3>
      <div class="form-row"><label class="form-label">标题 *</label><input id="sa-title" class="form-input" value="${CP.esc(a ? a.title : '')}"></div>
      <div class="flex aic gap-10" style="margin-bottom:8px">
        <div class="segmented" id="sa-mode">
          <button data-m="edit" class="active" onclick="App.saMode('edit')">编辑</button>
          <button data-m="preview" onclick="App.saMode('preview')">预览</button>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-soft btn-sm" onclick="App.saInsertImg()"><i class="fas fa-image"></i> 插入图片</button>
      </div>
      <div id="sa-edit-wrap"><textarea id="sa-content" class="form-textarea" style="min-height:160px" placeholder="支持 Markdown：# 标题、**加粗**、- 列表、![图片](url)">${CP.esc(a ? a.content || '' : '')}</textarea></div>
      <div id="sa-preview-wrap" style="display:none;min-height:16px;max-height:50vh;overflow:auto;padding:12px;background:var(--fill);border-radius:12px" class="md-body"></div>
      <div class="modal-foot"><button class="btn" onclick="CP.closeModal()">取消</button><button class="btn btn-primary" onclick="${saveFn}">${saveBtn}</button></div>`);
  }
  function saMode(m) {
    document.querySelectorAll('#sa-mode button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
    $('sa-edit-wrap').style.display = m === 'edit' ? '' : 'none';
    $('sa-preview-wrap').style.display = m === 'preview' ? '' : 'none';
    if (m === 'preview') $('sa-preview-wrap').innerHTML = mdSafe($('sa-content').value);
  }
  function showAddSysAnn() { sysAnnEditorModal('发布系统公告', null, '发布', 'App.doAddSysAnn()'); }
  async function saInsertImg() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      CP.toast('上传图片中…', 'info');
      try {
        const up = await CP.api('/upload', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', f); return fd; })() });
        const ta = $('sa-content');
        const md = `![${up.name || 'image'}](${up.url})\n`;
        const pos = ta.selectionStart || ta.value.length;
        ta.value = ta.value.slice(0, pos) + md + ta.value.slice(pos);
        CP.toast('图片已插入', 'success');
      } catch (e) { CP.failToast(e, '图片上传失败'); }
    };
    inp.click();
  }
  async function doAddSysAnn() {
    const title = $('sa-title').value.trim();
    const content = $('sa-content').value.trim();
    if (!title) return CP.toast('请输入标题', 'warn');
    if (!content) return CP.toast('请输入内容', 'warn');
    try {
      await CP.api('/system-announcements', { method: 'POST', body: { title, content } });
      CP.toast('发布成功', 'success');
      CP.closeModal();
      sysAnnExpandedId = null;
      await renderSysAnnPage();
    } catch (e) { CP.failToast(e, '发布失败'); }
  }
  function showEditSysAnn(id) {
    const a = sysAnnList.find(x => x.id === id); if (!a) return;
    sysAnnEditorModal('编辑系统公告', a, '保存', `App.doEditSysAnn(${id})`);
  }
  async function doEditSysAnn(id) {
    const title = $('sa-title').value.trim();
    const content = $('sa-content').value.trim();
    if (!title) return CP.toast('请输入标题', 'warn');
    if (!content) return CP.toast('请输入内容', 'warn');
    try {
      await CP.api(`/system-announcements/${id}`, { method: 'PUT', body: { title, content } });
      CP.toast('已保存', 'success');
      CP.closeModal();
      await renderSysAnnPage();
    } catch (e) { CP.failToast(e, '保存失败'); }
  }
  async function toggleSysAnnActive(id) {
    const a = sysAnnList.find(x => x.id === id); if (!a) return;
    try {
      await CP.api(`/system-announcements/${id}`, { method: 'PUT', body: { title: a.title, content: a.content, is_active: a.is_active === 0 ? 1 : 0 } });
      CP.toast('已更新', 'success'); await renderSysAnnPage();
    } catch (e) { CP.failToast(e, '操作失败'); }
  }
  async function delSysAnn(id) {
    const ok = await CP.confirm('删除公告', '确定删除此系统公告吗？');
    if (!ok) return;
    try {
      await CP.api(`/system-announcements/${id}`, { method: 'DELETE' });
      CP.toast('已删除', 'success');
      await renderSysAnnPage();
    } catch (e) { CP.failToast(e, '删除失败'); }
  }

  // 登录后自动弹最新一条未关闭公告（仅 teacher；admin 只亮角标）
  async function checkNewSysAnns() {
    await loadSysAnns();
    if (currentUser.role === 'super') return; // 超管不自动弹
    const newOnes = sysAnnList.filter(a => !isSysAnnClosed(a.uid)).sort((a, b) => b.created_at - a.created_at);
    if (!newOnes.length) return;
    const a = newOnes[0]; // 只弹最新一条
    CP.modal(`<h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-bullhorn" style="color:var(--orange)"></i> 系统公告</h3>
      <div class="sys-ann-modal-time"><i class="far fa-clock"></i> ${CP.fmtTime(a.created_at, true)} · ${CP.esc(a.created_by || '管理员')}</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:10px">${CP.esc(a.title)}</div>
      <div class="sys-ann-modal-body md-body">${mdSafe(a.content || '')}</div>
      <div class="modal-foot">
        <button class="btn btn-primary" onclick="App.closeSysAnnModal()">我知道了</button>
      </div>`);
    const closed = getClosedSysAnn();
    if (!closed.includes(a.uid)) { closed.push(a.uid); saveClosedSysAnn(closed); }
    updateSysAnnBadge();
  }
  function closeSysAnnModal() { CP.closeModal(); }

  /* ============================================================
     路由表 & 启动
     ============================================================ */
  const PAGE_RENDERERS = {
    students: renderStudentsPage, groups: renderGroupsPage, rules: renderRulesPage,
    announcements: renderAnnPage, rankings: renderRankingsPage, records: renderRecordsPage,
    'front-messages': renderFmPage,
    'system-announcements': renderSysAnnPage,
    export: renderExportPage, backup: renderBackupPage, security: renderSecurityPage,
    settings: renderSettingsPage,
    'tier-rules': renderTierRulesPage,
    'super-users': renderSuperUsers, 'super-logins': renderSuperLogins,
    'super-audit': renderSuperAudit, 'super-devices': renderSuperDevices,
    'super-sites': renderSuperSitesPage, 'super-extlinks': renderSuperExtlinksPage,
  };

  /* ---------- 暴露给 inline onclick ---------- */
  window.App = {
    doSetup, doLogin, sendCode, doReset, showForgot, showLogin, logout,
    fillAccount, siteSwitcher, moreMenu,
    switchPage, refreshPage, goHome,
    toggleStudentBatch, toggleStuSelect, selectAllStudents, clearStudentSel, batchDelStudents,
    showAddStudent, doAddStudent, showEditStudent, doUpdateStudent, doDelStudent,
    showImportStudents, doImportStudents, showTierStudents,
    toggleGroupBatch, toggleGrpSelect, clearGroupSel, batchDelGroups,
    showAddGroup, doAddGroup, showEditGroup, doUpdateGroup, doDelGroup,
    uploadGroupAvatar, resetGroupAvatar, pickColor,
    showImportGroups, doImportGroups,
    toggleRuleSel, batchDelRules, showAddRule, doAddRule, showEditRule, doEditRule, showBatchAddRule, doBatchAddRule, doDelRule,
    dragRuleStart, dragRuleOver, dropRule, dragRuleEnd,
    showAddAnn, doAddAnn, doDelAnn, showEditAnn, showAnnVersions, setAnnCat,
    annGoHome, annGoRange, annGoPub, annGoYear, annGoMonth, annGoDay, showAnnDetail,
    switchRankTab,
    renderFmPage, readFm, delFm, setFmPeriod,
    renderSysAnnPage, toggleSysAnnExpand, showAddSysAnn, doAddSysAnn,
    showEditSysAnn, doEditSysAnn, delSysAnn, closeSysAnnModal,
    saMode, saInsertImg, toggleSysAnnActive,
    tierAddRow, tierDelRow, saveTierRules,
    loadRecords, showFabricate,
    exportRank, showExportRecords, doExportRecords,
    doBackupCreate, doBackupDownload, downloadBackup, restoreFromCloud, deleteBackup, showRestoreModal, doRestoreFile,
    switchBackupSide,
    doChangePwd,
    saveSiteTitle, saveCfg, saveResendFrom, saveSysInfo, saveFrontUI, onNotifySoundChange, uploadNotifySound,
    navClick, feedback, versionToast, avatarMenu, showProfilePop, closeAvatarPop, saveProfile,
    sitesAddRow, sitesDelRow, sitesMoveRow, saveSites, saveExtLinks,
    renderResendKeyArea, showChangeApi, doChangeApi, clearApi,
    showGenCode, doGenCode, delDeviceCode, copyCode,
    showSuperSetPoints, doSuperSetPoints,
    showAddUser, doAddUser, showEditUser, doUpdateUser, delUser,
    delDevice,
    loadWxpMembers, wxpBind, wxpUnbind, saveWxpSettings, copyWxpUrl,
  };

  /* ---------- 401 回到登录屏 ---------- */
  window.onAdminUnauthorized = () => {
    CP.clearAdminToken();
    try { localStorage.removeItem('cp_admin_role'); localStorage.removeItem('cp_admin_name'); } catch (e) {}
    currentUser = null;
    showLoginScreen();
    initAuth();
  };

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    $('mb-btn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('overlay').classList.add('show'); });
    $('overlay').addEventListener('click', closeSidebar);

    // Enter key submits login/setup forms
    const loginPwd = $('login-pwd');
    if (loginPwd) loginPwd.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    const loginUser = $('login-username');
    if (loginUser) loginUser.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    const setupPwd2 = $('setup-pwd2');
    if (setupPwd2) setupPwd2.addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });
    const forgotNewPwd = $('forgot-newpwd');
    if (forgotNewPwd) forgotNewPwd.addEventListener('keydown', e => { if (e.key === 'Enter') doReset(); });

    if (CP.getAdminToken()) {
      let role = 'teacher', name = '';
      try { role = localStorage.getItem('cp_admin_role') || 'teacher'; name = localStorage.getItem('cp_admin_name') || ''; } catch (e) {}
      // 以 /auth/me 为准，避免本地缓存的角色/昵称过期
      try {
        const me = await CP.api('/auth/me');
        const info = (me && me.data) || me;
        if (info && info.role) {
          role = info.role;
          if (info.display_name) name = info.display_name;
          try { localStorage.setItem('cp_admin_role', role); localStorage.setItem('cp_admin_name', name); } catch (e) {}
        }
      } catch (e) {
        if (e && e.status === 401) return; // onAdminUnauthorized 已处理
      }
      enterAdmin(role, name);
      // v5.1: 群聊未读角标 + 预览
      async function refreshChatNav() {
        try {
          const r = await CP.api('/chat/unread-count', { handle401: false, noDeviceToken: true });
          window.__chatUnread = r.count || 0;
          renderNav();
          const p = document.getElementById('chat-nav-preview');
          if (p) p.textContent = (r.last_sender ? r.last_sender + '：' : '') + (r.preview || '暂无消息');
        } catch {}
      }
      refreshChatNav();
      setInterval(refreshChatNav, 10000);
      if (CP.startGlobalChatSSE) CP.startGlobalChatSSE(refreshChatNav, refreshChatNav);
      return;
    }
    initAuth();
  });
})();
