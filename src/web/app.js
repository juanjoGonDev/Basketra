import {
  captureItem,
  connectionStatus,
  emptyListState,
  escapeHtml,
  hydrateIcons,
  optimizationPlan,
  proposalPanel,
  receiptReview,
  shoppingListItem,
  suggestionOption,
} from './ui.js';

const state = {
  lists: [],
  activeListId: localStorage.getItem('basketra.activeListId') || '',
  captures: parseStoredCaptures(),
  suggestionController: null,
  aiController: null,
  aiTimer: null,
  receiptController: null,
  receiptExtraction: null,
  originalReceiptItems: [],
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

hydrateIcons();

function parseStoredCaptures() {
  try {
    const value = JSON.parse(localStorage.getItem('basketra.captures') || '[]');
    return Array.isArray(value) ? value.map(capture => ({ ...capture, previewUrl: '' })) : [];
  } catch {
    localStorage.removeItem('basketra.captures');
    return [];
  }
}

function persistCaptures() {
  const serializable = state.captures.map(({ previewUrl, ...capture }) => capture);
  localStorage.setItem('basketra.captures', JSON.stringify(serializable));
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`);
    error.code = body.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  if (label) button.querySelector('span:last-child')?.replaceChildren(label);
}

function navigate(requestedView) {
  const view = $(`.view[data-view="${CSS.escape(requestedView)}"]`) ? requestedView : 'home';
  $$('.view').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $$('.bottom-nav [data-nav]').forEach(element => {
    if (element.dataset.nav === view) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${view}`);
  window.scrollTo(0, 0);
  $('#main').focus({ preventScroll: true });
}

$$('[data-nav]').forEach(element => element.addEventListener('click', event => {
  event.preventDefault();
  navigate(element.dataset.nav);
}));

async function checkConnection() {
  const element = $('#connection-state');
  try {
    await api('/health');
    element.innerHTML = connectionStatus(true);
    element.dataset.ok = 'true';
  } catch {
    element.innerHTML = connectionStatus(false);
    delete element.dataset.ok;
  }
}

async function loadLists() {
  const { lists } = await api('/api/v1/shopping-lists');
  state.lists = lists;
  if (!lists.some(list => list.id === state.activeListId)) state.activeListId = lists[0]?.id || '';
  if (state.activeListId) localStorage.setItem('basketra.activeListId', state.activeListId);
  else localStorage.removeItem('basketra.activeListId');
  renderLists();
  await loadActiveList();
}

function renderLists() {
  const select = $('#list-select');
  select.innerHTML = state.lists.length
    ? state.lists.map(list => `<option value="${escapeHtml(list.id)}"${list.id === state.activeListId ? ' selected' : ''}>${escapeHtml(list.name)}</option>`).join('')
    : '<option value="">Todavía no hay listas</option>';
  select.disabled = state.lists.length === 0;
  $('#item-form').classList.toggle('is-disabled', !state.activeListId);
}

async function createList(name) {
  const { list } = await api('/api/v1/shopping-lists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  state.activeListId = list.id;
  localStorage.setItem('basketra.activeListId', list.id);
  await loadLists();
  return list;
}

$('#new-list-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#new-list-name');
  const button = event.submitter;
  const name = input.value.trim();
  if (!name) return;
  $('#list-state').textContent = 'Creando lista…';
  setBusy(button, true);
  try {
    await createList(name);
    input.value = '';
    $('#list-state').textContent = 'Lista lista para usar';
    toast('Lista creada');
    $('#item-text').focus();
  } catch (error) {
    $('#list-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

$('#list-select').addEventListener('change', async event => {
  state.activeListId = event.target.value;
  localStorage.setItem('basketra.activeListId', state.activeListId);
  try { await loadActiveList(); } catch (error) { toast(error.message); }
});

async function loadActiveList() {
  if (!state.activeListId) {
    $('#items').innerHTML = emptyListState('Crea una lista para empezar.');
    $('#item-count').textContent = '0';
    return;
  }
  const { items } = await api(`/api/v1/shopping-lists/${encodeURIComponent(state.activeListId)}`);
  $('#items').innerHTML = items.length ? items.map(shoppingListItem).join('') : emptyListState();
  $('#item-count').textContent = String(items.length);
}

$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#add-item');
  if (!state.activeListId) {
    $('#item-state').textContent = 'Crea una lista antes de añadir productos.';
    $('#new-list-name').focus();
    return;
  }
  const text = $('#item-text').value.trim();
  if (!text) return;
  $('#item-state').textContent = 'Añadiendo…';
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(state.activeListId)}/items`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        quantityMinor: Number($('#item-quantity').value),
        unit: $('#item-unit').value,
        exactRequired: $('#exact-required').checked,
        substitutionAllowed: $('#substitution-allowed').checked,
      }),
    });
    event.target.reset();
    $('#item-quantity').value = '1';
    $('#substitution-allowed').checked = true;
    localStorage.removeItem('basketra.itemDraft');
    $('#suggestions').innerHTML = '';
    await loadActiveList();
    $('#item-state').textContent = 'Producto añadido';
    toast('Producto añadido');
    $('#item-text').focus();
  } catch (error) {
    $('#item-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

const itemText = $('#item-text');
itemText.value = localStorage.getItem('basketra.itemDraft') || '';
itemText.addEventListener('input', () => {
  localStorage.setItem('basketra.itemDraft', itemText.value);
  $('#item-state').textContent = '';
  scheduleAutomaticAi();
  state.suggestionController?.abort();
  const query = itemText.value.trim();
  if (query.length < 2) {
    $('#suggestions').innerHTML = '';
    return;
  }
  const controller = new AbortController();
  state.suggestionController = controller;
  setTimeout(async () => {
    if (controller.signal.aborted) return;
    try {
      const { suggestions } = await api(`/api/v1/products/suggestions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (controller.signal.aborted || itemText.value.trim() !== query) return;
      $('#suggestions').innerHTML = suggestions.map(suggestionOption).join('');
    } catch (error) {
      if (error.name !== 'AbortError') $('#suggestions').innerHTML = '';
    }
  }, 180);
});

