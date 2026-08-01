import { api, setBusy } from './api.js';
import { initLists } from './lists.js';
import { initReceipts } from './receipts.js';
import { loadAiMode, saveAiMode } from './state.js';
import {
  bindSwipeActions,
  hydrateIcons,
  optimizationPlan,
  proposalPanel,
} from './ui.js';

const aiState = {
  controller: null,
  timer: null,
};

const toastState = {
  timer: null,
  version: 0,
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

hydrateIcons();
bindSwipeActions(document);

document.addEventListener('basketra:swipe-action', event => {
  if (event.detail?.kind !== 'shopping-item' || event.detail?.action !== 'complete') return;
  const itemId = CSS.escape(String(event.detail.id || ''));
  document.querySelector(`[data-item-action="complete"][data-item-id="${itemId}"]`)?.click();
});

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

function navigate(requestedView) {
  const view = $(`.view[data-view="${CSS.escape(requestedView)}"]`) ? requestedView : 'home';
  $$('.view').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $$('.bottom-nav [data-nav]').forEach(element => {
    if (element.dataset.nav === view) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${view}`);
  resetDocumentScroll();
  $('#main').focus({ preventScroll: true });
  requestAnimationFrame(resetDocumentScroll);
}

$$('[data-nav]').forEach(element => element.addEventListener('click', event => {
  event.preventDefault();
  navigate(element.dataset.nav);
}));

function prepareSettingsView() {
  $('.view[data-view="settings"] .privacy-card')?.remove();
}

function scheduleAutomaticAi(text) {
  if (aiState.timer) clearTimeout(aiState.timer);
  aiState.controller?.abort();
  if ($('#ai-mode').value !== 'automatic' || text.length < 2) return;
  aiState.timer = setTimeout(() => void analyzeWithAi(), 800);
}

async function analyzeWithAi() {
  const text = $('#item-text').value.trim();
  if (!text) {
    $('#ai-state').textContent = 'Escribe primero un producto o una frase.';
    return;
  }
  aiState.controller?.abort();
  const controller = new AbortController();
  aiState.controller = controller;
  $('#ai-state').textContent = 'Analizando…';
  $('#ai-proposals').hidden = true;
  try {
    const result = await api('/api/v1/ai/shopping-list-analysis', {
      method: 'POST',
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (controller.signal.aborted || $('#item-text').value.trim() !== text) return;
    $('#ai-state').textContent = 'Propuesta lista para revisar';
    $('#ai-proposals').hidden = false;
    $('#ai-proposals').innerHTML = proposalPanel(result.proposal);
  } catch (error) {
    if (error.name !== 'AbortError') {
      $('#ai-state').textContent = `Proveedor IA no disponible: ${error.message}`;
    }
  }
}

function bindAiControls() {
  $('#ai-mode').value = loadAiMode();
  $('#ai-mode').addEventListener('change', event => {
    saveAiMode(event.target.value);
    scheduleAutomaticAi($('#item-text').value.trim());
  });
  $('#analyze-ai').addEventListener('click', () => void analyzeWithAi());
  document.addEventListener('basketra:item-text-changed', event => {
    scheduleAutomaticAi(event.detail?.text || '');
  });
}

async function runDemoComparison(button) {
  setBusy(button, true);
  try {
    const now = new Date().toISOString();
    const result = await api('/api/v1/optimization-runs', {
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
    $('#plans').innerHTML = result.plans.map(optimizationPlan).join('');
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function loadAiConfiguration() {
  try {
    return (await api('/api/v1/settings/ai-provider')).configured === true;
  } catch {
    return false;
  }
}

async function initialize() {
  prepareSettingsView();
  navigate(location.hash.slice(1) || 'home');
  bindAiControls();
  $('#run-demo-comparison').addEventListener('click', event => void runDemoComparison(event.currentTarget));
  try {
    const metadata = await api('/api/v1/meta');
    const aiConfigured = await loadAiConfiguration();
    await initLists({ metadata, toast });
    initReceipts({ metadata, toast, aiConfigured });
  } catch (error) {
    $('#list-state').textContent = error.message;
    $('#upload-state').textContent = error.message;
    toast(error.message);
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

void initialize();
