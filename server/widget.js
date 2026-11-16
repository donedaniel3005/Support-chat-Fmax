(function () {
  'use strict';
  var script = document.currentScript;
  function mount() {
  if (!script || document.getElementById('support-chat-platform-widget')) return;
  var widgetKey = script.getAttribute('data-key');
  if (!widgetKey) return;
  var apiUrl = (script.getAttribute('data-api') || new URL(script.src).origin).replace(/\/$/, '');
  var storageKey = 'support-widget-conversation-' + widgetKey;
  function remember(value) { try { if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey); } catch {} }
  function recalled() { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } }
  var host = document.createElement('div');
  host.id = 'support-chat-platform-widget';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });
  var state = { open: false, config: null, conversationId: recalled(), messages: [], draft: '', customerId: '', email: '', attachments: [], error: '', sending: false, pendingRequest: null, offline: false, expired: false, version: 0 };
  var syncing = false;
  var styles = document.createElement('style');
  styles.textContent = `
    :host { all: initial; color-scheme: light; font: 14px/1.5 system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; } button,input,textarea { font: inherit; }
    button { cursor: pointer; } button:disabled { opacity: .6; cursor: wait; }
    button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #3b82f6; outline-offset: 3px; }
    .launcher { position: fixed; bottom: 24px; min-width: 64px; height: 56px; padding: 0 20px; border: 0; border-radius: 20px; z-index: 2147483000; box-shadow: 0 10px 35px #132d2433; font-weight: 650; }
    .panel { position: fixed; bottom: 94px; width: 380px; max-width: calc(100vw - 28px); height: 610px; max-height: calc(100dvh - 116px); z-index: 2147482999; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 70px #132d2440; display: flex; flex-direction: column; background: #fff; color: #18271f; border: 1px solid #dde5df; }
    [hidden] { display: none !important; } .head { padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    strong,small { display: block; } .head strong { font-size: 16px; } .head small { font-size: 12px; margin-top: 3px; } .close { border: 1px solid currentColor; border-radius: 9px; background: transparent; color: inherit; padding: 4px 10px; font-size: 20px; }
    .body { flex: 1; min-height: 60px; overflow-y: auto; padding: 20px; display: grid; align-content: start; gap: 12px; background: #f8faf8; }
    .message { max-width: 88%; padding: 11px 14px; border-radius: 14px 14px 14px 4px; background: #e8eee9; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
    .message.user { justify-self: end; border-radius: 14px 14px 4px 14px; } .message small { font-size: 10px; margin-top: 6px; opacity: .8; }
    .message img { display: block; max-width: 100%; max-height: 220px; border-radius: 8px; margin-top: 8px; } .form { border-top: 1px solid #e4eae5; padding: 14px; display: grid; gap: 9px; background: white; }
    input,textarea { min-width: 0; width: 100%; border: 1px solid #ccd8cf; border-radius: 9px; padding: 10px 12px; background: #fff; color: #18271f; }
    textarea { min-height: 66px; max-height: 140px; resize: vertical; } .send { border: 0; border-radius: 9px; padding: 11px; font-weight: 650; }
    .error { color: #a61e29; font-size: 12px; margin: 0; } .connection { margin: 0; font-size: 11px; color: #526458; padding: 7px 14px; background: #f1f5f1; }
    .tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; } .attach { color: #324a3a; font-size: 12px; cursor: pointer; border: 1px solid #ccd8cf; padding: 5px 9px; border-radius: 7px; } .files { display: flex; gap: 5px; flex-wrap: wrap; } .files button { font-size: 11px; color: #324a3a; background: #eef3ee; border: 0; border-radius: 5px; padding: 4px; max-width: 100%; overflow-wrap: anywhere; }
    .reset,.retry { border: 0; padding: 6px; color: #245d38; background: transparent; text-decoration: underline; }
    @media(max-width:480px) { .launcher { bottom: 16px; } .panel { bottom: 86px; max-height: calc(100dvh - 102px); } }
    @media(prefers-reduced-motion: no-preference) { .panel { animation: arrive .18s ease-out; } @keyframes arrive { from { opacity: 0; transform: translateY(8px); } } }
  `;
  var view = document.createElement('div'); root.append(styles, view);
  function escape(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[c]; }); }
  function foreground(hex) {
    var rgb = hex.replace('#', '').match(/.{2}/g).map(function (v) { v = parseInt(v,16)/255; return v <= .04045 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
    return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722 > .179 ? '#101810' : '#ffffff';
  }
  function api(path, options) {
    return fetch(apiUrl + path, Object.assign({}, options, { headers: { 'Content-Type':'application/json', 'X-Widget-Key':widgetKey }, signal: AbortSignal.timeout(15000) })).then(async function (res) {
      var data; try { data = await res.json(); } catch { throw { error:'Support is temporarily unavailable. Please try again.', status:res.status }; }
      if (!res.ok) throw Object.assign({}, data, { status:res.status }); return data;
    });
  }
  function render() {
    var focused = root.activeElement;
    var focusName = focused && focused.getAttribute('name');
    var caret = focused && focused.selectionStart;
    var previousBody = view.querySelector('.body');
    var wasAtBottom = !previousBody || previousBody.scrollHeight - previousBody.scrollTop - previousBody.clientHeight < 70;
    var previousScroll = previousBody && previousBody.scrollTop;
    var theme = state.config?.theme || {};
    var side = theme.position === 'left' ? 'left' : 'right';
    var accent = theme.accentColor || '#15803d', panel = theme.panelColor || '#173e2b';
    var launcher = theme.launcherColor || accent;
    view.innerHTML = '<button class="launcher" aria-label="' + (state.open ? 'Close support' : 'Open support') + '" aria-expanded="' + state.open + '" aria-controls="support-panel" style="' + side + ':16px;background:' + launcher + ';color:' + foreground(launcher) + '">Chat with us</button>' +
      '<section id="support-panel" class="panel" aria-label="Customer support" ' + (state.open ? '' : 'hidden') + ' style="' + side + ':14px">' +
      '<header class="head" style="background:' + panel + ';color:' + foreground(panel) + '"><div><strong>' + escape(theme.brandName || 'Support') + '</strong><small>' + escape(theme.replyTime || 'We will be with you soon') + '</small></div><button type="button" class="close" aria-label="Close support panel">×</button></header>' +
      '<p class="connection" role="status">' + (state.offline ? 'Reconnecting — your draft is kept here.' : 'Messages update automatically') + '</p>' +
      '<div class="body" role="log" aria-label="Support messages" aria-live="polite" aria-relevant="additions">' + (state.messages.length ? state.messages.map(function (m) {
        var images = (m.attachments || []).filter(function (a) { return /^data:image\/(png|jpeg|gif|webp);base64,/i.test(a.dataUrl); }).map(function (a) { return '<img src="' + escape(a.dataUrl) + '" alt="' + escape(a.name || 'Support attachment') + '" loading="lazy">'; }).join('');
        return '<div class="message ' + (m.sender_type === 'user' ? 'user' : 'agent') + '" ' + (m.sender_type === 'user' ? 'style="background:' + accent + ';color:' + foreground(accent) + '"' : '') + '>' + escape(m.body) + images + '<small>' + (m.sender_type === 'user' ? 'You' : escape(m.sender_name || 'Support')) + '</small></div>';
      }).join('') : '<div class="message">' + escape(theme.greeting || 'Hi, how can we help?') + '</div>') + '</div>' +
      '<form class="form">' + (!state.conversationId ? '<input name="customerId" aria-label="Your name or customer ID" required maxlength="120" placeholder="Your name or customer ID" value="' + escape(state.customerId) + '"><input name="email" aria-label="Email (optional)" type="email" maxlength="160" placeholder="Email (optional)" value="' + escape(state.email) + '">' : '') +
      '<textarea name="message" aria-label="Message" maxlength="10000" placeholder="Write your message…">' + escape(state.draft) + '</textarea>' +
      '<div class="files">' + state.attachments.map(function (a,i) { return '<button type="button" data-remove="' + i + '" aria-label="Remove ' + escape(a.name) + '">' + escape(a.name) + ' ×</button>'; }).join('') + '</div>' +
      '<div class="tools"><label class="attach">Add image<input type="file" name="image" aria-label="Add image" accept="image/png,image/jpeg,image/gif,image/webp" hidden multiple></label>' + (state.expired ? '<button type="button" class="reset">Start a new conversation</button>' : '') + '</div>' +
      (state.error ? '<p class="error" role="alert">' + escape(state.error) + '</p>' : '') + (!state.config ? '<button type="button" class="retry">Retry connection</button>' : '') +
      '<button class="send" ' + (state.sending || !state.config || state.expired ? 'disabled' : '') + ' style="background:' + accent + ';color:' + foreground(accent) + '">' + (state.sending ? 'Sending…' : 'Send message') + '</button></form></section>';
    view.querySelector('.launcher').onclick = function () { state.open = !state.open; render(); if (state.open) { view.querySelector('textarea').focus(); sync(); } };
    view.querySelector('.close').onclick = function () { state.open = false; render(); view.querySelector('.launcher').focus(); };
    view.querySelector('.form').onsubmit = submit;
    view.querySelector('textarea').oninput = function (e) { state.draft = e.target.value; };
    ['customerId','email'].forEach(function (name) { var el = view.querySelector('[name="' + name + '"]'); if (el) el.oninput = function (e) { state[name] = e.target.value; }; });
    view.querySelector('[name="image"]').onchange = addImages;
    view.querySelectorAll('[data-remove]').forEach(function (button) { button.onclick = function () { state.attachments.splice(Number(button.dataset.remove),1); render(); }; });
    var retry = view.querySelector('.retry'); if (retry) retry.onclick = configure;
    var reset = view.querySelector('.reset'); if (reset) reset.onclick = function () { state.conversationId = ''; state.messages = []; state.expired = false; state.error = ''; state.version++; remember(''); render(); };
    if (focusName && state.open) { var input = view.querySelector('[name="' + focusName + '"]'); if (input) { input.focus({ preventScroll:true }); if (typeof caret === 'number' && input.setSelectionRange && input.type !== 'email') input.setSelectionRange(caret,caret); } }
    var body = view.querySelector('.body'); body.scrollTop = wasAtBottom ? body.scrollHeight : previousScroll;
  }
  async function addImages(e) {
    var files = Array.from(e.target.files || []);
    if (files.length + state.attachments.length > 4) { state.error = 'Add up to four images per message.'; render(); return; }
    if (files.some(function (f) { return !['image/png','image/jpeg','image/gif','image/webp'].includes(f.type) || f.size > 2000000; })) { state.error = 'Choose PNG, JPEG, GIF or WebP images under 2 MB.'; render(); return; }
    var images = await Promise.all(files.map(function (file) { return new Promise(function (resolve) { var reader = new FileReader(); reader.onload = function () { resolve({ name:file.name, type:file.type, dataUrl:reader.result }); }; reader.onerror = function () { resolve(null); }; reader.readAsDataURL(file); }); }));
    state.attachments = state.attachments.concat(images.filter(Boolean)).slice(0,4); state.error = images.includes(null) ? 'One image could not be read. Please add it again.' : ''; render();
  }
  async function submit(e) {
    e.preventDefault();
    if (state.sending || (!state.draft.trim() && !state.attachments.length) || !state.config || state.expired) return;
    var draft = state.draft, attachments = state.attachments.slice();
    var signature = JSON.stringify([state.conversationId, draft, attachments, state.customerId, state.email]);
    if (!state.pendingRequest || state.pendingRequest.signature !== signature) state.pendingRequest = { signature: signature, id: crypto.randomUUID() };
    var requestId = state.pendingRequest.id;
    state.sending = true; state.error = ''; state.version++; render();
    try {
      var existing = Boolean(state.conversationId);
      var data = await api(existing ? '/api/conversations/' + state.conversationId + '/messages' : '/api/conversations', { method:'POST', body:JSON.stringify(existing ? { senderType:'user', body:draft, attachments:attachments, clientRequestId:requestId } : { clientRequestId:requestId, xUsername:state.customerId, email:state.email, firstMessage:draft, attachments:attachments, pageUrl:location.href }) });
      if (!existing) { state.conversationId = data.id; state.messages = data.messages || []; remember(data.id); }
      else if (!state.messages.some(function (m) { return m.id === data.id; })) state.messages.push(data);
      state.pendingRequest = null;
      if (state.draft === draft) state.draft = '';
      state.attachments = state.attachments.filter(function (a) { return !attachments.includes(a); });
      state.offline = false;
    } catch (error) {
      state.error = error.error || 'Your message was not confirmed. Your draft is kept here; check the thread before retrying.';
      state.offline = !error.status;
      if (error.status === 404) state.expired = true;
    } finally { state.sending = false; state.version++; render(); }
  }
  async function sync() {
    if (syncing || !state.open || !state.config || !state.conversationId || state.sending || state.expired) return;
    syncing = true; var version = state.version, id = state.conversationId;
    try {
      var conversation = await api('/api/conversations/' + id);
      if (version !== state.version || id !== state.conversationId) return;
      var changed = JSON.stringify(conversation.messages) !== JSON.stringify(state.messages) || state.offline;
      state.messages = conversation.messages || []; state.offline = false;
      if (changed) render();
    } catch (error) {
      if (version !== state.version || id !== state.conversationId) return;
      if (error.status === 404) { state.expired = true; state.error = 'This conversation is no longer available. You can start a new one.'; render(); }
      else if (!state.offline) { state.offline = true; render(); }
    } finally { syncing = false; }
  }
  async function configure() {
    try { state.config = await api('/api/widget/config'); state.error = ''; state.offline = false; }
    catch (error) { state.error = error.error || 'Support is temporarily unavailable. Please retry.'; state.offline = true; }
    render(); sync();
  }
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) { state.open = false; render(); view.querySelector('.launcher').focus(); } });
  window.addEventListener('online', function () { if (!state.config) configure(); else sync(); });
  window.addEventListener('focus', sync);
  setInterval(function () { if (!document.hidden) sync(); }, 3000);
  render(); configure();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}());
