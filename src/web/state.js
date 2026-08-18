const STORAGE_KEYS = Object.freeze({
  activeListId: 'basketra.activeListId',
  itemDraft: 'basketra.itemDraft',
  captures: 'basketra.captures',
  receiptExtractionJobId: 'basketra.receiptExtractionJobId',
  aiMode: 'basketra.aiMode',
});

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function isStoredCapture(value) {
  return value
    && typeof value === 'object'
    && typeof value.name === 'string'
    && typeof value.mimeType === 'string'
    && Number.isSafeInteger(value.bytes)
    && value.bytes > 0
    && typeof value.storageKey === 'string'
    && /^[a-f0-9]{64}\.(?:jpg|png|pdf)$/.test(value.storageKey)
    && typeof value.contentHash === 'string'
    && /^[a-f0-9]{64}$/.test(value.contentHash);
}

export function loadActiveListId() {
  return localStorage.getItem(STORAGE_KEYS.activeListId) || '';
}

export function saveActiveListId(listId) {
  if (listId) localStorage.setItem(STORAGE_KEYS.activeListId, listId);
  else localStorage.removeItem(STORAGE_KEYS.activeListId);
}

export function loadItemDraft() {
  const value = readJson(STORAGE_KEYS.itemDraft, {});
  return value && typeof value === 'object' ? value : {};
}

export function saveItemDraft(draft) {
  localStorage.setItem(STORAGE_KEYS.itemDraft, JSON.stringify(draft));
}

export function clearItemDraft() {
  localStorage.removeItem(STORAGE_KEYS.itemDraft);
}

export function loadCaptures() {
  const value = readJson(STORAGE_KEYS.captures, []);
  if (!Array.isArray(value)) {
    localStorage.removeItem(STORAGE_KEYS.captures);
    return [];
  }
  const captures = value.filter(isStoredCapture);
  if (captures.length !== value.length) localStorage.setItem(STORAGE_KEYS.captures, JSON.stringify(captures));
  return captures;
}

export function saveCaptures(captures) {
  localStorage.setItem(STORAGE_KEYS.captures, JSON.stringify(captures));
}

export function loadReceiptExtractionJobId() {
  const id = localStorage.getItem(STORAGE_KEYS.receiptExtractionJobId) || '';
  if (/^receiptextractionjob_[a-z0-9]+$/i.test(id)) return id;
  localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobId);
  return '';
}

export function saveReceiptExtractionJobId(id) {
  if (/^receiptextractionjob_[a-z0-9]+$/i.test(id)) {
    localStorage.setItem(STORAGE_KEYS.receiptExtractionJobId, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobId);
  }
}

export function loadAiMode() {
  const value = localStorage.getItem(STORAGE_KEYS.aiMode);
  return ['disabled', 'manual', 'automatic'].includes(value) ? value : 'disabled';
}

export function saveAiMode(mode) {
  if (['disabled', 'manual', 'automatic'].includes(mode)) localStorage.setItem(STORAGE_KEYS.aiMode, mode);
}
