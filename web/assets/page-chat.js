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
    es: null,               // EventSource
    pollTimer: null,
    usingPoll: false,
    seenImageIdx: 0,
  };

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const els = {
    scroll: $('chat-scroll'), input: $('chat-input'), sendBtn: $('chat-send'),
    faceBtn: $('chat-face'), imgBtn: $('chat-img'), fileBtn: $('chat-file'),
    searchBtn: $('chat-search'), membersBtn: $('chat-members'), filesBtn: $('chat-files'),
    backBtn: $('chat-back'), noticeBar: $('chat-notice-bar'),
    replyBar: $('chat-reply-bar'), replyTxt: $('chat-reply-txt'), replyCancel: $('chat-reply-cancel'),
    panel: $('chat-panel'), panelTitle: $('chat-panel-title'), panelBody: $('chat-panel-body'),
    facePanel: $('chat-face-panel'), faceTabs: $('chat-face-tabs'), faceGrid: $('chat-face-grid'),
    lightbox: $('chat-lightbox'), lightboxImg: $('chat-lightbox-img'),
    groupName: $('chat-gname'), groupSub: $('chat-gsub'),
    fileInput: $('chat-file-input'), imgInput: $('chat-img-input'),
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
    connectStream();
    // 草稿恢复
    const draft = localStorage.getItem(LS_DRAFT + ':' + (state.me && state.me.member_key || 'front'));
    if (draft) {
      els.input.value = draft;
      els.input.style.height = 'auto';
      els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
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
  function renderMessages(keepScroll) {
    const prevScroll = keepScroll ? els.scroll.scrollHeight - els.scroll.scrollTop : 0;
    els.scroll.innerHTML = '';
    let lastDay = '';
    let lastTs = 0;
    let lastSender = '';
    let pastUnread = false;
    for (let i = 0; i < state.messages.length; i++) {
      const m = state.messages[i];
      const day = fmtDay(m.created_at);
      if (day !== lastDay) {
        const d = document.createElement('div');
        d.className = 'chat-day-divider'; d.textContent = day;
        els.scroll.appendChild(d);
        lastDay = day; lastTs = 0; lastSender = '';
      } else if (m.created_at - lastTs > 5 * 60 * 1000) {
        const t = document.createElement('div');
        t.className = 'chat-time-divider'; t.textContent = fmtHM(m.created_at);
        els.scroll.appendChild(t);
      }
      // 未读分割线
      if (!pastUnread && m.id > state.myLastReadId && state.myLastReadId > 0) {
        const u = document.createElement('div');
        u.className = 'chat-unread-divider'; u.textContent = '以下是未读消息';
        els.scroll.appendChild(u);
        pastUnread = true;
      }
      // 连续同发送者：hide avatar/name（QQ 习惯）
      const grouped = (m.sender_key === lastSender) && !m.recalled;
      els.scroll.appendChild(renderRow(m, grouped));
      lastTs = m.created_at; lastSender = m.sender_key;
    }
    if (keepScroll) els.scroll.scrollTop = els.scroll.scrollHeight - prevScroll;
  }

  function fmtHM(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function renderRow(m, grouped) {
    grouped = !!grouped;
    const me = state.me ? m.sender_key === state.me.member_key : false;
    const row = document.createElement('div');
    if (m.recalled) {
      row.className = 'chat-row recalled-row';
      row.innerHTML = `<div class="sys">${esc(m.sender_name)} 撤回了一条消息</div>`;
      return row;
    }
    row.className = 'chat-row' + (me ? ' me' : '') + (grouped ? ' grouped' : '');
    const av = grouped ? '' : CP.avatarHTML(m.sender_avatar || (m.sender_key === 'front' ? '👦' : '👤'), { size: 36 });
    let inner = '';
    // reply quote
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
    // v5.1: 失败红点
    if (m.failed) inner += `<div class="fail-retry" title="点击重发"><i class="fas fa-exclamation-circle"></i></div>`;
    // 已读 n/N：只在自己最后一条消息旁显示
    const totalMembers = (state.members && state.members.length) || 3;
    const isOwnLast = me && m.id === state.lastId;
    const nameHtml = (me || grouped) ? '' : `<div class="name">${esc(m.sender_name)}</div>`;
    row.innerHTML = `
      ${av}
      <div class="body">
        ${nameHtml}
        <div class="bubble-wrap" data-uid="${esc(m.uid)}" data-created="${m.created_at}">${inner}</div>
        ${isOwnLast ? `<div class="read-mark">${m.read_count || 0}/${totalMembers} 已读</div>` : ''}
      </div>`;
    bindRowActions(row, m, me);
    return row;
  }

  function bindRowActions(row, m, me) {
    const wrap = row.querySelector('.bubble-wrap');
    if (!wrap) return;
    // v5.1: 失败点击重发
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
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault();
      showMenu(m, me, e.clientX, e.clientY);
    });
    // 移动端长按 500ms 弹同一菜单
    let pressTimer = null, px = 0, py = 0;
    wrap.addEventListener('touchstart', e => {
      const t = e.touches[0]; px = t.clientX; py = t.clientY;
      pressTimer = setTimeout(() => {
        e.preventDefault();
        showMenu(m, me, px, py);
      }, 500);
    }, { passive: true });
    wrap.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
    wrap.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); });
  }

  function showMenu(m, me, x, y) {
    closeMenu();
    const menu = document.createElement('div');
    menu.id = 'chat-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:60;min-width:140px;overflow:hidden`;
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

  // ---------- 连接 SSE ----------
  function connectStream() {
    try {
      // EventSource 不能带自定义头；staff 用 ?t=<token>，front 用 ?dt=<token>
      let qs = '';
      if (isStaff) { const t = CP.getAdminToken(); if (t) qs = '?t=' + encodeURIComponent(t); }
      else { const dt = CP.getDeviceToken(); if (dt) qs = '?dt=' + encodeURIComponent(dt); }
      const url = '/api/chat/stream' + qs;
      state.es = new EventSource(url);
      state.es.addEventListener('message', e => {
        try { onIncoming(JSON.parse(e.data)); } catch {}
      });
      state.es.addEventListener('recall', e => {
        try {
          const d = JSON.parse(e.data);
          const mm = state.messages.find(x => x.uid === d.uid);
          if (mm) { mm.recalled = 1; renderMessages(true); }
        } catch {}
      });
      state.es.addEventListener('notice', () => loadContext().catch(() => {}));
      state.es.addEventListener('read', e => {
        try {
          const d = JSON.parse(e.data);
          const mem = (state.members || []).find(m => m.member_key === d.member_key);
          if (mem) { mem.last_read_id = d.last_read_id; mem.last_read_at = d.last_read_at; }
          // 重算 read_count 并重渲染（不整体闪屏）
          for (const m of state.messages) {
            if (m.sender_key === state.me?.member_key) {
              m.read_count = (state.members || []).filter(x => x.member_key !== m.sender_key && (x.last_read_id || 0) >= m.id).length;
            }
          }
          renderMessages(true);
        } catch {}
      });
      state.es.onerror = () => {
        // SSE 断开，切轮询
        if (!state.usingPoll) {
          state.usingPoll = true;
          startPoll();
        }
      };
    } catch {
      startPoll();
    }
  }

  function startPoll() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(pollNew, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInterval(state.pollTimer); state.pollTimer = null; }
      else if (state.usingPoll && !state.pollTimer) state.pollTimer = setInterval(pollNew, 5000);
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
    // SSE 断连轮询期间，公告变更也保持实时
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

  // ---------- 发送 ----------
  async function send() {
    const text = els.input.value.trim();
    if (!text) return;
    const body = { msg_type: 'text', content: text, reply_to: state.replyTo ? state.replyTo.uid : '' };
    // v5.1: 先插入一条本地 pending 消息，失败标红可重发
    const pending = { id: -Date.now(), uid: 'pending-' + Date.now(), sender_key: state.me.member_key, sender_name: state.me.name, sender_avatar: state.me.avatar, msg_type: 'text', content: text, attachments: [], reply_to: body.reply_to, reply: {}, recalled: 0, deleted: 0, created_at: Date.now(), failed: true, _body: body };
    state.messages.push(pending);
    els.input.value = '';
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
    if (els.sendBtn) els.sendBtn.disabled = !els.input.value.trim();
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
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    els.input.addEventListener('input', () => {
      const mk = state.me ? state.me.member_key : 'front';
      localStorage.setItem(LS_DRAFT + ':' + mk, els.input.value);
      // v5.1: 发送按钮空内容禁用
      if (els.sendBtn) els.sendBtn.disabled = !els.input.value.trim();
      // 自适应高度
      els.input.style.height = 'auto';
      els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
    });
    els.imgBtn.onclick = () => els.imgInput.click();
    els.fileBtn.onclick = () => els.fileInput.click();
    els.imgInput.onchange = e => { if (e.target.files[0]) uploadAndSend(e.target.files[0], 'image'); e.target.value = ''; };
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
    els.membersBtn.onclick = () => openPanel('成员', renderMembers);
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
    const PANEL_OPENERS = ['chat-members', 'chat-files', 'chat-fav-btn', 'chat-search'];
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

  // ---------- 表情面板 ----------
  let faceCur = localStorage.getItem(LS_FACE_TAB) || 'wx';
  let faceGridBuilt = false;
  function renderFaceTab(kind) {
    const sec = state.faceManifest[kind === 'wx' ? 'wechat' : 'qq'];
    if (!sec) return;
    els.faceGrid.innerHTML = sec.order.map(id => {
      const f = sec.faces[id];
      const file = (f && (f.anim || f.png)) || '';
      if (!file) return '';
      // token 用去掉方括号的 id（微信命名表情如 [gift] → gift）
      const tok = String(id).replace(/[\[\]]/g, '');
      return `<div class="fcell" data-kind="${kind}" data-id="${tok}" title="${esc(f.name || '')}"><img loading="lazy" src="/assets/qq-face/${file}"></div>`;
    }).join('');
    els.faceGrid.querySelectorAll('.fcell').forEach(el => {
      el.onclick = () => {
        const token = `[face:${el.dataset.kind}:${el.dataset.id}]`;
        els.input.value += token;
        els.input.focus();
      };
    });
  }
  function ensureFaceGrid() {
    if (!state.faceManifest) return;
    // 网格首次打开时才构建，避免一进页面就拉 150 张图
    els.faceTabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.k === faceCur));
    if (!faceGridBuilt) { renderFaceTab(faceCur); faceGridBuilt = true; }
  }
  function buildFacePanel() {
    if (!state.faceManifest) { els.facePanel.style.display = 'none'; return; }
    els.facePanel.style.display = '';
    const tabs = [['wx', '经典表情'], ['qq', 'QQ 经典']];
    els.faceTabs.innerHTML = tabs.map(([k, label]) => `<button data-k="${k}">${label}</button>`).join('');
    els.faceTabs.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        faceCur = b.dataset.k;
        localStorage.setItem(LS_FACE_TAB, faceCur);
        if (faceGridBuilt) {
          els.faceTabs.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          renderFaceTab(faceCur);
        }
      };
    });
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
