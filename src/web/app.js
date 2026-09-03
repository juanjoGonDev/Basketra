import { api } from './api.js';
import { initLists } from './lists.js';
import { initReceipts } from './receipts.js';
import { primaryNavigationForView, resolveApplicationRoute } from './routes.js';
import {
  bindSwipeActions,
  hydrateIcons,
} from './ui.js';

const toastState = {
  timer: null,
  version: 0,
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let receiptEditorSession = null;
let applicationReady = false;
let pendingRoute = '';

function createTabGroup(name, label, tabs) {
  const root = document.createElement('section');
  root.className = 'task-tabs';
  root.dataset.tabGroup = name;

  const tablist = document.createElement('div');
  tablist.className = 'task-tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', label);

  const panels = new Map();
  for (const [index, definition] of tabs.entries()) {
    const tabId = `basketra-${name}-${definition.value}-tab`;
    const panelId = `basketra-${name}-${definition.value}-panel`;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = tabId;
    tab.className = 'task-tab';
    tab.dataset.tabValue = definition.value;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-selected', String(index === 0));
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.textContent = definition.label;
    tablist.append(tab);

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.className = `task-tab-panel ${definition.panelClass || ''}`.trim();
    panel.dataset.tabPanel = definition.value;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.tabIndex = 0;
    panel.hidden = index !== 0;
    panels.set(definition.value, panel);
  }

  root.append(tablist, ...panels.values());
  return { root, tablist, panels };
}

function selectTab(tab, { focus = false } = {}) {
  const group = tab?.closest('[data-tab-group]');
  if (!(group instanceof HTMLElement)) return false;
  const panelId = tab.getAttribute('aria-controls');
  if (!panelId) return false;

  for (const candidate of group.querySelectorAll('[role="tab"]')) {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', String(selected));
    candidate.tabIndex = selected ? 0 : -1;
  }
  for (const panel of group.querySelectorAll('[role="tabpanel"]')) {
    panel.hidden = panel.id !== panelId;
  }
  group.dataset.activeTab = tab.dataset.tabValue || panelId;
  if (focus) tab.focus();
  return true;
}

function selectTabValue(groupName, value, options = {}) {
  const group = document.querySelector(`[data-tab-group="${CSS.escape(groupName)}"]`);
  const tab = group?.querySelector(`[role="tab"][data-tab-value="${CSS.escape(value)}"]`);
  return selectTab(tab, options);
}

function handleTabKeyboard(event) {
  const tab = event.target.closest?.('[role="tab"][data-tab-value]');
  if (!tab) return;
  const group = tab.closest('[data-tab-group]');
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(tab);
  if (index < 0) return;

  let nextIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  selectTab(tabs[nextIndex], { focus: true });
}

document.addEventListener('click', event => {
  const tab = event.target.closest?.('[role="tab"][data-tab-value]');
  if (tab) selectTab(tab);
});
document.addEventListener('keydown', handleTabKeyboard);
document.addEventListener('basketra:select-tab', event => {
  const group = String(event.detail?.group || '');
  const value = String(event.detail?.value || '');
  if (group && value) selectTabValue(group, value, { focus: event.detail?.focus === true });
});

for (const element of $$('[data-icon="chevronLeft"]')) {
  element.dataset.icon = 'chevronUp';
  element.classList.add('icon-rotate-left');
}
for (const element of $$('[data-icon="location"]')) element.dataset.icon = 'store';

hydrateIcons();
bindSwipeActions(document);
document.addEventListener('basketra:hydrate-icons', event => hydrateIcons(event.detail?.root || document));

document.addEventListener('basketra:swipe-action', event => {
  if (event.detail?.kind !== 'shopping-item' || event.detail?.action !== 'complete') return;
  const itemId = CSS.escape(String(event.detail.id || ''));
  document.querySelector(`[data-item-action="complete"][data-item-id="${itemId}"]`)?.click();
});

function receiptInput(item, field) {
  return item.querySelector(`[data-field="${field}"]`);
}