$('#suggestions').addEventListener('click', event => {
  const button = event.target.closest('[data-suggestion]');
  if (!button) return;
  itemText.value = button.dataset.suggestion;
  localStorage.setItem('basketra.itemDraft', itemText.value);
  $('#suggestions').innerHTML = '';
  itemText.focus();
});

$('#ai-mode').value = localStorage.getItem('basketra.aiMode') || 'disabled';
$('#ai-mode').addEventListener('change', event => {
  localStorage.setItem('basketra.aiMode', event.target.value);
  scheduleAutomaticAi();
});
$('#analyze-ai').addEventListener('click', () => void analyzeWithAi());

function scheduleAutomaticAi() {
  if (state.aiTimer) clearTimeout(state.aiTimer);
  state.aiController?.abort();
  if ($('#ai-mode').value !== 'automatic' || itemText.value.trim().length < 2) return;
  state.aiTimer = setTimeout(() => void analyzeWithAi(), 800);
}

async function analyzeWithAi() {
  const text = itemText.value.trim();
  if (!text) {
    $('#ai-state').textContent = 'Escribe primero un producto o una frase.';
    return;
  }
  state.aiController?.abort();
  const controller = new AbortController();
  state.aiController = controller;
  $('#ai-state').textContent = 'Analizando…';
  $('#ai-proposals').hidden = true;
  try {
    const { proposal } = await api('/api/v1/ai/shopping-list-analysis', {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (controller.signal.aborted || itemText.value.trim() !== text) return;
    $('#ai-state').textContent = 'Propuesta lista para revisar';
    $('#ai-proposals').hidden = false;
    $('#ai-proposals').innerHTML = proposalPanel(proposal);
  } catch (error) {
    if (error.name !== 'AbortError') $('#ai-state').textContent = `Proveedor IA no disponible: ${error.message}`;
  }
}

function renderCaptures() {
  persistCaptures();
  $('#capture-list').innerHTML = state.captures.map((capture, index) => captureItem(capture, index, state.captures.length)).join('');
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  $('#upload-state').textContent = `Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`;
  try {
    for (const file of files) {
      const base64 = await fileToBase64(file);
      const { file: stored } = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name }),
      });
      state.captures.push({
        name: file.name || `foto-${Date.now()}.jpg`,
        mimeType: file.type,
        bytes: stored.bytes,
        storageKey: stored.storageKey,
        contentHash: stored.hash,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      });
      renderCaptures();
    }
    $('#upload-state').textContent = 'Capturas listas para procesar';
    toast('Capturas guardadas');
  } catch (error) {
    $('#upload-state').textContent = error.message;
    toast(error.message);
  }
}

for (const input of [$('#receipt-files'), $('#receipt-camera')]) {
  input.addEventListener('change', async event => {
    await uploadFiles(event.target.files);
    event.target.value = '';
  });
}

