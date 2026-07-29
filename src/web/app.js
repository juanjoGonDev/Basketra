const state = {
  lists: [],
  activeListId: localStorage.getItem('basketra.activeListId') || '',
  captures: JSON.parse(localStorage.getItem('basketra.captures') || '[]'),
  suggestionController: null,
  aiController: null,
  aiTimer: null,
  receiptController: null,
  receiptExtraction: null,
  originalReceiptItems: [],
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const token = localStorage.getItem('basketra.authToken');
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

function navigate(view) {
  $$('.view').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $$('[data-nav]').forEach(element => element.setAttribute('aria-current', element.dataset.nav === view ? 'page' : 'false'));
  history.replaceState(null, '', `#${view}`);
  $('#main').focus();
}

$$('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));

async function checkConnection() {
  try {
    await api('/health');
    $('#connection-state').textContent = 'Conectado';
    $('#connection-state').dataset.ok = 'true';
  } catch {
    $('#connection-state').textContent = 'Sin conexión';
  }
}

async function loadLists() {
  const { lists } = await api('/api/v1/shopping-lists');
  state.lists = lists;
  if (!state.activeListId && lists[0]) state.activeListId = lists[0].id;
  renderLists();
  if (state.activeListId) await loadActiveList();
}

function renderLists() {
  const select = $('#list-select');
  select.innerHTML = state.lists.map(list => `<option value="${escapeHtml(list.id)}"${list.id === state.activeListId ? ' selected' : ''}>${escapeHtml(list.name)}</option>`).join('') || '<option value="">Sin listas</option>';
}

async function createList() {
  const name = prompt('Nombre de la lista', 'Compra semanal');
  if (!name) return;
  const { list } = await api('/api/v1/shopping-lists', { method: 'POST', body: JSON.stringify({ name }) });
  state.activeListId = list.id;
  localStorage.setItem('basketra.activeListId', list.id);
  await loadLists();
  toast('Lista creada');
}

async function loadActiveList() {
  if (!state.activeListId) {
    $('#items').innerHTML = '';
    return;
  }
  const { items } = await api(`/api/v1/shopping-lists/${encodeURIComponent(state.activeListId)}`);
  $('#items').innerHTML = items.length
    ? items.map(item => `<li><div><strong>${escapeHtml(item.text)}</strong><small>${item.quantityMinor} ${escapeHtml(item.unit)} · ${item.exactRequired ? 'exacto' : 'sustituible'}</small></div><span>${item.substitutionAllowed ? 'Alternativas' : 'Sin alternativas'}</span></li>`).join('')
    : '<li>Añade el primer producto.</li>';
}

$('#new-list').addEventListener('click', () => void createList());
$('#list-select').addEventListener('change', event => {
  state.activeListId = event.target.value;
  localStorage.setItem('basketra.activeListId', state.activeListId);
  void loadActiveList();
});

$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.activeListId) await createList();
  if (!state.activeListId) return;
  const text = $('#item-text').value.trim();
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
  await loadActiveList();
  toast('Producto añadido');
});

const itemText = $('#item-text');
itemText.value = localStorage.getItem('basketra.itemDraft') || '';
itemText.addEventListener('input', () => {
  localStorage.setItem('basketra.itemDraft', itemText.value);
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
      $('#suggestions').innerHTML = suggestions.map(suggestion => `<button type="button" role="option" data-suggestion="${escapeHtml(suggestion.name)}">${escapeHtml(suggestion.name)}</button>`).join('');
    } catch (error) {
      if (error.name !== 'AbortError') $('#suggestions').innerHTML = '';
    }
  }, 180);
});

$('#suggestions').addEventListener('click', event => {
  const button = event.target.closest('[data-suggestion]');
  if (!button) return;
  itemText.value = button.dataset.suggestion;
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
    $('#ai-state').textContent = 'Escribe un producto o una frase';
    return;
  }
  state.aiController?.abort();
  const controller = new AbortController();
  state.aiController = controller;
  $('#ai-state').textContent = 'Analizando…';
  $('#ai-proposals').hidden = true;
  try {
    const { proposal } = await api('/api/v1/ai/shopping-list-analysis', { method: 'POST', body: JSON.stringify({ text }), signal: controller.signal });
    if (controller.signal.aborted || itemText.value.trim() !== text) return;
    $('#ai-state').textContent = 'Propuesta lista para revisar';
    $('#ai-proposals').hidden = false;
    $('#ai-proposals').innerHTML = `<h2>Propuestas IA</h2><ul>${proposal.items.map(item => `<li><strong>${escapeHtml(item.text)}</strong> · ${item.quantityMinor} ${escapeHtml(item.unit)}${item.ambiguity ? `<br><small>${escapeHtml(item.ambiguity)}</small>` : ''}</li>`).join('')}</ul>`;
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('#ai-state').textContent = `Proveedor IA no disponible: ${error.message}`;
  }
}

