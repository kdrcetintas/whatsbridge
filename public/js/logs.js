function onSettingsLoaded() { /* nothing extra */ }

var autoScroll = true;
var logCount   = 0;
var container  = document.getElementById('log-container');

document.getElementById('btn-autoscroll').addEventListener('click', function () {
  autoScroll = !autoScroll;
  this.classList.toggle('active', autoScroll);
});

document.getElementById('btn-clear').addEventListener('click', function () {
  container.innerHTML = '';
  logCount = 0;
  updateLogCount();
});

function updateLogCount() {
  document.getElementById('log-count').textContent = t('logs.count', { count: logCount });
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendLog(entry) {
  var line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML =
    '<span class="log-time">' + entry.time + '</span>' +
    '<span class="log-type ' + entry.type + '">' + entry.type + '</span>' +
    '<span class="log-msg">'  + escHtml(entry.msg) + '</span>';
  container.appendChild(line);
  logCount++;
  updateLogCount();
  if (autoScroll) container.scrollTop = container.scrollHeight;
}

// Start SSE immediately on page load
var es = new EventSource('/logs/stream');
es.onmessage = function (e) { appendLog(JSON.parse(e.data)); };

document.addEventListener('i18n:updated', updateLogCount);
