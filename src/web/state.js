const STORAGE_KEYS = Object.freeze({
  activeListId: 'basketra.activeListId',
  itemDraft: 'basketra.itemDraft',
  captures: 'basketra.captures',
  receiptExtractionJobId: 'basketra.receiptExtractionJobId',
  receiptExtractionJobs: 'basketra.receiptExtractionJobs',
  aiMode: 'basketra.aiMode',
});

const RECEIPT_JOB_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);
const RECEIPT_JOB_MODES = new Set(['full', 'ai-retry']);

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function isStorageKey(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}\.(?:jpg|png|pdf)$/.test(value);
}

function isReceiptExtractionJobId(value) {
  return typeof value === 'string' && /^receiptextractionjob_[a-z0-9]+$/i.test(value);
}

function isStoredCapture(value) {
  return value
    && typeof value === 'object'
    && typeof value.name === 'string'
    && typeof value.mimeType === 'string'
    && Number.isSafeInteger(value.bytes)
    && value.bytes > 0
    && isStorageKey(value.storageKey)
    && typeof value.contentHash === 'string'
    && /^[a-f0-9]{64}$/.test(value.contentHash);
}

function normalizeReceiptExtractionJob(value) {
  if (!value || typeof value !== 'object' || !isReceiptExtractionJobId(value.id) || !Array.isArray(value.captureKeys)) {
    return null;
  }
  const captureKeys = [...new Set(value.captureKeys.filter(isStorageKey))];
  if (captureKeys.length === 0) return null;
  const status = RECEIPT_JOB_STATUSES.has(value.status) ? value.status : 'queued';
  const mode = RECEIPT_JOB_MODES.has(value.mode) ? value.mode : 'full';
  return { id: value.id, captureKeys, status, mode };
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
  if (isReceiptExtractionJobId(id)) return id;
  localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobId);
  return '';
}

export function saveReceiptExtractionJobId(id) {
  if (isReceiptExtractionJobId(id)) {
    localStorage.setItem(STORAGE_KEYS.receiptExtractionJobId, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobId);
  }
}

export function loadReceiptExtractionJobs() {
  const value = readJson(STORAGE_KEYS.receiptExtractionJobs, []);
  if (!Array.isArray(value)) {
    localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobs);
    return [];
  }
  const jobs = value.map(normalizeReceiptExtractionJob).filter(Boolean);
  if (jobs.length !== value.length) localStorage.setItem(STORAGE_KEYS.receiptExtractionJobs, JSON.stringify(jobs));
  return jobs;
}

export function saveReceiptExtractionJobs(jobs) {
  const normalized = Array.isArray(jobs)
    ? jobs.map(normalizeReceiptExtractionJob).filter(Boolean)
    : [];
  if (normalized.length > 0) {
    localStorage.setItem(STORAGE_KEYS.receiptExtractionJobs, JSON.stringify(normalized));
  } else {
    localStorage.removeItem(STORAGE_KEYS.receiptExtractionJobs);
  }
}

export function loadAiMode() {
  const value = localStorage.getItem(STORAGE_KEYS.aiMode);
  return ['disabled', 'manual', 'automatic'].includes(value) ? value : 'disabled';
}

export function saveAiMode(mode) {
  if (['disabled', 'manual', 'automatic'].includes(mode)) localStorage.setItem(STORAGE_KEYS.aiMode, mode);
}