function renderCaptures() {
  localStorage.setItem('basketra.captures', JSON.stringify(state.captures));
  $('#capture-list').innerHTML = state.captures.map((capture, index) => `<li><strong>${escapeHtml(capture.name)}</strong><span>${escapeHtml(capture.mimeType)} · ${capture.bytes} bytes</span><div><button type="button" class="secondary" data-up="${index}" ${index === 0 ? 'disabled' : ''}>Subir</button><button type="button" class="secondary" data-down="${index}" ${index === state.captures.length - 1 ? 'disabled' : ''}>Bajar</button><button type="button" class="secondary" data-delete="${index}">Eliminar</button></div></li>`).join('');
}

$('#receipt-files').addEventListener('change', async event => {
  try {
    for (const file of event.target.files) {
      const base64 = await fileToBase64(file);
      const { file: stored } = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name }),
      });
      state.captures.push({
        name: file.name,
        mimeType: file.type,
        bytes: stored.bytes,
        storageKey: stored.storageKey,
        contentHash: stored.hash,
      });
    }
    renderCaptures();
    toast('Capturas guardadas');
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = '';
  }
});

$('#capture-list').addEventListener('click', event => {
  const action = ['up', 'down', 'delete'].find(name => event.target.dataset[name] !== undefined);
  if (!action) return;
  const index = Number(event.target.dataset[action]);
  if (action === 'delete') state.captures.splice(index, 1);
  else {
    const target = action === 'up' ? index - 1 : index + 1;
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
    return;
  }
  state.receiptController?.abort();
  const controller = new AbortController();
  state.receiptController = controller;
  $('#receipt-state').textContent = 'Procesando capturas…';
  $('#extract-receipt').disabled = true;
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
      $('#receipt-state').textContent = 'IA no configurada; extracción determinista lista';
    }
    if (controller.signal.aborted) return;
    applyReceiptExtraction(result.extraction);
    if (!$('#receipt-state').textContent.includes('IA no configurada')) $('#receipt-state').textContent = 'Extracción lista para revisar';
  } catch (error) {
    if (error.name !== 'AbortError') $('#receipt-state').textContent = `No se pudo procesar: ${error.message}`;
  } finally {
    $('#extract-receipt').disabled = false;
  }
}

function applyReceiptExtraction(extraction) {
  state.receiptExtraction = extraction;
  state.originalReceiptItems = extraction.final.items.map(item => ({ ...item }));
  $('#receipt-text').value = extraction.originalText;
  $('#receipt-total').value = extraction.final.declaredTotalMinor ?? 0;
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
  state.receiptExtraction = {
    pages: [],
    originalText: text,
    deterministic: { items, declaredTotalMinor },
    final: { items, declaredTotalMinor, review: { lines, total } },
  };
  state.originalReceiptItems = items.map(item => ({ ...item }));
  renderReceiptReview(items, lines, total);
}

