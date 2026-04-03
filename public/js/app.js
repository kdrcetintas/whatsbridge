// ── i18n ──────────────────────────────────────────────────────────────────────
initI18n().then(function () { updateDynamicText(); });
document.addEventListener('i18n:updated', updateDynamicText);

function updateDynamicText() {
  const labels = {
    waiting:   'header.status.waiting',
    connected: 'header.status.connected',
    qr:        'header.status.qr',
  };
  if (currentState && labels[currentState]) {
    document.getElementById('status-label').textContent = t(labels[currentState]);
  }
  document.getElementById('log-count').textContent = t('logs.count', { count: logCount });
  ['btn-send-text', 'btn-send-img'].forEach(function (id) {
    const btn = document.getElementById(id);
    if (!btn.disabled) btn.textContent = t('send.button');
  });
  document.getElementById('send-warn').textContent = t('send.warning');
  renderDocs();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'logs' && !sseStarted) startSSE();
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async function () {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ── Settings ──────────────────────────────────────────────────────────────────
var apiKey  = '';
var baseUrl = window.location.origin;

async function loadSettings() {
  try {
    const res  = await fetch('/settings');
    const data = await res.json();
    document.getElementById('instance-name').textContent    = data.instanceName;
    document.getElementById('api-key-value').textContent    = data.apiKey;
    apiKey = data.apiKey;
    renderDocs();
  } catch { /* ignore */ }
}

// ── Status polling ────────────────────────────────────────────────────────────
var currentState = '';

function showState(name) {
  if (currentState === name) return;
  currentState = name;
  ['waiting', 'qr', 'connected'].forEach(function (s) {
    document.getElementById('state-' + s).style.display = s === name ? '' : 'none';
  });
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (name === 'connected') {
    dot.className    = 'status-dot connected';
    label.textContent = t('header.status.connected');
    fetchAccount();
  } else if (name === 'qr') {
    dot.className    = 'status-dot connecting';
    label.textContent = t('header.status.qr');
    document.getElementById('account-card').style.display = 'none';
  } else {
    dot.className    = 'status-dot';
    label.textContent = t('header.status.waiting');
    document.getElementById('account-card').style.display = 'none';
  }
  document.getElementById('send-warn').classList.toggle('show', name !== 'connected');
}

async function pollStatus() {
  try {
    const res  = await fetch('/status');
    const data = await res.json();
    if (data.status === 'connected') {
      showState('connected');
    } else if (data.hasQR) {
      showState('qr');
      const qrRes = await fetch('/qr');
      if (qrRes.ok) {
        const qrData = await qrRes.json();
        document.getElementById('qr-img').src = qrData.qr;
      }
    } else {
      showState('waiting');
    }
  } catch { /* ignore */ }
}

pollStatus();
setInterval(pollStatus, 2500);

// ── Stats polling ─────────────────────────────────────────────────────────────
async function pollStats() {
  try {
    const res  = await fetch('/stats');
    const data = await res.json();
    document.getElementById('stat-sent').textContent     = data.sent     ?? 0;
    document.getElementById('stat-received').textContent = data.received ?? 0;
    document.getElementById('stat-queued').textContent   = data.queued   ?? 0;
    document.getElementById('stat-failed').textContent   = data.failed   ?? 0;
  } catch { /* ignore */ }
}

pollStats();
setInterval(pollStats, 5000);

// ── Account info ──────────────────────────────────────────────────────────────
async function fetchAccount() {
  try {
    const res  = await fetch('/account');
    const data = await res.json();
    if (!data) return;
    const card = document.getElementById('account-card');
    const pic  = document.getElementById('account-pic');
    const init = document.getElementById('account-initials');
    document.getElementById('account-name').textContent  = data.name || data.phone;
    document.getElementById('account-phone').textContent = '+' + data.phone;
    if (data.profilePicUrl) {
      pic.src            = data.profilePicUrl;
      pic.style.display  = 'block';
      init.style.display = 'none';
    } else {
      pic.style.display  = 'none';
      init.style.display = 'flex';
      init.textContent   = (data.name || data.phone).charAt(0).toUpperCase();
    }
    card.style.display = 'flex';
  } catch { /* ignore */ }
}

// ── SSE Logs ──────────────────────────────────────────────────────────────────
var sseStarted = false;
var autoScroll = true;
var logCount   = 0;
const container = document.getElementById('log-container');

document.getElementById('btn-autoscroll').addEventListener('click', function () {
  autoScroll = !autoScroll;
  this.classList.toggle('active', autoScroll);
});

document.getElementById('btn-clear').addEventListener('click', function () {
  container.innerHTML = '';
  logCount = 0;
  document.getElementById('log-count').textContent = t('logs.count', { count: 0 });
});

function appendLog(entry) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML =
    '<span class="log-time">' + entry.time + '</span>' +
    '<span class="log-type ' + entry.type + '">' + entry.type + '</span>' +
    '<span class="log-msg">'  + escHtml(entry.msg) + '</span>';
  container.appendChild(line);
  logCount++;
  document.getElementById('log-count').textContent = t('logs.count', { count: logCount });
  if (autoScroll) container.scrollTop = container.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startSSE() {
  if (sseStarted) return;
  sseStarted = true;
  const es = new EventSource('/logs/stream');
  es.onmessage = function (e) { appendLog(JSON.parse(e.data)); };
}

// ── API Docs ──────────────────────────────────────────────────────────────────
function renderDocs() {
  const k = apiKey || 'YOUR_API_KEY';
  const b = baseUrl;
  const codes = {
    'status-curl':   'curl "' + b + '/api/status?api_key=' + k + '"',
    'status-js':     "const res = await fetch('" + b + "/api/status?api_key=" + k + "');\nconst data = await res.json();\nconsole.log(data); // { status: 'connected', hasQR: false }",
    'status-python': "import requests\n\nr = requests.get('" + b + "/api/status', params={'api_key': '" + k + "'})\nprint(r.json())",

    'send-curl':   'curl -X POST \\\n  "' + b + '/api/send?api_key=' + k + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"phone":"905xxxxxxxxx","message":"Hello!"}\'',
    'send-js':     "const res = await fetch('" + b + "/api/send?api_key=" + k + "', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    phone: '905xxxxxxxxx',\n    message: 'Hello!'\n  })\n});\nconst data = await res.json();\nconsole.log(data); // { success: true, id: '...' }",
    'send-python': "import requests\n\nr = requests.post(\n  '" + b + "/api/send',\n  params={'api_key': '" + k + "'},\n  json={'phone': '905xxxxxxxxx', 'message': 'Hello!'}\n)\nprint(r.json())",

    'img-curl':   'curl -X POST \\\n  "' + b + '/api/send-image?api_key=' + k + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"phone":"905xxxxxxxxx","imageUrl":"https://example.com/photo.jpg","caption":"Caption"}\'',
    'img-js':     "const res = await fetch('" + b + "/api/send-image?api_key=" + k + "', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    phone: '905xxxxxxxxx',\n    imageUrl: 'https://example.com/photo.jpg',\n    caption: 'Caption'\n  })\n});\nconst data = await res.json();",
    'img-python': "import requests\n\nr = requests.post(\n  '" + b + "/api/send-image',\n  params={'api_key': '" + k + "'},\n  json={\n    'phone': '905xxxxxxxxx',\n    'imageUrl': 'https://example.com/photo.jpg',\n    'caption': 'Caption'\n  }\n)\nprint(r.json())",
  };
  Object.entries(codes).forEach(function ([key, val]) {
    const el = document.getElementById('code-' + key);
    if (el) el.textContent = val;
  });
}

