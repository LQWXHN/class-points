/* /send.html 前台→后台发消息：标题/正文/附件，无分类；先 /api/upload 再 POST /api/front-messages */
'use strict';
const $ = id => document.getElementById(id);

async function doSend() {
  const title = $('f-title').value.trim();
  const content = $('f-content').value.trim();
  if (!title && !content) return CP.toast('请填写标题或正文', 'error');
  const file = $('f-file').files[0];
  const btn = $('btn-send');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中…';
  const prog = CP.uploadCard('发送消息');
  try {
    let fileInfo = {};
    if (file) {
      const fd = new FormData(); fd.append('file', file);
      const up = await CP.api('/upload', { method: 'POST', body: fd, onProgress: (l, t) => prog.progress(l, t) });
      const u = (up && (up.data || up)) || {};
      fileInfo = {
        file_url: u.url || u.file_url || '',
        file_name: u.name || u.file_name || file.name,
        file_type: u.type || u.file_type || file.type,
        file_size: u.size || u.file_size || file.size
      };
    }
    await CP.api('/front-messages', { method: 'POST', body: Object.assign({ title, content }, fileInfo) });
    prog.done();
    CP.toast('已发送，老师会尽快查看', 'success');
    $('f-title').value = ''; $('f-content').value = ''; $('f-file').value = '';
    $('file-info').style.display = 'none';
  } catch (e) {
    prog.fail();
    CP.failToast(e, '发送失败');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> 发送';
  }
}

(async function init() {
  CP.applyTitle('发消息');
  const ok = await CP.requireDevice(); // 无设备 token 自动跳激活
  if (!ok) return;
  $('btn-send').onclick = doSend;
  $('f-file').onchange = () => {
    const f = $('f-file').files[0];
    const box = $('file-info');
    if (!f) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = '<i class="fas fa-paperclip"></i> ' + CP.esc(f.name) + ' <span class="text-3">(' + (f.size / 1024).toFixed(1) + ' KB)</span>';
  };
})();
