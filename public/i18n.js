/**
 * WhatsBridge — i18n utility
 * Usage:
 *   await initI18n()               — load saved or default locale
 *   t('key')                       — get translated string
 *   t('key', { count: 5 })         — with interpolation
 *   switchLang('tr')               — change language
 *   document.addEventListener('i18n:updated', fn)  — react to changes
 */
(function () {
  const SUPPORTED = ['en', 'tr'];
  const FALLBACK   = 'en';

  let locale   = localStorage.getItem('wb_locale') || FALLBACK;
  let messages = {};
  let fallback = {};   // English strings used when a key is missing in another locale

  // ── Public API ──────────────────────────────────────────────────────────────

  window.t = function (key, vars) {
    let str = messages[key] ?? fallback[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return str;
  };

  window.getCurrentLocale = function () { return locale; };

  window.switchLang = async function (lang) {
    if (!SUPPORTED.includes(lang) || lang === locale) return;
    await loadLocale(lang);
  };

  window.initI18n = async function () {
    // Always load English as fallback first
    try {
      const res = await fetch('/locales/en.json');
      fallback = await res.json();
    } catch { /* ignore */ }

    await loadLocale(locale);
  };

  // ── Internal ────────────────────────────────────────────────────────────────

  async function loadLocale(lang) {
    try {
      const res = await fetch('/locales/' + lang + '.json');
      if (!res.ok) throw new Error('Not found');
      messages = await res.json();
      locale   = lang;
      localStorage.setItem('wb_locale', lang);
    } catch {
      // Fallback to English if locale file is missing
      messages = fallback;
      locale   = FALLBACK;
      localStorage.setItem('wb_locale', FALLBACK);
    }
    applyTranslations();
  }

  function applyTranslations() {
    // data-i18n  → textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = window.t(el.dataset.i18n);
    });
    // data-i18n-html  → innerHTML (for strings containing <code> etc.)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = window.t(el.dataset.i18nHtml);
    });
    // data-i18n-ph  → placeholder attribute
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.placeholder = window.t(el.dataset.i18nPh);
    });
    // data-i18n-title  → title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = window.t(el.dataset.i18nTitle);
    });

    // Highlight active lang button
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.classList.toggle('wb-lang-active', btn.dataset.lang === locale);
    });

    document.dispatchEvent(new CustomEvent('i18n:updated'));
  }
})();
