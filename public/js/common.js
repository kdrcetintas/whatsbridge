// ── i18n ──────────────────────────────────────────────────────────────────────
initI18n();
document.addEventListener('i18n:updated', function () {
  var label = document.getElementById('lang-label');
  if (label) label.textContent = (window.getCurrentLocale() || 'en').toUpperCase();
  pollNavStatus();
});

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async function () {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ── Settings ──────────────────────────────────────────────────────────────────
window.apiKey       = '';
window.baseUrl      = window.location.origin;
window._instanceName = '';
window._version      = '';

function updatePageTitle() {
  if (!window._instanceName && !window._version) return;
  var pageLabel = document.body.dataset.title || '';
  var parts = ['WhatsBridge'];
  if (window._instanceName) parts.push(window._instanceName);
  if (pageLabel)             parts.push(pageLabel);
  if (window._version)       parts.push('v' + window._version);
  document.title = parts.join(' — ');
}

async function loadSettings() {
  try {
    var res  = await fetch('/settings');
    var data = await res.json();
    var el = document.getElementById('instance-name');
    if (el) el.textContent = data.instanceName;
    window.apiKey        = data.apiKey;
    window._instanceName = data.instanceName;
    updatePageTitle();
    if (typeof onSettingsLoaded === 'function') onSettingsLoaded(data);
  } catch { /* ignore */ }
}

// ── Version ───────────────────────────────────────────────────────────────────
async function loadVersion() {
  try {
    var res  = await fetch('/version');
    var data = await res.json();
    var el = document.getElementById('header-version');
    if (el) el.textContent = 'v' + data.version + (data.isPkg ? '' : ' (dev)');
    window._isPkg    = data.isPkg;
    window._version  = data.version;
    updatePageTitle();
  } catch { /* ignore */ }
}

// ── Navbar status dot ─────────────────────────────────────────────────────────
async function pollNavStatus() {
  try {
    var res  = await fetch('/status');
    var data = await res.json();
    var dot   = document.getElementById('status-dot');
    var label = document.getElementById('status-label');
    if (!dot) return;
    if (data.status === 'connected') {
      dot.className    = 'wb-status-dot connected';
      if (label) label.textContent = t('header.status.connected');
    } else if (data.hasQR) {
      dot.className    = 'wb-status-dot connecting';
      if (label) label.textContent = t('header.status.qr');
    } else {
      dot.className    = 'wb-status-dot';
      if (label) label.textContent = t('header.status.waiting');
    }
  } catch { /* ignore */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
loadVersion();
pollNavStatus();
setInterval(pollNavStatus, 5000);