function resetReceiptSwipeShell(item) {
  const row = item.closest('[data-swipe-kind="receipt-line"]');
  if (!row) return;
  row.dataset.swipeOpen = 'false';
  row.dataset.swipeDeleteArmed = 'false';
  row.classList.remove('is-dragging', 'is-swipe-committing');
  row.querySelector('[data-swipe-content]')?.style.setProperty('--swipe-x', '0px');
  const actions = row.querySelector('[data-swipe-actions]');
  actions?.setAttribute('aria-hidden', 'true');
  actions?.querySelectorAll('button').forEach(button => {
    button.tabIndex = -1;
  });
  row.querySelector('[data-swipe-toggle]')?.setAttribute('aria-expanded', 'false');
}

function setTextIfChanged(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function syncReceiptCompactSummary(item) {
  let summary = item.querySelector('.receipt-line-compact');
  if (!summary) {
    summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'receipt-line-compact';
    summary.dataset.receiptEditor = 'true';
    summary.innerHTML = `
      <span class="receipt-line-compact__copy">
        <strong data-receipt-summary-description></strong>
        <small data-receipt-summary-meta></small>
      </span>
      <strong class="receipt-line-compact__total" data-receipt-summary-total></strong>`;
    item.querySelector('legend')?.insertAdjacentElement('afterend', summary);
  }

  const index = Number(item.dataset.itemIndex || 0);
  const description = receiptInput(item, 'description');
  const quantity = receiptInput(item, 'quantity');
  const unitPrice = receiptInput(item, 'unitPriceEuro');
  const lineTotal = receiptInput(item, 'lineTotalEuro');
  const descriptionValue = description?.value.trim() || 'Producto sin nombre';
  const quantityValue = quantity?.value || '0';
  const unitPriceValue = unitPrice?.value || '0.00';
  const totalValue = lineTotal?.value || '0.00';
  const accessibleLabel = `Editar línea ${index + 1}: ${descriptionValue}`;

  if (summary.getAttribute('aria-label') !== accessibleLabel) summary.setAttribute('aria-label', accessibleLabel);
  setTextIfChanged(summary.querySelector('[data-receipt-summary-description]'), descriptionValue);
  setTextIfChanged(summary.querySelector('[data-receipt-summary-meta]'), `${quantityValue} × ${unitPriceValue} €`);
  setTextIfChanged(summary.querySelector('[data-receipt-summary-total]'), `${totalValue} €`);
}

function updateReceiptLinePresentation(root) {
  root.querySelectorAll('.receipt-item').forEach(item => {
    const pill = item.querySelector('.receipt-item__legend-actions .status-pill');
    if (pill) {
      const confirmed = pill.classList.contains('success');
      const validation = confirmed ? 'confirmed' : 'review';
      const label = confirmed ? 'Validada' : 'Revisar';
      if (pill.dataset.receiptValidation !== validation) pill.dataset.receiptValidation = validation;
      if (pill.textContent !== label) pill.textContent = label;
    }

    const compactLabels = [
      ['unitPriceEuro', 'Unitario', 'Precio unitario (€)'],
      ['lineTotalEuro', 'Total', 'Total (€)'],
    ];
    for (const [field, visualLabel, accessibleLabel] of compactLabels) {
      const input = receiptInput(item, field);
      const label = input?.closest('label');
      const text = label?.querySelector('span');
      if (!(input instanceof HTMLInputElement) || !(text instanceof HTMLElement)) continue;
      if (input.getAttribute('aria-label') !== accessibleLabel) input.setAttribute('aria-label', accessibleLabel);
      if (text.textContent !== visualLabel) text.textContent = visualLabel;
    }

    const description = receiptInput(item, 'description');
    if (description instanceof HTMLInputElement) description.required = true;
    syncReceiptCompactSummary(item);

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && activeElement.matches('[data-field]')
      && item.contains(activeElement)
      && !item.classList.contains('receipt-item--editing')
    ) {
      queueMicrotask(() => openReceiptLineEditor(item));
    }
  });
}

