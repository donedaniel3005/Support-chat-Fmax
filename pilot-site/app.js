(function () {
  'use strict';
  var config = window.PILOT_CONFIG;
  if (!config) return;
  ['inbox-link','test-inbox-link'].forEach(function (id) { var link = document.getElementById(id); link.href = config.inboxUrl; link.target = '_blank'; link.rel = 'noopener'; });
  var script = document.createElement('script'); script.src = config.apiOrigin + '/widget.js'; script.dataset.key = config.widgetKey; document.body.appendChild(script);
  function openChat() {
    var host = document.getElementById('support-chat-platform-widget');
    var button = host?.shadowRoot?.querySelector('[aria-controls="support-panel"]');
    if (button) { if (button.getAttribute('aria-expanded') !== 'true') button.click(); else host.shadowRoot.querySelector('textarea')?.focus(); }
    else { document.getElementById('connection-text').textContent = 'Support is still connecting. Please try again shortly.'; }
  }
  document.querySelectorAll('[data-chat]').forEach(function (button) { button.onclick = openChat; });
  var steps = [
    ['First message', 'Open chat, enter a sample name and send a question. Confirm one new conversation appears in the staff inbox.'],
    ['Reply without refreshing', 'Reply from the inbox. Keep this page open and confirm the reply appears automatically, then send a second customer message.'],
    ['Notification sound', 'In the inbox, click Enable & test sound. Switch to this tab and send a new message; confirm the sound plays. Browser permission is separate.'],
    ['Draft and refresh recovery', 'Type an unsent draft while an agent replies: the draft should stay. Send it, refresh this page and confirm the conversation returns when browser storage is available.'],
    ['Images and saved replies', 'Send a sample PNG/JPEG. Confirm it appears on both sides. In the inbox, type / and insert a saved reply, then review and send it.'],
    ['Ticket workflow', 'Move a ticket to Pending, then Closed. Send a new customer message and confirm it reopens. Search by sample customer name or message text.'],
    ['Team and themes', 'Add a test teammate in Settings. Try Light, Dark and System appearance. Change widget branding, save, then refresh this site to check the result.'],
    ['Optional integrations', 'Review AI setup without adding a key unless you want provider usage. Add a public HTTPS webhook receiver and inspect event signatures and delivery status. Mail and payment tests require their providers.']
  ];
  var storageKey = 'support-pilot-checklist-v1', progress = [];
  try { progress = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (!Array.isArray(progress)) progress = []; } catch { progress = []; }
  function updateProgress() {
    var count = progress.filter(Boolean).length;
    document.getElementById('progress-count').textContent = count + ' of ' + steps.length + ' checked';
    document.getElementById('progress-bar').style.width = count / steps.length * 100 + '%';
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch {}
  }
  var checklist = document.getElementById('checklist');
  steps.forEach(function (step, index) {
    var label = document.createElement('label'); label.className = 'test-step';
    var input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(progress[index]);
    input.onchange = function () { progress[index] = input.checked; updateProgress(); };
    var copy = document.createElement('span'), title = document.createElement('strong'), body = document.createElement('small');
    title.textContent = String(index + 1).padStart(2,'0') + ' / ' + step[0]; body.textContent = step[1];
    copy.append(title,body); label.append(input,copy); checklist.appendChild(label);
  });
  document.getElementById('reset-progress').onclick = function () { progress = []; checklist.querySelectorAll('input').forEach(function (input) { input.checked = false; }); updateProgress(); };
  updateProgress();
  var dialog = document.getElementById('scenario-dialog');
  document.querySelectorAll('[data-question]').forEach(function (button) { button.onclick = function () { document.getElementById('scenario-text').textContent = button.dataset.question; document.getElementById('scenario-status').textContent = ''; dialog.showModal(); }; });
  document.getElementById('copy-scenario').onclick = async function () { try { await navigator.clipboard.writeText(document.getElementById('scenario-text').textContent); document.getElementById('scenario-status').textContent = 'Copied. Paste it into the support chat.'; } catch { document.getElementById('scenario-status').textContent = 'Select and copy the question above, then paste it into chat.'; } };
  document.getElementById('scenario-chat').onclick = function () { dialog.close(); openChat(); };
  async function checkConnection() {
    try {
      var response = await fetch(config.apiOrigin + '/api/widget/config', { headers:{ 'X-Widget-Key':config.widgetKey }, signal:AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('unavailable');
      document.getElementById('connection-text').textContent = 'Connected to your isolated pilot workspace';
      document.querySelector('.connection').dataset.ready = 'true';
    } catch { document.getElementById('connection-text').textContent = 'Pilot support is offline. Keep npm run pilot running.'; document.querySelector('.connection').dataset.ready = 'false'; }
  }
  checkConnection(); window.addEventListener('online', checkConnection);
}());