function renderReceiptReview(items, lines, total) {
  const review = $('#receipt-review');
  const prioritized = items.map((item, index) => ({ item, index, validation: lines[index] || { status: 'needs-review' } }))
    .sort((left, right) => Number(left.validation.status === 'confirmed') - Number(right.validation.status === 'confirmed') || left.index - right.index);
  review.hidden = false;
  review.innerHTML = `<h2>Revisión</h2><p>Total calculado: ${total?.expectedMinor ?? items.reduce((sum, item) => sum + item.lineTotalMinor, 0)} céntimos · ${total?.valid === false ? 'revisar diferencia' : 'correcto'}</p><div class="receipt-items">${prioritized.map(({ item, index, validation }) => `<fieldset class="receipt-item" data-item-index="${index}"><legend>Línea ${index + 1} · ${escapeHtml(validation.status)}</legend><label>Descripción<input data-field="description" maxlength="240" value="${escapeHtml(item.description)}"></label><label>Cantidad<input data-field="quantity" type="number" min="0" value="${item.quantity}"></label><label>Precio unitario (céntimos)<input data-field="unitPriceMinor" type="number" min="0" value="${item.unitPriceMinor}"></label><label>Total línea (céntimos)<input data-field="lineTotalMinor" type="number" min="0" value="${item.lineTotalMinor}"></label><small>Confianza ${Math.round((item.confidence ?? 1) * 100)}% · ${escapeHtml(validation.status)}</small></fieldset>`).join('')}</div>`;
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
  if (items.length === 0) {
    toast('No hay líneas para importar');
    return;
  }
  const originalText = $('#receipt-text').value.trim();
  const declaredTotalMinor = Number($('#receipt-total').value);
  const corrections = collectReceiptCorrections(items);
  const importKey = await createReceiptImportKey(originalText);
  $('#confirm-receipt').disabled = true;
  $('#receipt-state').textContent = 'Importando ticket…';
  try {
    const { receiptId } = await api('/api/v1/receipts/confirm', {
      method: 'POST',
      body: JSON.stringify({
        importKey,
        originalText,
        declaredTotalMinor,
        provider: receiptProviderLabel(),
        deterministic: state.receiptExtraction?.deterministic || { items },
        ...(state.receiptExtraction?.ai ? { ai: state.receiptExtraction.ai.interpretation } : {}),
        captures: state.captures.map(capture => ({
          storageKey: capture.storageKey,
          contentHash: capture.contentHash,
          mimeType: capture.mimeType,
          originalName: capture.name,
        })),
        items,
        corrections,
      }),
    });
    $('#receipt-state').textContent = `Ticket importado: ${receiptId}`;
    toast('Ticket confirmado');
    state.captures = [];
    state.receiptExtraction = null;
    state.originalReceiptItems = [];
    renderCaptures();
    $('#confirm-receipt').hidden = true;
  } catch (error) {
    $('#receipt-state').textContent = `Revisa el ticket: ${error.message}`;
  } finally {
    $('#confirm-receipt').disabled = false;
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

$('#run-demo-comparison').addEventListener('click', async () => {
  const now = new Date().toISOString();
  const payload = {
    requirements: [
      { itemId: 'milk', label: 'Leche entera 1 L', exactRequired: false, substitutionAllowed: true },
      { itemId: 'rice', label: 'Arroz 1 kg', exactRequired: true, substitutionAllowed: false },
    ],
    retailerPenaltyMinor: 100,
    offers: [
      { id: 'a-milk', itemId: 'milk', retailerId: 'market-a', title: 'Leche entera 1 L', priceMinor: 105, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: .95, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
      { id: 'a-rice', itemId: 'rice', retailerId: 'market-a', title: 'Arroz 1 kg', priceMinor: 210, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'kg' }, stock: 'in-stock', observedAt: now, confidence: .9, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
      { id: 'b-milk', itemId: 'milk', retailerId: 'market-b', title: 'Leche marca alternativa 1 L', priceMinor: 90, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: .88, evidence: 'manual fixture', exact: false, substitutionQuality: .85 },
      { id: 'b-rice', itemId: 'rice', retailerId: 'market-b', title: 'Arroz 1 kg', priceMinor: 180, shippingMinor: 0, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'kg' }, stock: 'in-stock', observedAt: now, confidence: .92, evidence: 'manual fixture', exact: true, substitutionQuality: 1 },
    ],
  };
  const { plans } = await api('/api/v1/optimization-runs', { method: 'POST', body: JSON.stringify(payload) });
  $('#plans').innerHTML = plans.map(plan => `<article><h2>${labelPlan(plan.kind)}</h2><dl><dt>Total efectivo</dt><dd>${plan.effectiveTotalMinor} cént.</dd><dt>Comercios</dt><dd>${plan.retailerIds.length}</dd><dt>Faltantes</dt><dd>${plan.missingItemIds.length}</dd><dt>Confianza</dt><dd>${Math.round(plan.confidence * 100)}%</dd></dl><p>${escapeHtml(plan.explanation)}</p>${plan.substitutions.length ? `<p>Sustituciones: ${plan.substitutions.map(escapeHtml).join(', ')}</p>` : ''}</article>`).join('');
});

$('#download-backup').addEventListener('click', async () => {
  const name = `basketra-${Date.now()}.db`;
  const { backup } = await api('/api/v1/backup', { method: 'POST', body: JSON.stringify({ name }) });
  toast(`Backup creado: ${backup.name}`);
});

async function loadDiagnostics() {
  try {
    $('#diagnostics').textContent = JSON.stringify(await api('/api/v1/diagnostics'), null, 2);
  } catch (error) {
    $('#diagnostics').textContent = error.message;
  }
}

function parseReceiptText(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^(.*?)[;|]\s*(\d+)\s*[;|]\s*(\d+)\s*[;|]\s*(\d+)$/.exec(line);
    return match
      ? { description: match[1].trim(), quantity: Number(match[2]), unitPriceMinor: Number(match[3]), lineTotalMinor: Number(match[4]) }
      : { description: line, quantity: 1, unitPriceMinor: 0, lineTotalMinor: 0 };
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

function labelPlan(kind) {
  return kind === 'single-retailer' ? 'Un solo comercio' : kind === 'balanced' ? 'Equilibrio recomendado' : 'Máximo ahorro';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

window.addEventListener('online', checkConnection);
window.addEventListener('offline', checkConnection);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
navigate(location.hash.slice(1) || 'home');
renderCaptures();
checkConnection();
loadLists().catch(error => toast(error.message));
loadDiagnostics();
