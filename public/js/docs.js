function onSettingsLoaded(data) {
  document.getElementById('api-key-value').textContent = data.apiKey;
  renderDocs();
}

function renderDocs() {
  var k = window.apiKey || 'YOUR_API_KEY';
  var b = window.baseUrl;
  var codes = {
    'status-curl':   'curl "' + b + '/api/status?api_key=' + k + '"',
    'status-js':     "const res = await fetch('" + b + "/api/status?api_key=" + k + "');\nconst data = await res.json();\nconsole.log(data);",
    'status-python': "import requests\nr = requests.get('" + b + "/api/status', params={'api_key': '" + k + "'})\nprint(r.json())",

    'send-curl':   'curl -X POST \\\n  "' + b + '/api/send?api_key=' + k + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"phone":"905xxxxxxxxx","message":"Hello!"}\'',
    'send-js':     "const res = await fetch('" + b + "/api/send?api_key=" + k + "', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ phone: '905xxxxxxxxx', message: 'Hello!' })\n});\nconst data = await res.json();",
    'send-python': "import requests\nr = requests.post(\n  '" + b + "/api/send',\n  params={'api_key': '" + k + "'},\n  json={'phone': '905xxxxxxxxx', 'message': 'Hello!'}\n)\nprint(r.json())",

    'img-curl':   'curl -X POST \\\n  "' + b + '/api/send-image?api_key=' + k + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"phone":"905xxxxxxxxx","imageUrl":"https://example.com/photo.jpg","caption":"Caption"}\'',
    'img-js':     "const res = await fetch('" + b + "/api/send-image?api_key=" + k + "', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    phone: '905xxxxxxxxx',\n    imageUrl: 'https://example.com/photo.jpg',\n    caption: 'Caption'\n  })\n});\nconst data = await res.json();",
    'img-python': "import requests\nr = requests.post(\n  '" + b + "/api/send-image',\n  params={'api_key': '" + k + "'},\n  json={'phone': '905xxxxxxxxx', 'imageUrl': 'https://example.com/photo.jpg', 'caption': 'Caption'}\n)\nprint(r.json())",
  };
  Object.entries(codes).forEach(function ([key, val]) {
    var el = document.getElementById('code-' + key);
    if (el) el.textContent = val;
  });
}

document.getElementById('btn-copy-key').addEventListener('click', function () {
  var btn = this;
  navigator.clipboard.writeText(window.apiKey).then(function () {
    btn.textContent = t('docs.copied');
    btn.classList.add('btn-success');
    btn.classList.remove('btn-outline-secondary');
    setTimeout(function () {
      btn.textContent = t('docs.copy');
      btn.classList.remove('btn-success');
      btn.classList.add('btn-outline-secondary');
    }, 2000);
  });
});

// Code language tabs
document.querySelectorAll('.wb-lang-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    var group = tab.dataset.group;
    var lang  = tab.dataset.lang;
    document.querySelectorAll('.wb-lang-tab[data-group="' + group + '"]').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    document.querySelectorAll('[id^="' + group + '-"]').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById(group + '-' + lang).classList.add('active');
  });
});
