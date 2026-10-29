/* v5.0 群聊页面（前台 /chat 与后台 /chat/teacher /chat/admin 同构） */
(function () {
  'use strict';
  const LS_DRAFT = 'cp_chat_draft';
  const LS_FACE_TAB = 'cp_chat_face_tab';
  const MAX_FILE = 600 * 1024 * 1024;

  // 身份：staff 用 admin token；front 用设备 token
  // 注意：worker 端 /chat/teacher 会 302 到 /chat-staff.html，此时也必须识别为 staff
  const path = location.pathname;
  const isStaff = /^\/chat\/(teacher|admin)/.test(path) || path === '/chat-staff' || path === '/chat-staff.html';
  const isFront = !isStaff && (path === '/chat' || path === '/chat.html' || path === '/');

  // v5.1：身份隔离——三种身份会话互不串用
  // 前台 /chat：只走 X-Device-Token，移除 staff Bearer（防止后台切账号污染前台发送人）
  // 后台 /chat/teacher、/chat/admin：只走 Bearer，移除设备 token（防止同浏览器设备态污染 staff 身份）
  if (window.fetch && (isFront || isStaff)) {
    const _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (init && init.headers && /\/api\/(chat|upload)/.test(url)) {
          const h = new Headers(init.headers);
          if (isFront) h.delete('Authorization');
          if (isStaff) h.delete('X-Device-Token');
          init.headers = h;
        }
      } catch {}
      return _fetch(input, init);
    };
  }
  function chatApi(p, opts) { return CP.api(p, opts); }

  // ---------- 状态 ----------
  const state = {
    me: null,
    members: [],
    groupName: '群',
    notice: null,
    messages: [],          // 升序
    lastId: 0,
    myLastReadId: 0,
    favorites: new Set(),
    replyTo: null,
    faceManifest: null,
    customStickers: [],
    pollTimer: null,
    seenImageIdx: 0,
  };

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const els = {
    scroll: $('chat-scroll'), input: $('chat-input'), sendBtn: $('chat-send'),
    faceBtn: $('chat-face'), cameraBtn: $('chat-camera'), imgBtn: $('chat-img'), fileBtn: $('chat-file'),
    searchBtn: $('chat-search'), filesBtn: $('chat-files'),
    backBtn: $('chat-back'), noticeBar: $('chat-notice-bar'),
    replyBar: $('chat-reply-bar'), replyTxt: $('chat-reply-txt'), replyCancel: $('chat-reply-cancel'),
    panel: $('chat-panel'), panelTitle: $('chat-panel-title'), panelBody: $('chat-panel-body'),
    facePanel: $('chat-face-panel'), faceTabs: $('chat-face-tabs'), faceGrid: $('chat-face-grid'),
    lightbox: $('chat-lightbox'), lightboxImg: $('chat-lightbox-img'),
    groupName: $('chat-gname'), groupSub: $('chat-gsub'),
    fileInput: $('chat-file-input'), imgInput: $('chat-img-input'), cameraInput: $('chat-camera-input'),
  };

  // ---------- 工具 ----------
  function esc(s) { return CP.esc(s); }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtDay(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function fmtHM(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  // 把文本里的 [face:qq:<id>] / [face:wx:<id>] 替换为 <img>
  function renderFaces(text) {
    if (!text) return '';
    let out = esc(text);
    const m = state.faceManifest;
    if (!m) return out;
    // 兼容两种 token：[face:wx:5] 与微信命名表情的 [face:wx:[gift]]（历史消息）
    out = out.replace(/\[face:(qq|wx):(?:\[([^\]]+)\]|([^\]]+))\]/g, (full, kind, idBra, idPlain) => {
      const id = String(idBra || idPlain || '').replace(/[\[\]]/g, '');
      const sec = kind === 'qq' ? m.qq : m.wechat;
      const f = sec && sec.faces && (sec.faces[id] || sec.faces['[' + id + ']']);
      if (!f) return esc(full);
      const file = f.anim || f.png;
      if (!file) return esc(full);
      return `<img class="face-img" src="/assets/qq-face/${file}" alt="${esc(f.name || '')}">`;
    });
    return out;
  }

  // ---------- 初始化 ----------
  async function withRetry(fn, label, tries) {
    tries = tries || 3;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); }
      catch (e) {
        if (i === tries - 1) { if (window.CP && CP.toast) CP.toast(label + '，请稍后刷新重试'); throw e; }
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }

  // 加载失败时给出手动重试入口（弱网下 withRetry 三次仍失败时显示）
  function showLoadError() {
    if (els.scroll.querySelector('.chat-load-err')) return;
    const d = document.createElement('div');
    d.className = 'chat-load-err';
    d.innerHTML = '加载失败，网络不稳定，<a href="javascript:void(0)">点此重试</a>';
    d.querySelector('a').onclick = () => location.reload();
    els.scroll.appendChild(d);
  }

  async function init() {
    // 先绑定所有交互，避免任何一个接口失败导致整页无响应
    bindEvents();
    // 加载表情清单（失败不阻塞）
    try {
      state.faceManifest = await (await fetch('/assets/qq-face/face-manifest.json')).json();
      buildFacePanel(); // 清单加载后再构建一次（bindEvents 时清单可能还没到）
    } catch { state.faceManifest = null; }

    // 身份校验
    if (isStaff) {
      if (!CP.getAdminToken()) { location.href = '/admin/?next=' + encodeURIComponent(path); return; }
    } else {
      const ok = await CP.requireDevice();
      if (!ok) return;
    }

    let ctxOk = true, msgOk = true;
    try {
      await withRetry(loadContext, '群信息加载失败');
    } catch (e) { ctxOk = false; }
    try {
      await withRetry(loadInitialMessages, '消息加载失败');
    } catch (e) { msgOk = false; }
    if (!ctxOk || !msgOk) showLoadError();
    renderMessages(true);
    startPoll();
    // 草稿恢复
    const draft = localStorage.getItem(LS_DRAFT + ':' + (state.me && state.me.member_key || 'front'));
    if (draft) {
      els.input.textContent = draft;
      if (els.sendBtn) els.sendBtn.disabled = !draft.trim();
    }
  }

  async function loadContext() {
    const ctx = await CP.api('/chat/context');
    state.me = ctx.me;
    state.members = ctx.members;
    state.groupName = ctx.group_name;
    state.notice = ctx.notice;
    state.myLastReadId = ctx.my_last_read_id || 0;
    state.favorites = new Set(ctx.favorites || []);
    els.groupName.textContent = state.groupName;
    els.groupSub.textContent = state.me.name + (state.me.role === 'front' ? '（前台）' : '');
    if (state.notice && state.notice.content) {
      els.noticeBar.classList.add('show');
      els.noticeBar.querySelector('.txt').textContent = '📢 ' + state.notice.content;
    }
  }

  async function loadInitialMessages() {
    const r = await CP.api('/chat/messages?limit=50');
    state.messages = r.messages || [];
    if (state.messages.length) {
      state.lastId = state.messages[state.messages.length - 1].id;
      renderMessages(true);
      scrollToBottom();
    }
    // 上报已读到最新
    if (state.lastId > state.myLastReadId) {
      reportRead(state.lastId);
    }
  }

  function reportRead(id) {
    if (!id) return;
    CP.api('/chat/read', { method: 'POST', body: { after_id: id }, handle401: false }).catch(() => {});
  }

  // ---------- 渲染消息 ----------
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0,0,0,0);
    const msgDay = new Date(d); msgDay.setHours(0,0,0,0);
    const diff = (today - msgDay) / 86400000;
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    let s = wd + ' ' + (d.getMonth()+1) + '月' + d.getDate() + '日';
    if (d.getFullYear() !== today.getFullYear()) s = d.getFullYear() + '年' + s;
    return s;
  }
  function renderMessages(keepScroll) {
    const prevScroll = keepScroll ? els.scroll.scrollHeight - els.scroll.scrollTop : 0;
    els.scroll.innerHTML = '';
    let lastDay = '';
    let pastUnread = false;
    for (let i = 0; i < state.messages.length; i++) {
      const m = state.messages[i];
      const day = dayLabel(m.created_at);
      if (day !== lastDay) {
        const d = document.createElement('div');
        d.className = 'chat-day-divider'; d.textContent = day;
        els.scroll.appendChild(d);
        lastDay = day;
      }
      if (!pastUnread && m.id > state.myLastReadId && state.myLastReadId > 0) {
        const u = document.createElement('div');
        u.className = 'chat-unread-divider'; u.textContent = '以下是未读消息';
        els.scroll.appendChild(u);
        pastUnread = true;
      }
      els.scroll.appendChild(renderRow(m));
    }
    if (keepScroll) els.scroll.scrollTop = els.scroll.scrollHeight - prevScroll;
  }

  function renderRow(m) {
    const me = state.me ? m.sender_key === state.me.member_key : false;
    const row = document.createElement('div');
    if (m.recalled) {
      row.className = 'chat-row recalled-row';
      row.innerHTML = `<div class="sys">${esc(m.sender_name)} 撤回了一条消息</div>`;
      return row;
    }
    row.className = 'chat-row' + (me ? ' me' : '');
    const av = CP.avatarHTML(m.sender_avatar || (m.sender_key === 'front' ? '👦' : '👤'), { size: 36 });
    let inner = '';
    if (m.reply_to && m.reply && m.reply.sender_name && !m.reply.deleted) {
      const rqText = m.reply.msg_type === 'text' ? (m.reply.content || '') : (m.reply.msg_type === 'image' ? '[图片]' : '[文件]');
      inner += `<div class="reply-quote">${esc(m.reply.sender_name)}：${esc(rqText.slice(0,40))}</div>`;
    }
    if (m.msg_type === 'image' && m.attachments && m.attachments[0]) {
      inner += `<img class="thumb" src="${esc(m.attachments[0].url)}" data-protect alt="">`;
    } else if (m.msg_type === 'file' && m.attachments && m.attachments[0]) {
      const a = m.attachments[0];
      inner += `<a class="file-card" href="${esc(a.url)}" download="${esc(a.name)}" target="_blank"><i class="fas fa-file"></i><div><div class="fn">${esc(a.name)}</div><div class="fs">${fmtSize(a.size)}</div></div></a>`;
    }
    if (m.content) {
      inner += `<div class="bubble ${m.reply_to ? 'replied' : ''}">${renderFaces(m.content)}</div>`;
    } else if (m.msg_type !== 'image' && m.msg_type !== 'file') {
      inner += `<div class="bubble"></div>`;
    }
    if (m.failed) inner += `<div class="fail-retry" title="点击重发"><i class="fas fa-exclamation-circle"></i></div>`;
    row.innerHTML = `
      <span class="chat-avatar-wrap">${av}</span>
      <div class="body">
        <div class="name">${esc(m.sender_name)}</div>
        <div class="bubble-wrap" data-uid="${esc(m.uid)}" data-created="${m.created_at}">${inner}</div>
        <div class="msg-time">${fmtHM(m.created_at)}</div>
      </div>`;
    bindRowActions(row, m, me);
    return row;
  }

  function bindRowActions(row, m, me) {
    const wrap = row.querySelector('.bubble-wrap');
    if (!wrap) return;
    const fr = row.querySelector('.fail-retry');
    if (fr) fr.onclick = async (e) => {
      e.stopPropagation();
      fr.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        const r = await CP.api('/chat/messages', { method: 'POST', body: m._body });
        const idx = state.messages.findIndex(x => x.uid === m.uid);
        if (idx >= 0) state.messages[idx] = r.message;
        state.lastId = r.message.id;
        state.myLastReadId = r.message.id;
        renderMessages(true);
      } catch (err) {
        fr.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        CP.toast(err.message || '重发失败', 'error');
      }
    };
    wrap.addEventListener('click', e => {
      if (e.target.tagName === 'IMG' && m.msg_type === 'image') {
        openLightbox(m.attachments[0].url);
      }
    });
    // 右键/长按只绑定在头像元素上
    const avWrap = row.querySelector('.chat-avatar-wrap');
    if (avWrap) {
      avWrap.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        showMenu(m, me, e.clientX, e.clientY);
      });
      let pressTimer = null, px = 0, py = 0;
      avWrap.addEventListener('touchstart', e => {
        const t = e.touches[0]; px = t.clientX; py = t.clientY;
        pressTimer = setTimeout(() => { e.preventDefault(); showMenu(m, me, px, py); }, 500);
      }, { passive: true });
      avWrap.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
      avWrap.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); });
      // 前台点头像 → 资料弹窗
      if (me && isFront) {
        avWrap.style.cursor = 'pointer';
        avWrap.addEventListener('click', e => { e.stopPropagation(); showFrontProfileModal(); });
      }
    }
  }

  function showFrontProfileModal() {
    const me = state.me || {};
    const box = CP.modal(`
      <h3>我的资料</h3>
      <div style="display:flex;align-items:center;gap:12px;margin:10px 0">
        <span id="fp-avatar-preview">${CP.avatarHTML(me.avatar || '👦', { size: 56 })}</span>
        <button class="btn btn-sm btn-soft" id="fp-upload"><i class="fas fa-upload"></i> 上传头像</button>
        <input type="file" id="fp-file" accept="image/*" hidden>
      </div>
      <div class="form-row"><label class="form-label">昵称</label>
        <input id="fp-name" class="form-input" value="${esc(me.name || '')}" maxlength="20"></div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">保存</button>
      </div>`, { size: 'sm' });
    let uploadedUrl = '';
    box.querySelector('#fp-upload').onclick = () => box.querySelector('#fp-file').click();
    box.querySelector('#fp-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f); fd.append('prefix', 'front');
      try {
        const r = await CP.api('/upload', { method: 'POST', body: fd });
        uploadedUrl = r.url || '';
        box.querySelector('#fp-avatar-preview').innerHTML = CP.avatarHTML(uploadedUrl, { size: 56 });
      } catch (err) { CP.failToast(err, '上传失败'); }
    };
    box.querySelector('[data-act=cancel]').onclick = () => CP.closeModal();
    box.querySelector('[data-act=ok]').onclick = async () => {
      const name = box.querySelector('#fp-name').value.trim();
      if (!name) return CP.toast('昵称不能为空', 'warn');
      try {
        await CP.api('/chat/front-profile', { method: 'POST', body: { name, avatar: uploadedUrl || me.avatar || '' } });
        CP.closeModal(); loadContext().catch(() => {});
        CP.toast('资料已更新', 'success');
      } catch (e) { CP.failToast(e, '保存失败'); }
    };
  }

  function showMenu(m, me, x, y) {
    closeMenu();
    const menu = document.createElement('div');
    menu.id = 'chat-ctx-menu';
    const title = (CP.bootstrap && CP.bootstrap.ctx_menu_title) || '你想干嘛？';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:60;min-width:140px;overflow:hidden`;
    menu.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--text-3);border-bottom:1px solid var(--border)">${esc(title)}</div>`;
    const items = [];
    items.push(['复制', async () => { try { await navigator.clipboard.writeText(m.content || ''); CP.toast('已复制'); } catch {} }]);
    items.push(['回复', () => { state.replyTo = m; els.replyBar.classList.add('show'); els.replyTxt.textContent = `回复 ${m.sender_name}: ${(m.content||'').slice(0,30)}`; }]);
    items.push(['收藏', () => toggleFavorite(m)]);
    if (canRecall(m, me)) items.push(['撤回', () => recall(m)]);
    for (const [label, fn] of items) {
      const b = document.createElement('button');
      b.className = 'btn'; b.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;font-size:14px;cursor:pointer';
      b.textContent = label;
      b.onclick = () => { closeMenu(); fn(); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }));
  }
  function closeMenu() { document.getElementById('chat-ctx-menu')?.remove(); }

  function canRecall(m, me) {
    if (!state.me) return false;
    // staff（teacher/super）可撤回任意；front 只能撤回本人 2 分钟内
    if (state.me.role === 'teacher' || state.me.role === 'super') return true;
    if (m.sender_key === state.me.member_key && (Date.now() - m.created_at) < 2 * 60 * 1000) return true;
    return false;
  }

  async function recall(m) {
    try {
      await CP.api(`/chat/messages/${m.uid}/recall`, { method: 'POST' });
      const mm = state.messages.find(x => x.uid === m.uid);
      if (mm) mm.recalled = 1;
      renderMessages(true);
    } catch (e) { CP.toast(e.message || '撤回失败', 'error'); }
  }

  async function toggleFavorite(m) {
    if (state.favorites.has(m.uid)) {
      await CP.api(`/chat/favorites/${m.uid}`, { method: 'DELETE' });
      state.favorites.delete(m.uid);
    } else {
      await CP.api('/chat/favorites', { method: 'POST', body: { msg_uid: m.uid } });
      state.favorites.add(m.uid);
    }
  }

  // ---------- 3s 轮询（v5.2 移除 SSE） ----------
  function startPoll() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(pollNew, 3000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInterval(state.pollTimer); state.pollTimer = null; }
      else if (!state.pollTimer) state.pollTimer = setInterval(pollNew, 3000);
    });
  }

  async function pollNew() {
    if (document.hidden) return;
    try {
      const r = await CP.api(`/chat/new?after=${state.lastId}`, { handle401: false });
      if (r.messages && r.messages.length) {
        for (const m of r.messages) onIncoming(m);
      }
    } catch {}
    try {
      const nc = await CP.api('/chat/notice', { handle401: false });
      const d = (nc && nc.data) ? nc.data : nc;
      const notice = d && d.notice ? d.notice : d;
      const cur = state.notice && state.notice.content;
      if (notice && notice.content !== cur) { state.notice = notice; loadContext().catch(() => {}); }
    } catch {}
  }

  function onIncoming(m) {
    if (state.me && m.sender_key === state.me.member_key) {
      // 自己发的（SSE 已排除），但轮询可能收到；去重
      if (state.messages.some(x => x.id === m.id)) return;
    }
    if (state.messages.some(x => x.id === m.id)) return;
    state.messages.push(m);
    if (m.id > state.lastId) state.lastId = m.id;
    renderMessages(true);
    scrollToBottom();
    // 新消息实时渲染即可（v5.0 通知统一走 WxPusher 客户端，浏览器不做 toast/提示音）
    // 自动上报已读
    if (m.id > state.myLastReadId) {
      state.myLastReadId = m.id;
      reportRead(m.id);
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { els.scroll.scrollTop = els.scroll.scrollHeight; });
  }

  // ---------- 输入框（contenteditable，表情以小图显示） ----------
  function getInputText() {
    let out = '';
    function walk(node) {
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) {
          out += n.textContent;
        } else if (n.nodeType === 1) {
          const tag = n.tagName.toLowerCase();
          if (tag === 'img') out += n.getAttribute('data-code') || '';
          else if (tag === 'br') out += '\n';
          else if (tag === 'div') {
            if (out && !out.endsWith('\n')) out += '\n';
            walk(n);
          } else walk(n);
        }
      });
    }
    walk(els.input);
    return out.trim();
  }
  function clearInput() {
    els.input.innerHTML = '';
  }
  function insertAtCaret(node) {
    els.input.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !els.input.contains(sel.anchorNode)) {
      els.input.appendChild(node);
    } else {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  function insertFace(kind, id, src) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'face-chip';
    img.draggable = false;
    img.setAttribute('data-code', `[face:${kind}:${id}]`);
    insertAtCaret(img);
    els.input.dispatchEvent(new Event('input'));
  }

  // ---------- 发送 ----------
  async function send() {
    const text = getInputText();
    if (!text) return;
    const body = { msg_type: 'text', content: text, reply_to: state.replyTo ? state.replyTo.uid : '' };
    // v5.1: 先插入一条本地 pending 消息，失败标红可重发
    const pending = { id: -Date.now(), uid: 'pending-' + Date.now(), sender_key: state.me.member_key, sender_name: state.me.name, sender_avatar: state.me.avatar, msg_type: 'text', content: text, attachments: [], reply_to: body.reply_to, reply: {}, recalled: 0, deleted: 0, created_at: Date.now(), failed: true, _body: body };
    state.messages.push(pending);
    clearInput();
    els.sendBtn.disabled = true;
    localStorage.removeItem(LS_DRAFT + ':' + state.me.member_key);
    state.replyTo = null; els.replyBar.classList.remove('show');
    renderMessages(true); scrollToBottom();
    try {
      const r = await CP.api('/chat/messages', { method: 'POST', body });
      const idx = state.messages.findIndex(x => x.uid === pending.uid);
      if (idx >= 0) state.messages[idx] = r.message;
      state.lastId = r.message.id;
      state.myLastReadId = r.message.id;
      renderMessages(true); scrollToBottom();
    } catch (e) {
      // 失败消息保持在列表，点红点重发
      CP.toast(e.message || '发送失败', 'error');
    }
  }

  async function uploadAndSend(file, msgType) {
    if (file.size > MAX_FILE) { CP.toast('文件不能超过 600MB', 'warn'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefix', 'chat');
    try {
      const upOpts = isStaff ? { noDeviceToken: true } : isFront ? { noStaffToken: true } : {};
      const r = await CP.api('/upload', Object.assign({ method: 'POST', body: fd }, upOpts));
      const body = {
        msg_type: msgType,
        content: '',
        attachments: [{ name: r.name, size: r.size, type: r.type, url: r.url }],
        reply_to: state.replyTo ? state.replyTo.uid : '',
      };
      const mr = await CP.api('/chat/messages', Object.assign({ method: 'POST', body }, upOpts));
      if (!state.messages.some(x => x.id === mr.message.id)) {
        state.messages.push(mr.message);
        state.lastId = mr.message.id;
        state.myLastReadId = mr.message.id;
        renderMessages(true); scrollToBottom();
      }
    } catch (e) { CP.toast(e.message || '上传失败', 'error'); }
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    // v5.1: ESC 关闭所有面板
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        ['facePanel','searchPanel','favPanel','membersPanel','filesPanel'].forEach(k => {
          if (els[k]) els[k].classList.remove('show');
        });
        CP.closeModal && CP.closeModal();
      }
    });
    els.sendBtn.onclick = send;
    if (els.sendBtn) els.sendBtn.disabled = !getInputText();
    // v5.1: 上滑到顶加载更早消息
    els.scroll.addEventListener('scroll', async () => {
      if (els.scroll.scrollTop < 40 && !state.loadingMore && state.messages.length) {
        state.loadingMore = true;
        try {
          const firstId = state.messages[0].id;
          const r = await CP.api(`/chat/messages?before=${firstId}&limit=50`, { handle401: false });
          if (r.messages && r.messages.length) {
            const prevH = els.scroll.scrollHeight;
            state.messages = [...r.messages, ...state.messages];
            renderMessages(false);
            els.scroll.scrollTop = els.scroll.scrollHeight - prevH;
          }
        } catch {}
        state.loadingMore = false;
      }
    });
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.shiftKey) insertAtCaret(document.createElement('br'));
        else send();
      }
    });
    els.input.addEventListener('input', () => {
      const mk = state.me ? state.me.member_key : 'front';
      localStorage.setItem(LS_DRAFT + ':' + mk, getInputText());
      // 发送按钮空内容禁用
      if (els.sendBtn) els.sendBtn.disabled = !getInputText();
    });
    els.imgBtn.onclick = () => els.imgInput.click();
    els.cameraBtn.onclick = () => els.cameraInput.click();
    els.fileBtn.onclick = () => els.fileInput.click();
    els.imgInput.onchange = e => { if (e.target.files[0]) uploadAndSend(e.target.files[0], 'image'); e.target.value = ''; };
    els.cameraInput.onchange = e => { if (e.target.files[0]) uploadAndSend(e.target.files[0], 'image'); e.target.value = ''; };
    els.fileInput.onchange = e => { if (e.target.files[0]) uploadAndSend(e.target.files[0], 'file'); e.target.value = ''; };
    els.replyCancel.onclick = () => { state.replyTo = null; els.replyBar.classList.remove('show'); };
    els.faceBtn.onclick = () => {
      const willShow = !els.facePanel.classList.contains('show');
      if (willShow) ensureFaceGrid();
      els.facePanel.classList.toggle('show');
    };
    els.noticeBar.onclick = () => {
      if (!state.notice) return;
      const canEdit = state.me.role !== 'front';
      CP.modal(`<h3>群公告</h3>
        <p style="white-space:pre-wrap;color:var(--text-2)">${esc(state.notice.content)}</p>
        ${canEdit ? `<textarea id="chat-notice-input" class="form-input" rows="3" placeholder="编辑群公告" style="margin-top:8px">${esc(state.notice.content)}</textarea>` : ''}
        <div class="modal-foot">
          <button class="btn" onclick="CP.closeModal()">关闭</button>
          ${canEdit ? `<button class="btn btn-primary" id="chat-notice-save">保存</button>` : ''}
        </div>`, { size: 'sm',
        onShow: (box) => {
          const b = box.querySelector('#chat-notice-save');
          if (b) b.onclick = async () => {
            const v = box.querySelector('#chat-notice-input').value;
            try {
              await CP.api('/chat/notice', { method: 'POST', body: { content: v } });
              CP.closeModal(); loadContext();
            } catch (e) { CP.toast(e.message || '保存失败', 'error'); }
          };
        }});
    };
    els.filesBtn.onclick = () => openPanel('群文件', renderFiles);
    $('chat-fav-btn') && ($('chat-fav-btn').onclick = () => openPanel('我的收藏', renderFavorites));
    els.searchBtn.onclick = () => openPanel('搜索', renderSearchPanel);
    els.backBtn.onclick = () => {
      const back = isStaff ? '/admin/' : '/';
      location.href = back;
    };
    buildFacePanel();
    // 移动端：检测窄屏，显示发送按钮
    if (window.innerWidth < 600) els.input.parentElement.classList.add('is-mobile');
    // 粘贴图片
    document.addEventListener('paste', e => {
      for (const item of (e.clipboardData && e.clipboardData.items) || []) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) uploadAndSend(f, 'image');
        }
      }
    });
  }

  function openPanel(title, renderFn) {
    els.panelTitle.textContent = title;
    els.panel.classList.add('show');
    renderFn();
  }
  window.closeChatPanel = () => els.panel.classList.remove('show');
  // v5.1: 点抽屉外空白关闭（保留 X 与 ESC）
  if (els.panel) {
    const PANEL_OPENERS = ['chat-files', 'chat-fav-btn', 'chat-search'];
    document.addEventListener('click', e => {
      if (!els.panel.classList.contains('show')) return;
      if (els.panel.contains(e.target)) return;
      if (PANEL_OPENERS.some(id => { const b = $(id); return b && b.contains(e.target); })) return;
      els.panel.classList.remove('show');
    });
  }
  if (els.facePanel) {
    document.addEventListener('click', e => {
      if (!els.facePanel.classList.contains('show')) return;
      if (els.facePanel.contains(e.target) || els.faceBtn.contains(e.target)) return;
      els.facePanel.classList.remove('show');
    });
  }

  function renderMembers() {
    els.panelBody.innerHTML = (state.members || []).map(m => `
      <div class="chat-member-row">
        ${CP.avatarHTML(m.avatar || (m.member_key === 'front' ? '👦' : '👤'), { size: 40 })}
        <div class="meta"><div class="nm">${esc(m.name)}</div><div class="rl">${m.role === 'super' ? '管理员' : m.role === 'teacher' ? '老师' : '前台大屏'}</div></div>
      </div>`).join('');
  }
  async function renderFiles() {
    try {
      const r = await CP.api('/chat/files');
      els.panelBody.innerHTML = r.files.length ? r.files.map(f => `
        <div class="chat-member-row">
          <i class="fas fa-file" style="font-size:20px"></i>
          <div class="meta"><div class="nm">${esc(f.name)}</div><div class="rl">${esc(f.sender_name)} · ${fmtSize(f.size)} · ${CP.fmtTime(f.created_at)}</div></div>
          <a class="icon-btn" href="${esc(f.url)}" download target="_blank"><i class="fas fa-download"></i></a>
        </div>`).join('') : '<p style="color:var(--chat-text-2)">暂无文件</p>';
    } catch (e) { els.panelBody.innerHTML = '<p>加载失败</p>'; }
  }
  async function renderFavorites() {
    try {
      const r = await CP.api('/chat/favorites');
      els.panelBody.innerHTML = r.messages.length ? r.messages.map(m => {
        const textPreview = m.msg_type === 'image' ? '[图片]'
          : m.msg_type === 'file' ? '[文件] ' + ((m.attachments && m.attachments[0] && m.attachments[0].name) || '')
          : (m.content || '').slice(0, 60);
        return `<div class="chat-search-result" data-uid="${m.uid}" data-id="${m.id}">
          <div style="font-weight:600">${esc(m.sender_name)}</div>
          <div style="color:var(--chat-text-2);font-size:13px">${esc(textPreview)}</div>
        </div>`;
      }).join('') : '<p style="color:var(--chat-text-2)">暂无收藏</p>';
      els.panelBody.querySelectorAll('.chat-search-result').forEach(el => {
        el.onclick = () => jumpToId(Number(el.dataset.id));
      });
    } catch (e) { els.panelBody.innerHTML = '<p>加载失败</p>'; }
  }
  function renderSearchPanel() {
    els.panelBody.innerHTML = `
      <input id="chat-search-input" class="form-input" placeholder="搜索消息…" style="margin-bottom:8px">
      <div id="chat-search-results"></div>`;
    let timer = null;
    els.panelBody.querySelector('#chat-search-input').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = e.target.value.trim();
        if (!q) return;
        try {
          const r = await CP.api(`/chat/search?q=${encodeURIComponent(q)}`);
          const box = els.panelBody.querySelector('#chat-search-results');
          box.innerHTML = r.messages.length ? r.messages.map(m => {
            const textPreview = m.msg_type === 'image' ? '[图片]'
              : m.msg_type === 'file' ? '[文件] ' + ((m.attachments && m.attachments[0] && m.attachments[0].name) || '')
              : (m.content || '').slice(0, 80);
            return `<div class="chat-search-result" data-id="${m.id}">
              <div style="font-weight:600">${esc(m.sender_name)}</div>
              <div style="color:var(--chat-text-2);font-size:13px">${esc(textPreview)}</div>
            </div>`;
          }).join('') : '<p style="color:var(--chat-text-2)">无结果</p>';
          box.querySelectorAll('.chat-search-result').forEach(el => {
            el.onclick = () => jumpToId(Number(el.dataset.id));
          });
        } catch {}
      }, 300);
    });
  }
  async function jumpToId(id) {
    // 拉取该 id 附近消息
    try {
      const r = await CP.api(`/chat/messages?before=${id + 1}&limit=50`);
      state.messages = r.messages;
      if (state.messages.length) state.lastId = state.messages[state.messages.length - 1].id;
      renderMessages(false);
      closeChatPanel();
      scrollToBottom();
    } catch {}
  }

  // ---------- 表情面板（v5.2: 小批量预加载 + 自定义 Tab） ----------
  let faceCur = localStorage.getItem(LS_FACE_TAB) || 'wx';
  let faceBuilt = false;
  let facePreloaded = {};
  async function loadCustomStickers() {
    try {
      const r = await CP.api('/chat/stickers', { handle401: false, noStaffToken: isFront });
      state.customStickers = r.stickers || [];
    } catch { state.customStickers = []; }
  }
  function renderFaceTab(kind) {
    if (kind === 'custom') {
      const isStaffRole = state.me && (state.me.role === 'teacher' || state.me.role === 'super');
      let html = state.customStickers.map(s =>
        `<div class="fcell" data-kind="custom" data-url="${esc(s.url)}" title="${esc(s.name || '')}">
          <img loading="lazy" src="${esc(s.url)}">
          ${isStaffRole ? `<i class="fas fa-times stick-del" data-url="${esc(s.url)}" style="position:absolute;top:2px;right:2px;font-size:10px;color:#fff;background:rgba(0,0,0,.5);border-radius:50%;padding:2px"></i>` : ''}
        </div>`).join('');
      if (isStaffRole) html += `<div class="fcell stick-upload" id="stick-upload"><i class="fas fa-plus"></i></div>`;
      els.faceGrid.innerHTML = html;
      els.faceGrid.querySelectorAll('.fcell[data-url]').forEach(el => {
        el.onclick = () => {
          const url = el.dataset.url;
          sendImageSticker(url);
        };
      });
      const del = els.faceGrid.querySelectorAll('.stick-del');
      del.forEach(el => el.onclick = async e => {
        e.stopPropagation();
        const url = el.dataset.url;
        try {
          await CP.api('/chat/stickers', { method: 'DELETE', body: { url } });
          state.customStickers = state.customStickers.filter(s => s.url !== url);
          renderFaceTab('custom');
        } catch (err) { CP.failToast(err, '删除失败'); }
      });
      const up = els.faceGrid.querySelector('#stick-upload');
      if (up) up.onclick = uploadCustomSticker;
      return;
    }
    const sec = state.faceManifest[kind === 'wx' ? 'wechat' : 'qq'];
    if (!sec) return;
    els.faceGrid.innerHTML = sec.order.map(id => {
      const f = sec.faces[id];
      const file = (f && (f.anim || f.png)) || '';
      if (!file) return '';
      const tok = String(id).replace(/[\[\]]/g, '');
      return `<div class="fcell" data-kind="${kind}" data-id="${tok}" title="${esc(f.name || '')}"><img loading="lazy" src="/assets/qq-face/${file}"></div>`;
    }).join('');
    els.faceGrid.querySelectorAll('.fcell').forEach(el => {
      el.onclick = () => {
        const kind = el.dataset.kind;
        const id = el.dataset.id;
        const img = el.querySelector('img');
        insertFace(kind, id, img ? img.src : '');
      };
    });
  }
  async function uploadCustomSticker() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f); fd.append('prefix', 'stickers');
      try {
        const up = await CP.api('/upload', { method: 'POST', body: fd });
        const url = up.url || '';
        if (!url) return CP.toast('上传失败', 'error');
        await CP.api('/chat/stickers', { method: 'POST', body: { url, name: f.name } });
        await loadCustomStickers();
        renderFaceTab('custom');
        CP.toast('已添加自定义表情', 'success');
      } catch (err) { CP.failToast(err, '添加失败'); }
    };
    inp.click();
  }
  async function sendImageSticker(url) {
    const body = { msg_type: 'image', content: '', attachments: [{ url, name: 'sticker', size: 0, type: 'image/*' }], reply_to: state.replyTo ? state.replyTo.uid : '' };
    try {
      const r = await CP.api('/chat/messages', { method: 'POST', body });
      if (!state.messages.some(x => x.id === r.message.id)) {
        state.messages.push(r.message);
        state.lastId = r.message.id;
        state.myLastReadId = r.message.id;
        renderMessages(true); scrollToBottom();
      }
    } catch (e) { CP.toast(e.message || '发送失败', 'error'); }
  }
  function ensureFaceGrid() {
    if (!faceBuilt) return;
    els.faceTabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.k === faceCur));
    renderFaceTab(faceCur);
  }
  async function buildFacePanel() {
    await loadCustomStickers();
    if (!state.faceManifest) { els.facePanel.style.display = 'none'; return; }
    els.facePanel.style.display = '';
    const tabs = [['wx', '经典表情'], ['qq', 'QQ 经典'], ['custom', '自定义']];
    els.faceTabs.innerHTML = tabs.map(([k, label]) => `<button data-k="${k}">${label}</button>`).join('');
    els.faceTabs.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        faceCur = b.dataset.k;
        localStorage.setItem(LS_FACE_TAB, faceCur);
        els.faceTabs.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderFaceTab(faceCur);
        gentlePreload(faceCur);
      };
    });
    // 不做全局预加载（几百张图会占满单条隧道）。面板打开后，仅对当前 Tab 小批量慢速预加载，
    // 其余 Tab 在切换时再加载；浏览器缓存后再次打开即一点即显。
    facePreloaded = {};
    faceBuilt = true;
    els.faceTabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.k === faceCur));
    renderFaceTab(faceCur);
    gentlePreload(faceCur);
  }
  function gentlePreload(kind) {
    if (!state.faceManifest || kind === 'custom' || facePreloaded[kind]) return;
    facePreloaded[kind] = true;
    const sec = state.faceManifest[kind === 'qq' ? 'qq' : 'wechat'];
    if (!sec || !sec.faces) return;
    const paths = Object.values(sec.faces).map(f => f.anim || f.png).filter(Boolean).map(p => '/assets/qq-face/' + p);
    const batch = i => {
      if (i >= paths.length) return;
      paths.slice(i, i + 4).forEach(p => { const img = new Image(); img.src = p; });
      setTimeout(() => batch(i + 4), 300);
    };
    setTimeout(() => batch(0), 800);
  }

  // ---------- 图片预览 ----------
  function openLightbox(src) {
    els.lightboxImg.src = src;
    els.lightbox.classList.add('show');
  }
  els.lightbox?.addEventListener('click', e => {
    if (e.target === els.lightbox || e.target.tagName === 'IMG') els.lightbox.classList.remove('show');
  });

  document.addEventListener('DOMContentLoaded', init);
})();