$('#capture-list').addEventListener('click', event => {
  const button = event.target.closest('[data-up],[data-down],[data-delete]');
  if (!button) return;
  const action = ['up', 'down', 'delete'].find(name => button.dataset[name] !== undefined);
  const index = Number(button.dataset[action]);
  if (action === 'delete') {
    const [removed] = state.captures.splice(index, 1);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  } else {
    const target = action === 'up' ? index - 1 : index + 1;
    if (!state.captures[target]) return;
    [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  }
  state.receiptExtraction = null;
  $('#confirm-receipt').hidden = true;
  renderCaptures();
});

$('#extract-receipt').addEventListener('click', () => void extractReceipt());
$('#review-receipt').addEventListener('click', reviewManualReceipt);
$('#confirm-receipt').addEventListener('click', () => void confirmReceipt());

async function extractReceipt() {
  if (state.captures.length === 0) {
    toast('Añade al menos una captura');
    $('#receipt-camera').focus();
    return;
  }
  state.receiptController?.abort();
  const controller = new AbortController();
  state.receiptController = controller;
  const button = $('#extract-receipt');
  $('#receipt-state').textContent = 'Procesando capturas…';
  setBusy(button, true);
  const manualText = $('#receipt-text').value.trim();
  const captures = state.captures.map((capture, index) => ({
    storageKey: capture.storageKey,
    originalName: capture.name,
    ...(manualText && index === 0 ? { embeddedText: manualText } : {}),
  }));
  try {
    let result;
    try {
      result = await api('/api/v1/receipts/extract', {
        method: 'POST',
        body: JSON.stringify({ captures, verifyWithAi: $('#verify-receipt-ai').checked }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.code !== 'AI_NOT_CONFIGURED' || !manualText) throw error;
      result = await api('/api/v1/receipts/extract', {
        method: 'POST',
        body: JSON.stringify({ captures, verifyWithAi: false }),
        signal: controller.signal,
      });
    }
    if (controller.signal.aborted) return;
    applyReceiptExtraction(result.extraction);
    $('#receipt-state').textContent = 'Extracción lista para revisar';
  } catch (error) {
    if (error.name !== 'AbortError') $('#receipt-state').textContent = `No se pudo procesar: ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function applyReceiptExtraction(extraction) {
  state.receiptExtraction = extraction;
  state.originalReceiptItems = extraction.final.items.map(item => ({ ...item }));
  $('#receipt-text').value = extraction.originalText;
  $('#receipt-total').value = extraction.final.declaredTotalMinor ?? 0;
  $('.manual-entry').open = true;
  renderReceiptReview(extraction.final.items, extraction.final.review.lines, extraction.final.review.total);
}

function reviewManualReceipt() {
  const text = $('#receipt-text').value.trim();
  if (!text) {
    toast('Añade el texto extraído o transcrito');
    return;
  }
  const items = parseReceiptText(text).map(item => ({ ...item, confidence: 1 }));
  const declaredTotalMinor = Number($('#receipt-total').value);
  const lines = items.map(item => {
    const expectedMinor = item.quantity * item.unitPriceMinor - (item.discountMinor || 0);
    const differenceMinor = item.lineTotalMinor - expectedMinor;
    return { ...item, status: differenceMinor === 0 ? 'confirmed' : 'arithmetic-mismatch', expectedMinor, differenceMinor };
  });
  const expectedMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const total = { expectedMinor, differenceMinor: declaredTotalMinor - expectedMinor, valid: declaredTotalMinor === expectedMinor };
  state.receiptExtraction = { pages: [], originalText: text, deterministic: { items, declaredTotalMinor }, final: { items, declaredTotalMinor, review: { lines, total } } };
  state.originalReceiptItems = items.map(item => ({ ...item }));
  renderReceiptReview(items, lines, total);
}

function renderReceiptReview(items, lines, total) {
  $('#receipt-review').hidden = false;
  $('#receipt-review').innerHTML = receiptReview(items, lines, total);
  $('#confirm-receipt').hidden = items.length === 0;
}

function readReceiptItems() {
  return $$('.receipt-item').map(fieldset => ({
    index: Number(fieldset.dataset.itemIndex),
    description: fieldset.querySelector('[data-field="description"]').value.trim(),
    quantity: Number(fieldset.querySelector('[data-field="quantity"]').value),
    unitPriceMinor: Number(fieldset.querySelector('[data-field="unitPriceMinor"]').value),
    lineTotalMinor: Number(fieldset.querySelector('[data-field="lineTotalMinor"]').value),
    confidence: 1,
    userConfirmed: true,
  })).sort((left, right) => left.index - right.index).map(({ index, ...item }) => item);
}

async function confirmReceipt() {
  const items = readReceiptItems();
  if (items.length === 0) return toast('No hay líneas para importar');
  const originalText = $('#receipt-text').value.trim();
  const declaredTotalMinor = Number($('#receipt-total').value);
  const button = $('#confirm-receipt');
  setBusy(button, true);
  $('#receipt-state').textContent = 'Importando ticket…';
  try {
    const { receiptId } = await api('/api/v1/receipts/confirm', {
      method: 'POST',
      body: JSON.stringify({
        importKey: await createReceiptImportKey(originalText),
        originalText,
        declaredTotalMinor,
        provider: receiptProviderLabel(),
        deterministic: state.receiptExtraction?.deterministic || { items },
        ...(state.receiptExtraction?.ai ? { ai: state.receiptExtraction.ai.interpretation } : {}),
        captures: state.captures.map(capture => ({ storageKey: capture.storageKey, contentHash: capture.contentHash, mimeType: capture.mimeType, originalName: capture.name })),
        items,
        corrections: collectReceiptCorrections(items),
      }),
    });
    $('#receipt-state').textContent = `Ticket importado: ${receiptId}`;
    toast('Ticket confirmado');
    state.captures.forEach(capture => capture.previewUrl && URL.revokeObjectURL(capture.previewUrl));
    state.captures = [];
    state.receiptExtraction = null;
    state.originalReceiptItems = [];
    renderCaptures();
    $('#receipt-review').hidden = true;
    button.hidden = true;
  } catch (error) {
    $('#receipt-state').textContent = `Revisa el ticket: ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function collectReceiptCorrections(items) {
  const corrections = [];
  items.forEach((item, itemIndex) => {
    const original = state.originalReceiptItems[itemIndex];
    if (!original) return;
    for (const field of ['description', 'quantity', 'unitPriceMinor', 'lineTotalMinor']) {
      if (item[field] !== original[field]) corrections.push({ itemIndex, field, original: original[field], corrected: item[field] });
    }
  });
  return corrections;
}

function receiptProviderLabel() {
  const sources = new Set((state.receiptExtraction?.pages || []).map(page => page.source));
  if (state.receiptExtraction?.ai) sources.add('ai-verification');
  return [...sources].join('+') || 'manual';
}

async function createReceiptImportKey(originalText) {
  const source = `${state.captures.map(capture => capture.storageKey).join('|')}|${originalText}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return `receipt-${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

$('#run-demo-comparison').addEventListener('click', async event => {
  const button = event.currentTarget;
  setBusy(button, true);
  try {
    const now = new Date().toISOString();
    const { plans } = await api('/api/v1/optimization-runs', {
      method: 'POST',
      body: JSON.stringify({
        requirements: [
          { itemId: 'milk', label: 'Leche entera 1 L', exactRequired: false, substitutionAllowed: true },
          { itemId: 'rice', label: 'Arroz 1 kg', exactRequired: true, substitutionAllowed: false },
        ],
        retailerPenaltyMinor: 100,
        offers: [
          { id: 'a-milk', itemId: 'milk', retailerId: 'market-a', title: 'Leche entera 1 L', priceMinor: 105, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: 0.95, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
          { id: 'a-rice', itemId: 'rice', retailerId: 'market-a', title: 'Arroz 1 kg', priceMinor: 210, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'kg' }, stock: 'in-stock', observedAt: now, confidence: 0.9, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
          { id: 'b-milk', itemId: 'milk', retailerId: 'market-b', title: 'Leche alternativa 1 L', priceMinor: 90, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: 0.88, evidence: 'manual fixture', exact: false, substitutionQuality: 0.85 },
          { id: 'b-rice', itemId: 'rice', retailerId: 'market-b', title: 'Arroz 1 kg', priceMinor: 180, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'kg' }, stock: 'in-stock', observedAt: now, confidence: 0.92, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
        ],
      }),
    });
    $('#plans').innerHTML = plans.map(optimizationPlan).join('');
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
});

$('#download-backup').addEventListener('click', async event => {
  const button = event.currentTarget;
  setBusy(button, true);
  try {
    const { backup } = await api('/api/v1/backup', { method: 'POST', body: JSON.stringify({ name: `basketra-${Date.now()}.db` }) });
    toast(`Backup creado: ${backup.name}`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
});

async function loadDiagnostics() {
  try { $('#diagnostics').textContent = JSON.stringify(await api('/api/v1/diagnostics'), null, 2); }
  catch (error) { $('#diagnostics').textContent = error.message; }
}

function parseReceiptText(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^(.*?)[;|]\s*(\d+)\s*[;|]\s*(\d+)\s*[;|]\s*(\d+)$/.exec(line);
    return match ? { description: match[1].trim(), quantity: Number(match[2]), unitPriceMinor: Number(match[3]), lineTotalMinor: Number(match[4]) } : { description: line, quantity: 1, unitPriceMinor: 0, lineTotalMinor: 0 };
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

window.addEventListener('online', checkConnection);
window.addEventListener('offline', checkConnection);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
navigate(location.hash.slice(1) || 'home');
renderCaptures();
checkConnection();
loadLists().catch(error => {
  $('#list-state').textContent = error.message;
  toast(error.message);
});
loadDiagnostics();
