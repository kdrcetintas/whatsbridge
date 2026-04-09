var PAGE_SIZE = 50;
var currentOffset = 0;
var currentFilter = '';
var currentPhone  = '';
var totalCount    = 0;
var refreshTimer  = null;

function onSettingsLoaded() { /* nothing extra needed */ }

// ── Status badge ──────────────────────────────────────────────────────────────

var STATUS_BADGE = {
  queued:  '<span class="badge bg-warning text-dark">Queued</span>',
  sending: '<span class="badge bg-info text-dark">Sending</span>',
  sent:    '<span class="badge bg-success">Sent</span>',
  failed:  '<span class="badge bg-danger">Failed</span>',
};

function directionIcon(direction) {
  return direction === 'inbound'
    ? '<span title="Received" style="color:#0d6efd;font-size:1rem">↓</span>'
    : '<span title="Sent"     style="color:#198754;font-size:1rem">↑</span>';
}

function fmtTime(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function msgText(msg) {
  if (msg.type === 'image') {
    var cap = msg.caption ? ' — ' + msg.caption : '';
    return '<span class="text-muted">[Image]</span>' + escHtml(cap);
  }
  return escHtml((msg.body || '').substring(0, 120) + ((msg.body || '').length > 120 ? '…' : ''));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Load messages ─────────────────────────────────────────────────────────────

async function loadMessages() {
  var params = '?limit=' + PAGE_SIZE + '&offset=' + currentOffset;
  if (currentFilter === 'inbound') {
    // inbound is direction-based, not status-based — handled client-side via all + filter
  } else if (currentFilter) {
    params += '&status=' + currentFilter;
  }
  if (currentPhone) params += '&phone=' + encodeURIComponent(currentPhone);

  try {
    var res  = await fetch('/api/messages' + params);
    var data = await res.json();

    var messages = data.messages || [];
    totalCount   = data.total   || 0;

    // Client-side inbound filter (API supports status, not direction)
    if (currentFilter === 'inbound') {
      messages   = messages.filter(function (m) { return m.direction === 'inbound'; });
      totalCount = messages.length; // approximate
    }

    renderTable(messages);
    renderPagination();
  } catch {
    document.getElementById('msg-tbody').innerHTML =
      '<tr><td colspan="5" class="text-center text-muted py-4">Failed to load messages.</td></tr>';
  }
}

function renderTable(messages) {
  var tbody = document.getElementById('msg-tbody');
  if (messages.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No messages found.</td></tr>';
    return;
  }
  tbody.innerHTML = messages.map(function (m) {
    var badge = m.direction === 'inbound'
      ? '<span class="badge bg-primary">Received</span>'
      : (STATUS_BADGE[m.status] || '<span class="badge bg-secondary">' + m.status + '</span>');
    var errorLine = (m.status === 'failed' && m.error)
      ? '<div class="text-danger" style="font-size:0.75rem;margin-top:3px">' + escHtml(m.error) + '</div>'
      : '';
    return '<tr>' +
      '<td class="ps-3">' + directionIcon(m.direction) + '</td>' +
      '<td class="font-monospace">' + escHtml(m.phone) + '</td>' +
      '<td class="text-truncate" style="max-width:320px">' + msgText(m) + '</td>' +
      '<td>' + badge + errorLine + '</td>' +
      '<td class="text-muted text-nowrap">' + fmtTime(m.createdAt) + '</td>' +
      '</tr>';
  }).join('');
}

function renderPagination() {
  var start = totalCount === 0 ? 0 : currentOffset + 1;
  var end   = Math.min(currentOffset + PAGE_SIZE, totalCount);
  document.getElementById('msg-count').textContent = totalCount + ' total — showing ' + start + '–' + end;
  document.getElementById('btn-prev').disabled = currentOffset === 0;
  document.getElementById('btn-next').disabled = currentOffset + PAGE_SIZE >= totalCount;
}

// ── Auto-refresh when there are queued messages ───────────────────────────────

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  // Refresh every 3s if viewing queued/all tab so queue drains in real time
  if (currentFilter === 'queued' || currentFilter === '') {
    refreshTimer = setTimeout(function () { loadMessages().then(scheduleRefresh); }, 3000);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

var FILTER_COLORS = { '': 'primary', queued: 'warning', sent: 'success', failed: 'danger', inbound: 'primary' };

document.getElementById('filter-btns').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-filter]');
  if (!btn) return;

  document.querySelectorAll('#filter-btns button').forEach(function (b) {
    var color = FILTER_COLORS[b.dataset.filter] || 'secondary';
    b.classList.remove('btn-' + color, 'active');
    b.classList.add('btn-outline-' + color);
  });

  var color = FILTER_COLORS[btn.dataset.filter] || 'secondary';
  btn.classList.remove('btn-outline-' + color);
  btn.classList.add('btn-' + color, 'active');

  currentFilter = btn.dataset.filter;
  currentOffset = 0;
  clearTimeout(refreshTimer);
  loadMessages().then(scheduleRefresh);
});

document.getElementById('btn-prev').addEventListener('click', function () {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadMessages().then(scheduleRefresh);
});

document.getElementById('btn-next').addEventListener('click', function () {
  currentOffset += PAGE_SIZE;
  loadMessages().then(scheduleRefresh);
});

document.getElementById('btn-refresh').addEventListener('click', function () {
  loadMessages().then(scheduleRefresh);
});

var phoneTimer;
document.getElementById('phone-filter').addEventListener('input', function () {
  clearTimeout(phoneTimer);
  phoneTimer = setTimeout(function () {
    currentPhone  = document.getElementById('phone-filter').value.trim();
    currentOffset = 0;
    loadMessages().then(scheduleRefresh);
  }, 400);
});

// Initial load
loadMessages().then(scheduleRefresh);