function installReceiptLineEditor() {
  let dialog = $('#receipt-line-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'receipt-line-dialog';
  dialog.className = 'sheet-dialog receipt-line-dialog';
  dialog.setAttribute('aria-labelledby', 'receipt-line-dialog-title');
  dialog.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-header">
        <div><p class="eyebrow">Línea del ticket</p><h2 id="receipt-line-dialog-title">Editar producto</h2></div>
        <button id="close-receipt-line-editor" class="icon-button" type="button" aria-label="Cerrar editor"><span data-icon="close"></span></button>
      </div>
      <div id="receipt-line-editor-slot"></div>
      <p id="receipt-line-editor-state" class="inline-status" role="alert"></p>
      <div class="dialog-actions receipt-line-editor-actions">
        <button id="delete-receipt-line-editor" class="button danger-outline" type="button"><span data-icon="trash"></span>Eliminar</button>
        <button id="cancel-receipt-line-editor" class="button secondary" type="button">Cancelar</button>
        <button id="save-receipt-line-editor" class="button primary" type="button"><span data-icon="check"></span>Guardar línea</button>
      </div>
    </div>`;
  document.body.append(dialog);
  hydrateIcons(dialog);

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeReceiptLineEditor({ revert: true });
  });
  $('#close-receipt-line-editor').addEventListener('click', () => closeReceiptLineEditor({ revert: true }));
  $('#cancel-receipt-line-editor').addEventListener('click', () => closeReceiptLineEditor({ revert: true }));
  $('#save-receipt-line-editor').addEventListener('click', () => {
    const item = receiptEditorSession?.item;
    if (!item) return;
    const description = receiptInput(item, 'description');
    if (!description?.value.trim()) {
      description?.setAttribute('aria-invalid', 'true');
      $('#receipt-line-editor-state').textContent = 'Indica el producto antes de guardar esta línea.';
      description?.focus();
      return;
    }
    description.removeAttribute('aria-invalid');
    closeReceiptLineEditor();
  });
  $('#delete-receipt-line-editor').addEventListener('click', () => closeReceiptLineEditor({ deleteLine: true }));
  dialog.addEventListener('input', event => {
    $('#receipt-line-editor-state').textContent = '';
    if (event.target.matches('[data-field="description"]') && event.target.value.trim()) {
      event.target.removeAttribute('aria-invalid');
    }
    if (receiptEditorSession?.item) syncReceiptCompactSummary(receiptEditorSession.item);
  });
  return dialog;
}

function openReceiptLineEditor(item) {
  if (!(item instanceof HTMLElement)) return;
  if (receiptEditorSession?.item === item) return;
  if (receiptEditorSession) closeReceiptLineEditor({ revert: true, focus: false });

  const dialog = installReceiptLineEditor();
  const marker = document.createComment('receipt-line-editor-position');
  const parent = item.parentNode;
  if (!parent) return;
  parent.insertBefore(marker, item);
  const fields = ['description', 'quantity', 'unitPriceEuro', 'lineTotalEuro'];
  const values = Object.fromEntries(fields.map(field => [field, receiptInput(item, field)?.value ?? '']));
  const returnFocus = item.querySelector('[data-receipt-editor]');
  receiptEditorSession = { item, marker, values, returnFocus };
  resetReceiptSwipeShell(item);
  item.classList.add('receipt-item--editing');
  $('#receipt-line-editor-slot').append(item);
  $('#receipt-line-editor-state').textContent = '';
  const index = Number(item.dataset.itemIndex || 0);
  $('#receipt-line-dialog-title').textContent = `Editar línea ${index + 1}`;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  requestAnimationFrame(() => receiptInput(item, 'description')?.focus());
}

function closeReceiptLineEditor({ revert = false, deleteLine = false, focus = true } = {}) {
  const session = receiptEditorSession;
  if (!session) return;
  const { item, marker, values, returnFocus } = session;
  if (revert) {
    for (const [field, value] of Object.entries(values)) {
      const input = receiptInput(item, field);
      if (input) input.value = value;
    }
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && item.contains(activeElement)) activeElement.blur();
  receiptEditorSession = null;
  const dialog = $('#receipt-line-dialog');
  if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  else dialog?.removeAttribute('open');

  marker.replaceWith(item);
  item.classList.remove('receipt-item--editing');
  syncReceiptCompactSummary(item);

  if (deleteLine) {
    const deleteButton = item.closest('[data-swipe-kind="receipt-line"]')?.querySelector('[data-receipt-action="delete"]');
    deleteButton?.click();
    return;
  }
  if (focus) requestAnimationFrame(() => returnFocus?.focus());
}

function updateReceiptImportSummary() {
  const summary = $('#receipt-import-summary');
  if (!summary) return;
  const review = $('#receipt-review');
  const lines = review?.querySelectorAll('.receipt-item').length || 0;
  const reviewRequired = review?.querySelectorAll('[data-receipt-validation="review"]').length || 0;
  const total = $('#receipt-total')?.value || '0.00';
  const retailer = $('#receipt-retailer')?.value.trim() || 'Sin comercio';
  summary.querySelector('[data-import-lines]').textContent = String(lines);
  summary.querySelector('[data-import-total]').textContent = `${total} €`;
  summary.querySelector('[data-import-retailer]').textContent = retailer;
  summary.querySelector('[data-import-readiness]').textContent = lines === 0
    ? 'Analiza el ticket o añade una línea manual.'
    : reviewRequired > 0
      ? `${reviewRequired} ${reviewRequired === 1 ? 'línea pendiente' : 'líneas pendientes'} de revisión.`
      : 'Revisión preparada para confirmar.';
}

function installReceiptReviewPresentation() {
  const review = $('#receipt-review');
  const receiptState = $('#receipt-state');
  const confirmButton = $('#confirm-receipt');
  if (!(review instanceof HTMLElement) || !(receiptState instanceof HTMLElement) || !(confirmButton instanceof HTMLButtonElement)) return;

  installReceiptLineEditor();
  const feedback = document.createElement('p');
  feedback.id = 'receipt-confirm-state';
  feedback.className = 'receipt-confirm-state';
  feedback.setAttribute('role', 'alert');
  feedback.hidden = true;
  confirmButton.before(feedback);

  let confirmationActive = false;
  let lastTerminalMessage = '';

  const resetFeedback = () => {
    confirmationActive = false;
    lastTerminalMessage = '';
    feedback.hidden = true;
    feedback.textContent = '';
    delete feedback.dataset.state;
  };

  const syncFeedback = () => {
    if (!confirmationActive) return;
    const message = receiptState.textContent.trim();
    if (!message) return;

    feedback.hidden = false;
    feedback.textContent = message;
    if (message.startsWith('Validando ticket') || message.startsWith('Importando ticket')) {
      feedback.dataset.state = 'working';
      return;
    }
    if (message.startsWith('Ticket importado')) {
      feedback.dataset.state = 'success';
      confirmationActive = false;
      return;
    }

    feedback.dataset.state = 'error';
    if (message !== lastTerminalMessage) {
      lastTerminalMessage = message;
      toast(message);
    }
  };

  new MutationObserver(() => {
    updateReceiptLinePresentation(review);
    updateReceiptImportSummary();
  }).observe(review, { childList: true, subtree: true });
  new MutationObserver(syncFeedback)
    .observe(receiptState, { childList: true, characterData: true, subtree: true });

  confirmButton.addEventListener('click', event => {
    const descriptions = [...review.querySelectorAll('[data-field="description"]')];
    const invalidDescriptionIndex = descriptions.findIndex(input => input.value.trim().length === 0);
    if (invalidDescriptionIndex >= 0) {
      event.stopImmediatePropagation();
      const invalidDescription = descriptions[invalidDescriptionIndex];
      const item = invalidDescription.closest('.receipt-item');
      const lineNumber = Number(item?.dataset.itemIndex || invalidDescriptionIndex) + 1;
      const message = `Revisa la línea ${lineNumber}: indica el producto antes de importar.`;
      invalidDescription.setAttribute('aria-invalid', 'true');
      receiptState.textContent = message;
      feedback.hidden = false;
      feedback.dataset.state = 'error';
      feedback.textContent = message;
      lastTerminalMessage = message;
      toast(message);
      openReceiptLineEditor(item);
      return;
    }

    confirmationActive = true;
    lastTerminalMessage = '';
    feedback.hidden = false;
    feedback.dataset.state = 'working';
    feedback.textContent = 'Validando ticket…';
    queueMicrotask(syncFeedback);
  });
  review.addEventListener('input', event => {
    resetFeedback();
    if (event.target.matches('[data-field="description"]') && event.target.value.trim()) {
      event.target.removeAttribute('aria-invalid');
    }
    const item = event.target.closest('.receipt-item');
    if (item) syncReceiptCompactSummary(item);
    updateReceiptImportSummary();
  });
  review.addEventListener('click', event => {
    const editorTrigger = event.target.closest('[data-receipt-editor], [data-receipt-action="edit"]');
    if (editorTrigger) {
      event.preventDefault();
      event.stopPropagation();
      resetFeedback();
      openReceiptLineEditor(editorTrigger.closest('[data-swipe-kind="receipt-line"]')?.querySelector('.receipt-item'));
      return;
    }
    if (event.target.closest('[data-receipt-action="add-line"], [data-receipt-action="delete"]')) {
      resetFeedback();
    }
  }, true);

  updateReceiptLinePresentation(review);
}

function installTicketContinuousWorkflow() {
  const view = $('.view[data-view="scan"]');
  if (!view || view.dataset.ticketWorkflow === 'continuous') return;
  const captureSource = view.querySelector('.capture-source');
  const workflow = view.querySelector('.receipt-workflow');
  const review = $('#receipt-review');
  const confirmButton = $('#confirm-receipt');
  if (!captureSource || !workflow || !review || !confirmButton) return;

  view.dataset.ticketWorkflow = 'continuous';
  captureSource.dataset.workflowStep = 'capture';
  workflow.dataset.workflowStep = 'process';
  review.dataset.workflowStep = 'review';
  confirmButton.dataset.workflowStep = 'confirm';

  const manualEntry = workflow.querySelector('.manual-entry');
  if (manualEntry) manualEntry.open = true;
}

function installCompletedListDisclosure() {
  const section = $('#completed-section');
  if (!section || section.tagName === 'DETAILS') return;
  const items = $('#completed-items');
  if (!items) return;
  const details = document.createElement('details');
  details.id = 'completed-section';
  details.className = `${section.className} completed-disclosure`;
  details.hidden = section.hidden;
  const summary = document.createElement('summary');
  summary.className = 'completed-disclosure__summary';
  summary.innerHTML = `
    <span><span class="eyebrow">Completados</span><strong id="completed-title">Ya en la cesta</strong></span>
    <span id="completed-count" class="count-badge">0</span>`;
  details.append(summary, items);
  section.replaceWith(details);
}

function wrapProviderTechnicalDetails(card) {
  const providerCheck = card?.querySelector('.provider-check');
  if (!providerCheck || card.querySelector('.technical-disclosure')) return;
  const explanation = providerCheck.nextElementSibling?.matches('p:not([id])')
    ? providerCheck.nextElementSibling
    : null;
  const note = card.querySelector('#ai-provider-network-note');
  const details = document.createElement('details');
  details.className = 'technical-disclosure';
  const summary = document.createElement('summary');
  summary.textContent = 'Detalles técnicos de la conexión';
  const body = document.createElement('div');
  body.className = 'details-body technical-disclosure__body';
  body.append(providerCheck);
  if (explanation) body.append(explanation);
  if (note) body.append(note);
  details.append(summary, body);
  card.querySelector('#test-ai-provider')?.before(details);
}

function organizeSettingsOperations() {
  const settings = $('.view[data-view="settings"]');
  const stack = $('#runtime-operations');
  if (!settings || !stack || stack.dataset.disclosureInstalled === 'true') return Boolean(stack?.dataset.disclosureInstalled);
  const runtimeCard = stack.querySelector('[aria-labelledby="runtime-title"]');
  const aiCard = stack.querySelector('[aria-labelledby="ai-config-title"]');
  const logsCard = stack.querySelector('[aria-labelledby="logs-title"]');
  const backupCard = stack.querySelector('[aria-labelledby="backup-title"]');
  if (!runtimeCard || !aiCard || !logsCard || !backupCard) return false;

  wrapProviderTechnicalDetails(aiCard);
  const { root, panels } = createTabGroup('settings', 'Secciones de ajustes', [
    { value: 'general', label: 'General', panelClass: 'settings-tab-panel' },
    { value: 'ai', label: 'IA', panelClass: 'settings-tab-panel' },
    { value: 'diagnostics', label: 'Diagnóstico', panelClass: 'settings-tab-panel' },
    { value: 'data', label: 'Datos', panelClass: 'settings-tab-panel' },
    { value: 'advanced', label: 'Avanzado', panelClass: 'settings-tab-panel' },
  ]);
  root.id = 'runtime-operations';
  root.classList.add('operations-stack', 'settings-tabs-shell');
  root.dataset.disclosureInstalled = 'true';
  panels.get('general').append(runtimeCard);
  panels.get('ai').append(aiCard);
  panels.get('diagnostics').append(logsCard);
  panels.get('data').append(backupCard);

  const advanced = settings.querySelector('details.settings-advanced-source:has(#diagnostics)');
  if (advanced) {
    advanced.hidden = false;
    advanced.classList.add('settings-advanced-disclosure');
    panels.get('advanced').append(advanced);
  } else {
    const empty = document.createElement('p');
    empty.className = 'inline-status';
    empty.textContent = 'No hay herramientas avanzadas adicionales.';
    panels.get('advanced').append(empty);
  }

  stack.replaceWith(root);
  return true;
}

function installSettingsDisclosureWatcher() {
  if (organizeSettingsOperations()) return;
  const settings = $('.view[data-view="settings"]');
  if (!settings) return;
  const observer = new MutationObserver(() => {
    if (organizeSettingsOperations()) observer.disconnect();
  });
  observer.observe(settings, { childList: true, subtree: true });
}

installReceiptReviewPresentation();
installTicketContinuousWorkflow();
installCompletedListDisclosure();
installSettingsDisclosureWatcher();

function hideToast(version) {
  if (version !== toastState.version) return;
  const element = $('#toast');
  element.classList.remove('show');
  $('#toast-action').hidden = true;
  $('#toast-action').onclick = null;
}

function toast(message, options = {}) {
  const element = $('#toast');
  const action = $('#toast-action');
  const version = ++toastState.version;
  clearTimeout(toastState.timer);
  $('#toast-message').textContent = message;
  action.hidden = !options.actionLabel;
  action.textContent = options.actionLabel || '';
  action.disabled = false;
  action.onclick = options.onAction
    ? async () => {
        action.disabled = true;
        try {
          await options.onAction();
        } finally {
          hideToast(version);
        }
      }
    : null;
  element.classList.add('show');
  toastState.timer = setTimeout(() => hideToast(version), options.duration ?? 4200);
}

function resetDocumentScroll() {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}

function setNavigationReady(ready) {
  applicationReady = ready;
  $('#main').setAttribute('aria-busy', String(!ready));
}

function navigate(requestedRoute, { allowBeforeReady = false } = {}) {
  if (!applicationReady && !allowBeforeReady) {
    pendingRoute = requestedRoute;
    return;
  }
  const availableViews = new Set($$('.view').map(element => element.dataset.view).filter(Boolean));
  const { view, route } = resolveApplicationRoute(requestedRoute, availableViews);
  const primaryNavigation = primaryNavigationForView(view);
  $$('.view').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $$('.bottom-nav [data-nav]').forEach(element => {
    if (element.dataset.nav === primaryNavigation) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${route}`);
  document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view, route } }));
  resetDocumentScroll();
  $('#main').focus({ preventScroll: true });
  requestAnimationFrame(resetDocumentScroll);
}

setNavigationReady(false);

$$('[data-nav]').forEach(element => element.addEventListener('click', event => {
  event.preventDefault();
  navigate(element.dataset.nav);
}));

async function loadAiConfiguration() {
  try {
    return (await api('/api/v1/settings/ai-provider')).configured === true;
  } catch {
    return false;
  }
}

async function initialize() {
  const initialRoute = location.hash.slice(1) || 'home';
  if (initialRoute === 'home') navigate('home', { allowBeforeReady: true });
  else pendingRoute = initialRoute;
  try {
    const metadata = await api('/api/v1/meta');
    const aiConfigured = await loadAiConfiguration();
    initReceipts({ metadata, toast, aiConfigured });
    await initLists({ metadata, toast, aiConfigured });
  } catch (error) {
    $('#list-state').textContent = error.message;
    $('#upload-state').textContent = error.message;
    toast(error.message);
  } finally {
    setNavigationReady(true);
    const readyRoute = pendingRoute || initialRoute;
    pendingRoute = '';
    navigate(readyRoute, { allowBeforeReady: true });
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

void initialize();
