const componentDefinitions = [
  ['app-stack', class AppStack extends HTMLElement {}],
  ['app-inline', class AppInline extends HTMLElement {}],
  ['app-field', class AppField extends HTMLElement {}],
  ['app-select', class AppSelect extends HTMLElement {}],
  ['app-search-select', class AppSearchSelect extends HTMLElement {}],
  ['app-button', class AppButton extends HTMLElement {}],
];

class AppDialog extends HTMLElement {
  #dialog;
  #header;
  #footer;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
        <dialog part="native-dialog"><section part="surface"><header part="header"><slot name="header"></slot></header><div part="body"><slot name="body"></slot><slot></slot></div><footer part="footer"><slot name="footer"></slot></footer></section></dialog>`;
    this.#dialog = root.querySelector('dialog');
    this.#header = root.querySelector('header');
    this.#footer = root.querySelector('footer');
    root.querySelectorAll('slot[name="header"], slot[name="footer"]').forEach(slot => {
      slot.addEventListener('slotchange', () => this.#syncRegions());
    });
    this.#dialog.addEventListener('click', event => {
      if (event.target === this.#dialog && this.dismissible) this.close();
    });
    this.#dialog.addEventListener('close', () => this.dispatchEvent(new Event('close')));
    this.#dialog.addEventListener('cancel', event => {
      const hostEvent = new Event('cancel', { bubbles: true, cancelable: true });
      if (!this.dispatchEvent(hostEvent)) event.preventDefault();
    });
  }

  connectedCallback() {
    const label = this.getAttribute('aria-label');
    const labelledBy = this.getAttribute('aria-labelledby');
    if (label) this.#dialog.setAttribute('aria-label', label);
    if (labelledBy) this.#dialog.setAttribute('aria-labelledby', labelledBy);
    this.#syncRegions();
  }

  #syncRegions() {
    this.#header.hidden = !this.#header.querySelector('slot').assignedNodes({ flatten: true }).length;
    this.#footer.hidden = !this.#footer.querySelector('slot').assignedNodes({ flatten: true }).length;
  }

  get dismissible() { return this.getAttribute('dismissible') !== 'false'; }
  get open() { return this.#dialog.open; }
  showModal() { if (!this.#dialog.open) this.#dialog.showModal(); }
  close(value) { if (this.#dialog.open) this.#dialog.close(value); }
  focus() { this.#dialog.querySelector('[autofocus], input, select, button')?.focus(); }
}

customElements.define('app-dialog', AppDialog);
for (const [name, definition] of componentDefinitions) customElements.define(name, definition);

export function createAppDialog({ id, label }) {
  const dialog = document.createElement('app-dialog');
  dialog.id = id;
  dialog.setAttribute('aria-label', label);
  return dialog;
}

/**
 * Builds the chrome shared by every application dialog. Feature modules may
 * supply their title and content, but the header spacing and dismissal affordance
 * deliberately stay in one place.
 */
export function createAppDialogHeader({ title, titleId = '', eyebrow = '', className = '' } = {}) {
  const header = document.createElement('div');
  header.className = ['app-dialog-header', className].filter(Boolean).join(' ');
  const copy = document.createElement('div');
  copy.className = 'app-dialog-header__copy';
  if (eyebrow) {
    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = eyebrow;
    copy.append(label);
  }
  const heading = document.createElement('h2');
  if (titleId) heading.id = titleId;
  heading.textContent = title || '';
  copy.append(heading);

  const { component: closeComponent, button: close } = createAppButton({ label: '', variant: 'icon' });
  closeComponent.classList.add('app-dialog-close');
  close.className = 'icon-button app-dialog-close__button';
  close.dataset.componentDialogClose = 'true';
  close.setAttribute('aria-label', 'Cerrar');
  close.setAttribute('title', 'Cerrar');
  close.textContent = '×';
  header.append(copy, closeComponent);
  return { header, close, closeComponent };
}

export function createAppDialogDescription({ id = '', text = '' } = {}) {
  const description = document.createElement('p');
  if (id) description.id = id;
  description.className = 'app-dialog-description';
  description.textContent = text;
  return description;
}

export function createAppField(label, control) {
  const field = document.createElement('app-field');
  const caption = document.createElement('span');
  caption.textContent = label;
  field.append(caption, control);
  return field;
}

export function createAppSelect({ id, label, required = false } = {}) {
  const select = document.createElement('select');
  if (id) select.id = id;
  select.required = required;
  const field = createAppField(label, select);
  const wrapper = document.createElement('app-select');
  wrapper.append(field);
  return { wrapper, select };
}

/**
 * A compact, reusable search + native-select control. Features own the data
 * source while this primitive owns the consistent field structure.
 */
export function createAppButton({ label, variant = 'secondary', type = 'button', icon = '' } = {}) {
  const component = document.createElement('app-button');
  component.dataset.variant = variant;
  const button = document.createElement('button');
  button.type = type;
  button.className = `button ${variant}`;
  button.innerHTML = `${icon}<span>${label}</span>`;
  component.append(button);
  return { component, button };
}

document.addEventListener('click', event => {
  const close = event.target.closest?.('[data-component-dialog-close]');
  if (close) close.closest('app-dialog')?.close();
  const trigger = event.target.closest?.('[data-component-dialog-trigger]');
  if (!trigger) return;
  document.querySelector('#components-demo-dialog')?.showModal();
  document.querySelector('#components-demo-dialog')?.focus();
});
