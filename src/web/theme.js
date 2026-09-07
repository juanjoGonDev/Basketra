(() => {
  const STORAGE_KEY = 'basketra.theme';
  const THEME_VALUES = new Set(['system', 'light', 'dark']);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let storageWritable = true;
  let preference = readPreference();

  function readPreference() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return THEME_VALUES.has(value) ? value : 'system';
    } catch {
      storageWritable = false;
      return 'system';
    }
  }

  function effectiveTheme(value = preference) {
    if (value === 'light' || value === 'dark') return value;
    return media.matches ? 'dark' : 'light';
  }

  function updateBrowserThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.content = effectiveTheme() === 'dark' ? '#151d19' : '#ffffff';
  }

  function applyPreference(value) {
    preference = THEME_VALUES.has(value) ? value : 'system';
    document.documentElement.dataset.theme = effectiveTheme(preference);
    updateBrowserThemeColor();
    updateControls();
  }

  function persistPreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
      storageWritable = true;
    } catch {
      storageWritable = false;
    }
    applyPreference(value);
  }

  function updateControls() {
    document.querySelectorAll('input[name="basketra-theme"]').forEach(input => {
      input.checked = input.value === preference;
    });
    const status = document.querySelector('#theme-preference-state');
    if (!status) return;
    status.textContent = storageWritable
      ? 'La preferencia se guarda en este dispositivo.'
      : 'El navegador no permite guardar la preferencia; se aplicará sólo durante esta sesión.';
  }

  function installControls() {
    if (document.querySelector('#theme-settings-card')) {
      updateControls();
      return true;
    }
    const generalPanel = document.querySelector('[data-tab-group="settings"] [data-tab-panel="general"]');
    if (!generalPanel) return false;

    const card = document.createElement('section');
    card.id = 'theme-settings-card';
    card.className = 'surface operations-card theme-settings-card';
    card.setAttribute('aria-labelledby', 'theme-settings-title');
    card.innerHTML = `
      <div class="panel-heading">
        <div><p class="eyebrow">Apariencia</p><h2 id="theme-settings-title">Tema</h2></div>
      </div>
      <fieldset class="theme-options">
        <legend>Elige cómo se muestra Basketra</legend>
        <label class="theme-option">
          <input type="radio" name="basketra-theme" value="system">
          <span><strong>Sistema</strong><small>Sigue el tema del dispositivo.</small></span>
        </label>
        <label class="theme-option">
          <input type="radio" name="basketra-theme" value="light">
          <span><strong>Claro</strong><small>Mantiene siempre el tema claro.</small></span>
        </label>
        <label class="theme-option">
          <input type="radio" name="basketra-theme" value="dark">
          <span><strong>Oscuro</strong><small>Mantiene siempre el tema oscuro.</small></span>
        </label>
      </fieldset>
      <p id="theme-preference-state" class="inline-status" role="status"></p>`;

    card.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.name !== 'basketra-theme') return;
      persistPreference(input.value);
    });
    generalPanel.prepend(card);
    updateControls();
    return true;
  }

  function installWhenReady() {
    if (installControls()) return;
    const observer = new MutationObserver(() => {
      if (installControls()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  media.addEventListener?.('change', () => {
    if (preference === 'system') applyPreference(preference);
  });

  applyPreference(preference);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();

void import('./shopping-list-density.js');
