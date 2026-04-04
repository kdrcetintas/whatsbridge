// ── Stats ─────────────────────────────────────────────────────────────────────
async function pollStats() {
  try {
    var res  = await fetch('/stats');
    var data = await res.json();
    document.getElementById('stat-sent').textContent     = data.sent     ?? 0;
    document.getElementById('stat-received').textContent = data.received ?? 0;
    document.getElementById('stat-queued').textContent   = data.queued   ?? 0;
    document.getElementById('stat-failed').textContent   = data.failed   ?? 0;
  } catch { /* ignore */ }
}

pollStats();
setInterval(pollStats, 5000);

// ── Connection state ──────────────────────────────────────────────────────────
var currentState = '';

function showState(name) {
  if (currentState === name) return;
  currentState = name;
  ['waiting', 'qr', 'connected'].forEach(function (s) {
    document.getElementById('state-' + s).style.display = s === name ? '' : 'none';
  });
  if (name === 'connected') {
    fetchAccount();
  } else {
    document.getElementById('account-card').classList.add('d-none');
  }
}

async function pollStatus() {
  try {
    var res  = await fetch('/status');
    var data = await res.json();
    if (data.status === 'connected') {
      showState('connected');
    } else if (data.hasQR) {
      showState('qr');
      var qrRes = await fetch('/qr');
      if (qrRes.ok) {
        var qrData = await qrRes.json();
        document.getElementById('qr-img').src = qrData.qr;
      }
    } else {
      showState('waiting');
    }
  } catch { /* ignore */ }
}

pollStatus();
setInterval(pollStatus, 2500);

// ── Account info ──────────────────────────────────────────────────────────────
async function fetchAccount() {
  try {
    var res  = await fetch('/account');
    var data = await res.json();
    if (!data) return;
    document.getElementById('account-name').textContent  = data.name || data.phone;
    document.getElementById('account-phone').textContent = '+' + data.phone;
    var pic  = document.getElementById('account-pic');
    var init = document.getElementById('account-initials');
    if (data.profilePicUrl) {
      pic.src            = data.profilePicUrl;
      pic.style.display  = 'block';
      init.style.display = 'none';
    } else {
      pic.style.display  = 'none';
      init.style.display = 'flex';
      init.textContent   = (data.name || data.phone).charAt(0).toUpperCase();
    }
    var card = document.getElementById('account-card');
    card.classList.remove('d-none');
    card.style.display = 'flex';
  } catch { /* ignore */ }
}

// ── Update ────────────────────────────────────────────────────────────────────
function onSettingsLoaded() { /* settings loaded — nothing extra needed on this page */ }

function setUpdateResult(cls, msg) {
  var el = document.getElementById('update-result');
  el.textContent = msg;
  el.className   = 'w-100 small update-result ' + cls;
}

document.addEventListener('i18n:updated', function () {
  var el = document.getElementById('update-current-version');
  if (el && window._currentVersion) el.textContent = 'v' + window._currentVersion;
});

async function loadUpdateVersion() {
  try {
    var res  = await fetch('/version');
    var data = await res.json();
    window._currentVersion = data.version;
    document.getElementById('update-current-version').textContent = 'v' + data.version;
    if (!data.isPkg) {
      document.getElementById('btn-check-update').disabled = true;
      setUpdateResult('info', 'Self-update is only available in compiled binaries.');
    }
    if (data.hasGithubToken) {
      document.getElementById('github-token-input').placeholder = 'GitHub token (saved)';
    }
  } catch { /* ignore */ }
}
loadUpdateVersion();

function getGithubTokenHeader() {
  var val = document.getElementById('github-token-input').value.trim();
  return val ? { 'X-GitHub-Token': val } : {};
}

document.getElementById('btn-check-update').addEventListener('click', async function () {
  this.disabled    = true;
  this.textContent = 'Checking...';
  setUpdateResult('info', '');
  document.getElementById('update-badge').style.display = 'none';
  var existing = document.getElementById('btn-apply-update');
  if (existing) existing.remove();

  try {
    var res  = await fetch('/update/check', { headers: getGithubTokenHeader() });
    var data = await res.json();
    if (data.error) {
      setUpdateResult('error', data.error);
    } else if (data.hasUpdate) {
      setUpdateResult('ok', 'Update available: v' + data.latestVersion + ' (current: v' + data.currentVersion + ')');
      document.getElementById('update-badge').style.display = '';

      var applyBtn = document.createElement('button');
      applyBtn.id          = 'btn-apply-update';
      applyBtn.className   = 'btn btn-warning btn-sm';
      applyBtn.textContent = 'Update to v' + data.latestVersion;
      applyBtn.addEventListener('click', applyUpdate);
      document.getElementById('update-actions').appendChild(applyBtn);
    } else {
      setUpdateResult('info', 'You are up to date (v' + data.currentVersion + ').');
    }
  } catch {
    setUpdateResult('error', 'Could not check for updates.');
  }

  this.disabled    = false;
  this.textContent = t('update.check');
});

async function applyUpdate() {
  var btn      = document.getElementById('btn-apply-update');
  var checkBtn = document.getElementById('btn-check-update');
  btn.disabled = checkBtn.disabled = true;
  btn.textContent = 'Updating...';
  setUpdateResult('info', 'Downloading update, please wait...');

  try {
    var res  = await fetch('/update/apply', { method: 'POST', headers: getGithubTokenHeader() });
    var data = await res.json();
    if (data.success) {
      setUpdateResult('ok', 'Updated to v' + data.version + '. Service restarting — page will reload automatically.');
      document.getElementById('update-badge').style.display = 'none';
      btn.remove();
      setTimeout(pollUntilBack, 4000);
    } else {
      setUpdateResult('error', data.error || 'Update failed.');
      btn.disabled = checkBtn.disabled = false;
      btn.textContent = 'Retry Update';
    }
  } catch {
    setUpdateResult('error', 'Update failed or server restarted.');
    btn.disabled = checkBtn.disabled = false;
    btn.textContent = 'Retry Update';
  }
}

function pollUntilBack() {
  fetch('/version').then(function (r) {
    if (r.ok) {
      setUpdateResult('ok', 'Service is back online. Reloading...');
      setTimeout(function () { window.location.reload(); }, 1000);
    } else {
      setTimeout(pollUntilBack, 2000);
    }
  }).catch(function () { setTimeout(pollUntilBack, 2000); });
}