document.querySelectorAll('.lang-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    const group = tab.dataset.group;
    const lang  = tab.dataset.lang;
    document.querySelectorAll('.lang-tab[data-group="' + group + '"]').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    document.querySelectorAll('[id^="' + group + '-"]').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById(group + '-' + lang).classList.add('active');
  });
});

document.getElementById('btn-copy-key').addEventListener('click', function () {
  const btn = this;
  navigator.clipboard.writeText(apiKey).then(function () {
    btn.textContent = t('docs.copied');
    btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = t('docs.copy');
      btn.classList.remove('copied');
    }, 2000);
  });
});

// ── Send forms ────────────────────────────────────────────────────────────────
function setResult(id, ok, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className   = 'send-result ' + (ok ? 'ok' : 'error');
}

document.getElementById('btn-send-text').addEventListener('click', async function () {
  const phone   = document.getElementById('text-phone').value.trim();
  const message = document.getElementById('text-message').value.trim();
  if (!phone || !message) { setResult('result-text', false, t('send.error.fields.text')); return; }
  this.disabled    = true;
  this.textContent = t('send.sending');
  try {
    const res  = await fetch('/api/send?api_key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json();
    if (data.success) setResult('result-text', true,  t('send.success', { messageId: data.id }));
    else              setResult('result-text', false, data.error || t('send.error.server'));
  } catch { setResult('result-text', false, t('send.error.server')); }
  finally   { this.disabled = false; this.textContent = t('send.button'); }
});

document.getElementById('btn-send-img').addEventListener('click', async function () {
  const phone    = document.getElementById('img-phone').value.trim();
  const imageUrl = document.getElementById('img-url').value.trim();
  const caption  = document.getElementById('img-caption').value.trim();
  if (!phone || !imageUrl) { setResult('result-img', false, t('send.error.fields.image')); return; }
  this.disabled    = true;
  this.textContent = t('send.sending');
  try {
    const res  = await fetch('/api/send-image?api_key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, imageUrl, caption }),
    });
    const data = await res.json();
    if (data.success) setResult('result-img', true,  t('send.success', { messageId: data.id }));
    else              setResult('result-img', false, data.error || t('send.error.server'));
  } catch { setResult('result-img', false, t('send.error.server')); }
  finally   { this.disabled = false; this.textContent = t('send.button'); }
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
