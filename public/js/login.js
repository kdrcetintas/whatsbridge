initI18n();

const form    = document.getElementById('form');
const btn     = document.getElementById('btn');
const errorEl = document.getElementById('error');

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  btn.disabled    = true;
  btn.textContent = t('login.submitting');
  errorEl.classList.add('d-none');

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      errorEl.textContent = t('login.error.invalid');
      errorEl.classList.remove('d-none');
      btn.disabled    = false;
      btn.textContent = t('login.submit');
    }
  } catch {
    errorEl.textContent = t('login.error.server');
    errorEl.classList.remove('d-none');
    btn.disabled    = false;
    btn.textContent = t('login.submit');
  }
});

document.addEventListener('i18n:updated', function () {
  if (!btn.disabled) btn.textContent = t('login.submit');
  var langLabel = document.getElementById('lang-label');
  if (langLabel) langLabel.textContent = (window.getCurrentLocale() || 'en').toUpperCase();
});
