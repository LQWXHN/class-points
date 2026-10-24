/* ============================================================
   班级积分系统 v4.0 — 前端共享库 common.js（纯原生 JS，无依赖）
   所有页面通过 <script src="/assets/common.js"></script> 引入
   （/admin 下用 ../assets/common.js）
   ============================================================ */
(function () {
  'use strict';
  const CP = {};
  window.CP = CP;

  CP.API = '/api';
  const LS_DEVICE = 'cp_device_token';
  const LS_DEVICE_UUID = 'cp_device_uuid';
  const LS_ADMIN = 'admin_token';
  const LS_READ_MAX = 'cp_read_ann_max';
  const LS_READ_SET = 'cp_read_ann_set';

  /* ---------- 基础工具 ---------- */
  CP.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  CP.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  CP.qs = function (name) {
    return new URLSearchParams(location.search).get(name);
  };

  // cyrb53 哈希（用于设备指纹）
  function hash53(str, seed = 2507) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0');
  }

  CP.fmtTime = function (ms, withSec) {
    if (!ms && ms !== 0) return '';
    const d = new Date(Number(ms));
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    let s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    if (withSec) s += `:${p(d.getSeconds())}`;
    return s;
  };
  CP.fmtDate = function (ms) {
    if (!ms && ms !== 0) return '';
    const d = new Date(Number(ms)), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* ---------- 本地存储 ---------- */
  CP.getDeviceToken = () => { try { return localStorage.getItem(LS_DEVICE) || ''; } catch (e) { return ''; } };
  CP.setDeviceToken = t => { try { localStorage.setItem(LS_DEVICE, t); } catch (e) {} };
  CP.clearDeviceToken = () => { try { localStorage.removeItem(LS_DEVICE); } catch (e) {} };
  CP.getAdminToken = () => { try { return localStorage.getItem(LS_ADMIN) || ''; } catch (e) { return ''; } };
  CP.setAdminToken = t => { try { localStorage.setItem(LS_ADMIN, t); } catch (e) {} };
  CP.clearAdminToken = () => { try { localStorage.removeItem(LS_ADMIN); } catch (e) {} };

  CP.getDeviceUUID = function () {
    let u = '';
    try { u = localStorage.getItem(LS_DEVICE_UUID) || ''; } catch (e) {}
    if (!u) { u = CP.uuid(); try { localStorage.setItem(LS_DEVICE_UUID, u); } catch (e) {} }
    return u;
  };

  /* ---------- 设备指纹（canvas/webgl/屏幕/时区/语言/字体） ---------- */
  CP.deviceFingerprint = async function () {
    const parts = [
      screen.width, screen.height, screen.availWidth, screen.availHeight,
      screen.colorDepth, new Date().getTimezoneOffset(),
      navigator.language, (navigator.languages || []).join(','),
      navigator.hardwareConcurrency || 0, navigator.platform || '',
      navigator.maxTouchPoints || 0, (navigator.userAgentData && navigator.userAgentData.mobile) ? 1 : 0
    ];
    // canvas
    try {
      const c = document.createElement('canvas'); c.width = 240; c.height = 72;
      const ctx = c.getContext('2d');
      ctx.textBaseline = 'top'; ctx.font = "16px 'Arial'";
      ctx.fillStyle = '#f60'; ctx.fillRect(8, 8, 70, 30);
      ctx.fillStyle = '#069'; ctx.fillText('班级积分·points 2507', 12, 18);
      ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('指纹▱Δ⚡', 26, 40);
      parts.push(c.toDataURL());
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) parts.push(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      }
    } catch (e) {}
    // 字体探测
    try {
      const fonts = ['Arial', 'Calibri', 'Consolas', 'Courier New', 'Helvetica', 'Segoe UI', 'SimSun', 'Microsoft YaHei', 'PingFang SC', 'Songti SC'];
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;font-size:72px';
      probe.textContent = 'mmmmmmmmmmlliΔ积';
      document.body.appendChild(probe);
      const base = {};
      ['monospace', 'sans-serif', 'serif'].forEach(f => { probe.style.fontFamily = f; base[f] = probe.offsetWidth; });
      const hit = [];
      fonts.forEach(f => {
        ['monospace', 'sans-serif', 'serif'].forEach(fam => {
          probe.style.fontFamily = `'${f}',${fam}`;
          if (probe.offsetWidth !== base[fam]) hit.push(f);
        });
      });
      document.body.removeChild(probe);
      parts.push(hit.sort().join(','));
    } catch (e) {}
    return hash53(parts.join('|'));
  };

  CP.defaultDeviceName = function () {
    const ua = navigator.userAgent;
    let os = '未知设备';
    if (/Windows NT 10/.test(ua)) os = 'Windows';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let br = '浏览器';
    if (/Edg\//.test(ua)) br = 'Edge';
    else if (/Chrome\//.test(ua)) br = 'Chrome';
    else if (/Firefox\//.test(ua)) br = 'Firefox';
    else if (/Safari\//.test(ua)) br = 'Safari';
    return `${os} · ${br}`;
  };

  /* ---------- 网络错误 ---------- */
  class ApiError extends Error {
    constructor(msg, status, data) { super(msg); this.name = 'ApiError'; this.status = status; this.data = data || {}; }
  }
  class NetworkError extends Error {
    constructor(msg) { super(msg || '网络连接失败'); this.name = 'NetworkError'; }
  }
  CP.ApiError = ApiError;
  CP.NetworkError = NetworkError;

  // 统一的失败提示：网络错误 → 固定文案
  CP.failToast = function (e, prefix) {
    if (e instanceof NetworkError) { CP.toast('操作失败，请检查网络连接', 'error'); return; }
    CP.toast((prefix ? prefix + '：' : '') + (e && e.message ? e.message : '操作失败'), 'error');
  };

  function authHeaders(extra) {
    const h = Object.assign({}, extra || {});
    const at = CP.getAdminToken(); if (at) h['Authorization'] = 'Bearer ' + at;
    const dt = CP.getDeviceToken(); if (dt) h['X-Device-Token'] = dt;
    return h;
  }

  // XHR 封装（支持上传进度）
  function xhrSend(method, url, body, headers, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, url, true);
      Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
      x.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total); };
      x.onload = () => {
        let data = {};
        try { data = JSON.parse(x.responseText); } catch (e) { data = {}; }
        resolve({ status: x.status, data });
      };
      x.onerror = () => reject(new NetworkError());
      x.ontimeout = () => reject(new NetworkError());
      x.send(body);
    });
  }

  /* ---------- API 调用 ----------
     CP.api('/students')                      GET JSON
     CP.api('/announcements', {method:'POST', body:{...}})
     CP.api('/upload', {method:'POST', body:formData, onProgress:(l,t)=>{}})
     CP.api('/export/records', {raw:true})    返回 {status, data:text} */
  CP.api = async function (path, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const url = (opts.absolute || CP.API) + path;
    const headers = authHeaders(opts.headers);
    let body = null;
    if (opts.body instanceof FormData) {
      body = opts.body; // 浏览器自动设置 multipart boundary
    } else if (opts.body != null) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    try {
      let res;
      if (opts.onProgress || body instanceof FormData) {
        res = await xhrSend(method, url, body, headers, opts.onProgress);
      } else {
        const r = await fetch(url, { method, headers, body, signal: opts.signal, credentials: 'omit' });
        const text = await r.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { rawText: text }; }
        res = { status: r.status, data };
      }
      if (res.status === 429) throw new ApiError((res.data && res.data.error) || '尝试过于频繁，请稍后再试', 429, res.data);
      if (!opts.raw && res.data && res.data.ok === false) {
        throw new ApiError(res.data.error || '请求失败', res.status, res.data);
      }
      if (res.status >= 500) throw new ApiError((res.data && res.data.error) || '服务器错误', res.status, res.data);
      if (res.status === 401 && opts.handle401 !== false) {
        // 后台会话失效
        if (CP.getAdminToken() && /auth|admin|upload|backup|config|super|device\/(generate|list|delete)/.test(path)) {
          CP.clearAdminToken();
          if (window.onAdminUnauthorized) { window.onAdminUnauthorized(); }
        }
        throw new ApiError((res.data && res.data.error) || '未登录或登录已过期', 401, res.data);
      }
      return opts.raw ? res : res.data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof TypeError || (e && e.name === 'NetworkError')) throw new NetworkError();
      throw e;
    }
  };

  /* ---------- Toast ---------- */
  let toastWrap = null;
  function ensureToast() {
    if (toastWrap) return toastWrap;
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
    return toastWrap;
  }
  CP.toast = function (msg, type, duration) {
    const wrap = ensureToast();
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${CP.esc(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 320);
    }, duration || 2400);
    return el;
  };

  /* ---------- Modal ---------- */
  let modalBack = null, modalBox = null;
  function ensureModal() {
    if (modalBack) return;
    modalBack = document.createElement('div');
    modalBack.className = 'modal-back';
    modalBox = document.createElement('div');
    modalBox.className = 'modal';
    modalBack.appendChild(modalBox);
    modalBack.addEventListener('click', e => { if (e.target === modalBack) CP.closeModal(); });
    document.body.appendChild(modalBack);
  }
  CP.modal = function (html, opts) {
    ensureModal();
    opts = opts || {};
    modalBox.className = 'modal' + (opts.size ? ' modal-' + opts.size : '');
    modalBox.innerHTML = html;
    modalBack.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (opts.onShow) try { opts.onShow(modalBox); } catch (e) {}
    return modalBox;
  };
  CP.closeModal = function () {
    if (modalBack) modalBack.classList.remove('show');
    document.body.style.overflow = '';
  };
  CP.confirm = function (title, msg, okText, danger) {
    return new Promise(resolve => {
      CP.modal(
        `<h3>${CP.esc(title)}</h3><p style="color:var(--text-2);margin:0 0 4px;white-space:pre-wrap">${CP.esc(msg)}</p>
         <div class="modal-foot">
           <button class="btn" data-act="cancel">取消</button>
           <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${CP.esc(okText || '确定')}</button>
         </div>`, { size: 'sm' });
      modalBox.querySelector('[data-act=cancel]').onclick = () => { CP.closeModal(); resolve(false); };
      modalBox.querySelector('[data-act=ok]').onclick = () => { CP.closeModal(); resolve(true); };
    });
  };

  /* ---------- 头像 / 图片 ---------- */
  CP.resolveAvatar = function (a) {
    const s = String(a == null ? '' : a);
    if (!s) return { emoji: '👦' };
    if (/^(https?:)?\/\//.test(s) || s.startsWith('/') || s.startsWith('data:')) return { img: s };
    return { emoji: s };
  };
  CP.avatarHTML = function (av, opts) {
    opts = opts || {};
    const size = opts.size || 44;
    const r = CP.resolveAvatar(av);
    const bg = opts.bg || 'var(--fill)';
    const frame = opts.frame ? ` ${CP.esc(opts.frame)}` : '';
    const radius = opts.radius || '50%';
    const border = opts.border ? `border:2px solid ${opts.border};box-sizing:border-box;` : '';
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * .5)}px;background:${bg};`;
    if (r.img) {
      return `<span class="av-img${frame}" style="display:inline-flex;border-radius:${radius};overflow:hidden;flex:none;${border}${style}"
        data-protect><img data-protect draggable="false" src="${CP.esc(r.img)}" alt=""
        style="width:100%;height:100%;object-fit:cover;pointer-events:none"></span>`;
    }
    return `<span class="av-emoji${frame}" data-protect
      style="display:inline-flex;align-items:center;justify-content:center;border-radius:${radius};flex:none;${border}${style}">${CP.esc(r.emoji)}</span>`;
  };

  /* ---------- 防盗图：右键 / 拖拽 ---------- */
  CP.bindImageGuard = function () {
    document.addEventListener('contextmenu', e => {
      if (e.target.closest('img, [data-protect]')) {
        e.preventDefault();
        CP.toast('你想干嘛！？', 'warn', 1600);
      }
    }, true);
    document.addEventListener('dragstart', e => {
      if (e.target.closest('img, [data-protect]')) e.preventDefault();
    }, true);
  };

  /* ---------- 设备激活门禁 ---------- */
  CP.gotoStart = function () {
    const p = location.pathname + location.search;
    if (!/\/start(\.html)?$/.test(location.pathname)) {
      location.replace('/start?next=' + encodeURIComponent(p));
    }
  };
  CP.requireDevice = async function () {
    const token = CP.getDeviceToken();
    if (!token) { CP.gotoStart(); return false; }
    try {
      const r = await CP.api('/device/verify', { handle401: false });
      if (!r.valid) { CP.clearDeviceToken(); CP.gotoStart(); return false; }
      return true;
    } catch (e) {
      // 验证请求本身网络故障：放行浏览缓存/只读，写操作会各自报网络错误
      return true;
    }
  };

  /* ---------- 5 秒轮询（页面隐藏暂停，恢复立即刷新） ---------- */
  CP.poll = function (fn, ms) {
    ms = ms || 5000;
    let timer = setInterval(run, ms);
    let running = false;
    async function run() {
      if (running || document.hidden) return;
      running = true;
      try { await fn(); } catch (e) { /* 轮询静默，不弹错误 */ }
      running = false;
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) run();
    });
    return { stop() { clearInterval(timer); }, run };
  };

  /* ---------- 网站标题 ---------- */
  CP.siteTitle = '班级积分系统';
  CP.applyTitle = function (suffix) {
    try {
      const cached = localStorage.getItem('cp_site_title');
      if (cached) CP.siteTitle = cached;
    } catch (e) {}
    function render() { document.title = suffix ? `${CP.siteTitle} · ${suffix}` : CP.siteTitle; }
    render();
    CP.api('/snapshot').then(d => {
      const t = d && d.data && d.data.config && d.data.config.site_title;
      if (t) {
        CP.siteTitle = t;
        try { localStorage.setItem('cp_site_title', t); } catch (e) {}
        render();
        document.dispatchEvent(new CustomEvent('cp:title', { detail: t }));
      }
    }).catch(() => {});
  };

  /* ---------- 班级动态未读（v4.1：服务端为准，localStorage 仅离线缓存） ---------- */
  CP.CATEGORIES = ['通知公告', '作业提醒', '考试成绩', '班级活动', '其他'];
  CP._serverRead = new Set();
  CP.readStateReady = false;
  CP._readSet = function () {
    try { return JSON.parse(localStorage.getItem(LS_READ_SET) || '[]'); } catch (e) { return []; }
  };
  CP.isAnnRead = function (item) {
    if (!item) return true;
    const uid = item.uid;
    if (uid && CP._serverRead.has(uid)) return true;
    const max = Number(localStorage.getItem(LS_READ_MAX) || 0);
    if (Number(item.created_at) <= max) return true;
    return uid && CP._readSet().includes(uid);
  };
  CP.unreadCount = function (items) {
    return (items || []).filter(a => !CP.isAnnRead(a)).length;
  };
  CP.reportRead = async function (uid) {
    if (!uid) return;
    CP._serverRead.add(uid);
    try { await CP.api('/announcements/' + encodeURIComponent(uid) + '/read', { method: 'POST' }); } catch (e) { /* 离线时本地已记 */ }
    document.dispatchEvent(new CustomEvent('cp:read-change'));
  };
  CP.loadReadState = async function () {
    try {
      const d = await CP.api('/device/read-state', { handle401: false });
      const arr = (d && (d.read_ann_uids || (d.data && d.data.read_ann_uids))) || [];
      CP._serverRead = new Set(arr);
      // 把本地缓存已读集合补报一次（离线期间读过的）
      CP._readSet().forEach(uid => { if (!CP._serverRead.has(uid)) CP.reportRead(uid); });
    } catch (e) { /* 网络故障：沿用本地缓存 */ }
    CP.readStateReady = true;
    document.dispatchEvent(new CustomEvent('cp:read-change'));
  };
  CP.markAnnRead = function (item) {
    if (!item) return;
    const uid = item.uid;
    if (uid && !CP._serverRead.has(uid)) CP.reportRead(uid);
    const set = CP._readSet();
    if (uid && !set.includes(uid)) { set.push(uid); try { localStorage.setItem(LS_READ_SET, JSON.stringify(set.slice(-500))); } catch (e) {} }
    document.dispatchEvent(new CustomEvent('cp:read-change'));
  };
  CP.markAllRead = function (items) {
    let max = Number(localStorage.getItem(LS_READ_MAX) || 0);
    (items || []).forEach(i => { max = Math.max(max, Number(i.created_at) || 0); });
    try { localStorage.setItem(LS_READ_MAX, String(max)); localStorage.removeItem(LS_READ_SET); } catch (e) {}
    document.dispatchEvent(new CustomEvent('cp:read-change'));
  };

  /* ---------- Markdown 小渲染器（先转义后白名单替换，禁止外部库） ---------- */
  CP.mdToHtml = function (src) {
    if (src == null) return '';
    let text = String(src);
    // 先 HTML 转义
    let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 图片 ![alt](url) —— url 限 http(s) 或本站 /api/file/
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/api\/file\/[^)\s]+)\)/g,
      (m, alt, url) => `<img src="${url}" alt="${alt}" loading="lazy" data-md-img>`);
    // 链接 [t](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/api\/file\/[^)\s]+)\)/g,
      (m, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`);
    // 行内代码 `code`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体/斜体
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    // 按行处理
    const lines = s.split('\n');
    let html = '', inUl = false, inOl = false, i = 0;
    const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line) { closeLists(); i++; continue; }
      if (/^###\s+/.test(line)) { closeLists(); html += '<h4>' + line.replace(/^###\s+/, '') + '</h4>'; i++; continue; }
      if (/^##\s+/.test(line)) { closeLists(); html += '<h3>' + line.replace(/^##\s+/, '') + '</h3>'; i++; continue; }
      if (/^#\s+/.test(line)) { closeLists(); html += '<h2>' + line.replace(/^#\s+/, '') + '</h2>'; i++; continue; }
      if (/^---+$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }
      if (/^&gt;\s?/.test(line)) { closeLists(); let q = line.replace(/^&gt;\s?/, ''); i++;
        while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) { q += '<br>' + lines[i].trim().replace(/^&gt;\s?/, ''); i++; }
        html += '<blockquote>' + q + '</blockquote>'; continue; }
      if (/^[-*]\s+/.test(line)) { if (!inUl) { closeLists(); html += '<ul>'; inUl = true; } html += '<li>' + line.replace(/^[-*]\s+/, '') + '</li>'; i++; continue; }
      if (/^\d+\.\s+/.test(line)) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += '<li>' + line.replace(/^\d+\.\s+/, '') + '</li>'; i++; continue; }
      closeLists();
      html += '<p>' + line + '</p>'; i++;
    }
    closeLists();
    return html;
  };

  /* ---------- 上传进度卡片 ---------- */
  CP.uploadCard = function (title) {
    const card = document.createElement('div');
    card.className = 'card glass progress-card';
    card.innerHTML = `
      <div class="flex aic gap-10">
        <i class="fas fa-cloud-arrow-up text-orange"></i>
        <div class="flex1" style="font-weight:700;font-size:14px">${CP.esc(title || '正在上传…')}</div>
        <span class="pct badge badge-blue">0%</span>
      </div>
      <div class="progress-track"><div class="progress-bar"></div></div>
      <div class="progress-meta"><span class="stage">准备中…</span><span class="sz"></span></div>`;
    document.body.appendChild(card);
    const bar = card.querySelector('.progress-bar'), pct = card.querySelector('.pct'),
      stage = card.querySelector('.stage'), sz = card.querySelector('.sz');
    function fmtSize(n) {
      if (n == null) return '';
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      return Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    return {
      progress(loaded, total) {
        const p = total ? Math.round(loaded / total * 100) : 0;
        bar.style.width = p + '%'; pct.textContent = p + '%';
        stage.textContent = p < 100 ? '正在上传文件…' : '正在保存…';
        sz.textContent = total ? `${fmtSize(loaded)} / ${fmtSize(total)}` : '';
      },
      stage(text) { stage.textContent = text; },
      done() {
        bar.style.width = '100%'; pct.textContent = '完成'; pct.className = 'pct badge badge-green';
        stage.textContent = '上传完成';
        setTimeout(() => { card.style.transition = 'opacity .4s, transform .4s'; card.style.opacity = '0'; card.style.transform = 'translateY(12px)'; setTimeout(() => card.remove(), 420); }, 900);
      },
      fail() {
        pct.textContent = '失败'; pct.className = 'pct badge badge-red'; stage.textContent = '操作失败，请检查网络连接';
        setTimeout(() => card.remove(), 3600);
      },
      el: card
    };
  };

  /* ---------- Bootstrap（公开引导：sites/ext_links/version/sound） ---------- */
  CP.bootstrap = {
    sites: [{ name: '主站', url: 'https://points.example.com' }, { name: '备用站', url: 'https://points1.example.com' }],
    ext_links: {}, system_version: '', notify_sound: 'ganlu', notify_sound_url: '',
    biweekly_rank_enabled: '1', modal_blur_enabled: '1'
  };
  // 弹窗背景模糊开关：在 <html> 上切换 class，CSS 见 apple.css（:root.modal-blur-off）
  CP.applyModalBlur = function () {
    document.documentElement.classList.toggle('modal-blur-off', CP.bootstrap.modal_blur_enabled === '0');
  };
  CP.loadBootstrap = async function () {
    try {
      const r = await CP.api('/public/bootstrap', { handle401: false });
      const d = (r && (r.data || r)) || {};
      if (Array.isArray(d.sites) && d.sites.length) CP.bootstrap.sites = d.sites;
      if (d.ext_links) CP.bootstrap.ext_links = d.ext_links;
      if (d.system_version) CP.bootstrap.system_version = d.system_version;
      if (d.notify_sound) CP.bootstrap.notify_sound = d.notify_sound;
      if (d.notify_sound_url) CP.bootstrap.notify_sound_url = d.notify_sound_url;
      if (d.biweekly_rank_enabled !== undefined) CP.bootstrap.biweekly_rank_enabled = d.biweekly_rank_enabled;
      if (d.modal_blur_enabled !== undefined) CP.bootstrap.modal_blur_enabled = d.modal_blur_enabled;
      CP.applyModalBlur();
    } catch (e) { /* 静默 */ }
    return CP.bootstrap;
  };

  /* ---------- 提示音合成（WebAudio，原创无版权） ---------- */
  CP.playNotifySound = function () {
    const kind = CP.bootstrap.notify_sound || 'ganlu';
    if (kind === 'system') { try { new Notification(' '); } catch (e) {} return; }
    if (kind === 'custom' && CP.bootstrap.notify_sound_url) {
      try { const a = new Audio(CP.bootstrap.notify_sound_url); a.play(); } catch (e) {} return;
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      function tone(freq, t0, dur, vol) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0, ctx.currentTime + t0);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur);
      }
      if (kind === 'ding') tone(1318.5, 0, 0.5, 0.18);
      else { tone(880, 0, 0.18, 0.16); tone(1318.5, 0.14, 0.35, 0.16); }
    } catch (e) {}
  };

  /* ---------- 站点切换器（popover 吸附 anchor，边缘不溢出） ---------- */
  CP.openSiteSwitcher = function (anchor) {
    if (!window.CP || !CP.bootstrap) return;
    let pop = null, back = null;
    function close() {
      if (pop) pop.remove(); pop = null;
      if (back) back.remove(); back = null;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // 已打开则关闭
    const old = document.querySelector('.site-switch-pop');
    if (old) { old.remove(); const ob = document.querySelector('.site-switch-back'); if (ob) ob.remove(); return; }
    const host = location.origin;
    back = document.createElement('div');
    back.className = 'site-switch-back';
    pop = document.createElement('div');
    pop.className = 'site-switch-pop';
    pop.innerHTML = '<div class="ss-title">切换站点</div>' + CP.bootstrap.sites.map(s => {
      const cur = host === s.url;
      return `<button class="ss-item ${cur ? 'cur' : ''}" data-url="${CP.esc(s.url)}">
        <i class="fas ${cur ? 'fa-check' : 'fa-server'}"></i><span>${CP.esc(s.name)}</span></button>`;
    }).join('');
    document.body.appendChild(back);
    document.body.appendChild(pop);
    // 定位：优先吸附 anchor；无 anchor 时居中
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left, top;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      // 左对齐吸附；右侧放不下才右对齐
      left = r.left;
      if (left + pw > window.innerWidth - 8) left = r.right - pw;
      if (left < 8) left = 8;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      top = r.bottom + 8;
      if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    } else {
      left = (window.innerWidth - pw) / 2;
      top = (window.innerHeight - ph) / 2;
    }
    pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.style.right = 'auto';
    back.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    pop.querySelectorAll('.ss-item').forEach(b => b.onclick = () => {
      location.href = b.dataset.url + location.pathname + location.hash;
    });
  };
  CP.siteSwitcher = function (anchor) {
    if (!anchor) return;
    anchor.addEventListener('click', () => CP.openSiteSwitcher(anchor));
  };

  /* ---------- 更多聚合菜单（站点/反馈/版本）：点击即开 ---------- */
  CP.openMoreMenu = function (anchor) {
    if (!anchor || !anchor.getBoundingClientRect) return;
    let pop = null, back = null;
    function close() {
      if (pop) pop.remove(); pop = null;
      if (back) back.remove(); back = null;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // 已打开则关闭（toggle）
    const old = document.querySelector('.more-pop');
    if (old) { old.remove(); const ob = document.querySelector('.site-switch-back'); if (ob) ob.remove(); return; }
    back = document.createElement('div');
    back.className = 'site-switch-back';
    pop = document.createElement('div');
    pop.className = 'site-switch-pop more-pop';
    pop.innerHTML = '<div class="ss-title">更多</div>' + [
      ['切换站点', 'fa-globe', 'switch'],
      ['意见反馈', 'fa-comment-dots', 'feedback'],
      ['关于版本', 'fa-circle-info', 'version']
    ].map(it => `<button class="ss-item" data-act="${it[2]}"><i class="fas ${it[1]}"></i><span>${it[0]}</span></button>`).join('');
    document.body.appendChild(back);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.right - pw;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.style.right = 'auto';
    back.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    pop.querySelectorAll('.ss-item').forEach(b => b.onclick = () => {
      const act = b.dataset.act; close();
      if (act === 'switch') CP.openSiteSwitcher(anchor);
      else if (act === 'feedback') CP.feedbackModal();
      else if (act === 'version') CP.versionToast();
    });
  };
  // 兼容内联 onclick 直接调用：点击即打开
  CP.moreMenu = function (anchor) { CP.openMoreMenu(anchor); };

  /* ---------- 反馈弹窗 ---------- */
  CP.feedbackModal = function () {
    let remaining = 3;
    const box = CP.modal('', { size: 'md' });
    function render() {
      box.innerHTML = `
        <h3><i class="fas fa-comment-dots" style="color:var(--primary);margin-right:7px"></i>意见反馈</h3>
        <p class="text-2" style="margin:0 0 12px">今日还可提交 <b id="fb-rem">${remaining}</b> 次（每天 3 次）</p>
        <textarea id="fb-content" class="form-input" rows="4" placeholder="遇到的问题或建议…"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-soft btn-sm" id="fb-add"><i class="fas fa-paperclip"></i> 添加附件</button>
          <input id="fb-file" type="file" multiple style="display:none" accept="image/*,.pdf,.doc,.docx,.txt,.zip">
        </div>
        <div id="fb-list" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">提交</button>
        </div>`;
      box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
      box.querySelector('#fb-add').onclick = () => box.querySelector('#fb-file').click();
      box.querySelector('#fb-file').onchange = async e => {
        for (const f of e.target.files) {
          if (attachments.length >= 3) { CP.toast('最多 3 个附件', 'warn'); break; }
          const fd = new FormData(); fd.append('file', f);
          try {
            const up = await CP.api('/upload', { method: 'POST', body: fd });
            const u = (up && (up.data || up)) || {};
            attachments.push({ name: f.name, size: f.size, type: f.type, url: u.url || u.file_url || '' });
          } catch (err) { CP.failToast(err, '上传失败'); }
        }
        renderList();
        e.target.value = '';
      };
      box.querySelector('[data-act=ok]').onclick = submit;
      renderList();
    }
    const attachments = [];
    function renderList() {
      const el = box.querySelector('#fb-list');
      el.innerHTML = attachments.map((a, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border-radius:9px">
          <i class="fas fa-paperclip text-3"></i>
          <span style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${CP.esc(a.name)} <span class="text-3">(${(a.size/1024).toFixed(0)}KB)</span></span>
          <button class="btn btn-sm" data-rm="${i}"><i class="fas fa-times"></i></button>
        </div>`).join('');
      el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { attachments.splice(Number(b.dataset.rm), 1); renderList(); });
    }
    async function submit() {
      const content = box.querySelector('#fb-content').value.trim();
      if (!content && !attachments.length) return CP.toast('请填写内容或添加附件', 'error');
      const btn = box.querySelector('[data-act=ok]'); btn.disabled = true;
      try {
        await CP.api('/feedback', { method: 'POST', body: { content, attachments } });
        CP.closeModal();
        CP.toast('已提交，感谢反馈', 'success');
      } catch (e) { CP.failToast(e, '提交失败'); btn.disabled = false; }
    }
    render();
    CP.api('/feedback/remaining', { handle401: false }).then(r => {
      const v = r && (r.remaining != null ? r.remaining : (r.data && r.data.remaining));
      if (v != null) { remaining = v; const el = box.querySelector('#fb-rem'); if (el) el.textContent = v; }
    }).catch(() => {});
  };

  /* ---------- 版本 toast ---------- */
  CP.versionToast = async function () {
    if (!CP.bootstrap.system_version) await CP.loadBootstrap();
    const v = CP.bootstrap.system_version || '未知版本';
    CP.toast(v, 'info', 3000);
  };

  /* ---------- SW 注册（离线外壳缓存） ---------- */
  CP.registerSW = function () {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  };

  /* ---------- 初始化 ---------- */
  CP.bindImageGuard();
  CP.registerSW();
  CP.loadBootstrap();

})();
