// ── Connection warning ────────────────────────────────────────────────────────
async function checkConnection() {
  try {
    var res  = await fetch('/status');
    var data = await res.json();
    document.getElementById('send-warn').classList.toggle('d-none', data.status === 'connected');
  } catch { /* ignore */ }
}

checkConnection();
setInterval(checkConnection, 5000);

// ── Send helpers ──────────────────────────────────────────────────────────────
function onSettingsLoaded() { /* api key is set globally in common.js */ }

function setResult(id, ok, msg) {
  var el = document.getElementById(id);
  el.textContent = msg;
  el.className   = 'send-result mt-3 ' + (ok ? 'ok' : 'error');
}

// ── Text message ──────────────────────────────────────────────────────────────
document.getElementById('btn-send-text').addEventListener('click', async function () {
  var phone   = document.getElementById('text-phone').value.trim();
  var message = document.getElementById('text-message').value.trim();
  if (!phone || !message) { setResult('result-text', false, t('send.error.fields.text')); return; }
  this.disabled    = true;
  this.textContent = t('send.sending');
  try {
    var res  = await fetch('/api/send?api_key=' + encodeURIComponent(window.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
    });
    var data = await res.json();
    if (data.success) setResult('result-text', true,  t('send.success', { messageId: data.id }));
    else              setResult('result-text', false, data.error || t('send.error.server'));
  } catch { setResult('result-text', false, t('send.error.server')); }
  finally   { this.disabled = false; this.textContent = t('send.button'); }
});

// ── Image message ─────────────────────────────────────────────────────────────
document.getElementById('btn-send-img').addEventListener('click', async function () {
  var phone    = document.getElementById('img-phone').value.trim();
  var imageUrl = document.getElementById('img-url').value.trim();
  var caption  = document.getElementById('img-caption').value.trim();
  if (!phone || !imageUrl) { setResult('result-img', false, t('send.error.fields.image')); return; }
  this.disabled    = true;
  this.textContent = t('send.sending');
  try {
    var res  = await fetch('/api/send-image?api_key=' + encodeURIComponent(window.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, imageUrl, caption }),
    });
    var data = await res.json();
    if (data.success) setResult('result-img', true,  t('send.success', { messageId: data.id }));
    else              setResult('result-img', false, data.error || t('send.error.server'));
  } catch { setResult('result-img', false, t('send.error.server')); }
  finally   { this.disabled = false; this.textContent = t('send.button'); }
});

document.addEventListener('i18n:updated', function () {
  ['btn-send-text', 'btn-send-img'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (!btn.disabled) btn.textContent = t('send.button');
  });
});
