import { createAppField, createAppSelect } from './components.js';
import { normalizeSearchText } from './search-normalize.js';

export function createAppSearchSelect({ id, label, searchLabel = 'Buscar', placeholder = '', required = false } = {}) {
  const { wrapper: selectWrapper, select } = createAppSelect({ id, label, required });
  const wrapper = document.createElement('app-search-select');
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'app-search-select__trigger';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.innerHTML = '<span></span><span aria-hidden="true">⌄</span>';
  const search = document.createElement('input');
  search.id = `${id}-search`;
  search.type = 'search';
  search.autocomplete = 'off';
  search.maxLength = 120;
  search.placeholder = placeholder;
  const list = document.createElement('div');
  list.className = 'app-search-select__options';
  list.id = `${id}-options`;
  list.setAttribute('role', 'listbox');
  const popup = document.createElement('div');
  popup.className = 'app-search-select__popup';
  popup.hidden = true;
  popup.append(createAppField(searchLabel, search), list);
  trigger.setAttribute('aria-controls', popup.id = `${id}-picker`);
  wrapper.append(selectWrapper, trigger, popup);

  const display = trigger.firstElementChild;
  const refresh = () => {
    const query = normalizeSearchText(search.value.trim());
    const selected = select.selectedOptions[0];
    display.textContent = selected?.value ? selected.text : 'Elige una tienda guardada';
    trigger.classList.toggle('is-placeholder', !selected?.value);
    list.replaceChildren();
    for (const option of select.options) {
      if (!option.value || (query && !normalizeSearchText(option.text).includes(query))) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'app-search-select__option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.textContent = option.text;
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        popup.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      });
      list.append(item);
    }
  };
  const open = () => {
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    refresh();
    search.focus();
  };
  trigger.addEventListener('click', () => (popup.hidden ? open() : (popup.hidden = true, trigger.setAttribute('aria-expanded', 'false'))));
  search.addEventListener('input', () => {
    refresh();
    wrapper.dispatchEvent(new CustomEvent('app-search-select-search', { detail: { query: search.value.trim() } }));
  });
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) {
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true });
  refresh();
  return { wrapper, search, select, refresh, open };
}
