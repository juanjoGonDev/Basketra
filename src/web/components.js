const componentDefinitions = [
  ['app-stack', class AppStack extends HTMLElement {}],
  ['app-inline', class AppInline extends HTMLElement {}],
  ['app-field', class AppField extends HTMLElement {}],
  ['app-select', class AppSelect extends HTMLElement {}],
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
