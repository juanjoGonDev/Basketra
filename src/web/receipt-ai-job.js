import { api, realtimeEndpoint } from './api.js';

function abortError() {
  return new DOMException('Receipt AI correction was cancelled', 'AbortError');
}

function jobError(job, fallbackCode = 'RECEIPT_EXTRACTION_FAILED') {
  const error = new Error('Receipt AI correction did not complete');
  error.code = typeof job?.errorCode === 'string' && job.errorCode ? job.errorCode : fallbackCode;
  if (typeof job?.id === 'string' && job.id) error.jobId = job.id;
  return error;
}

function terminalJobResult(job, jobId) {
  if (!job || job.id !== jobId) return { kind: 'invalid' };
  if (job.status === 'completed') {
    return job.extraction
      ? { kind: 'completed', value: { extraction: job.extraction } }
      : { kind: 'failed', error: jobError(job, 'RECEIPT_EXTRACTION_RESULT_MISSING') };
  }
  if (job.status === 'failed') return { kind: 'failed', error: jobError(job) };
  if (job.status === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'pending' };
}

function waitForJob(jobId, signal) {
  return new Promise((resolve, reject) => {
    const source = new EventSource(realtimeEndpoint());
    let settled = false;
    let refreshing = false;
    let refreshAgain = false;

    const cleanup = () => {
      source.close();
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const cancelServerJob = () => {
      void api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    };
    const onAbort = () => {
      cancelServerJob();
      settle(() => reject(abortError()));
    };

    const applyJob = (job) => {
      const terminal = terminalJobResult(job, jobId);
      if (terminal.kind === 'completed') settle(() => resolve(terminal.value));
      else if (terminal.kind === 'failed') settle(() => reject(terminal.error));
      else if (terminal.kind === 'cancelled') settle(() => reject(abortError()));
      else if (terminal.kind === 'invalid') settle(() => reject(jobError({ id: jobId }, 'RECEIPT_EXTRACTION_JOB_INVALID')));
    };

    const refresh = async () => {
      if (settled) return;
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        const result = await api(`/api/v1/receipts/extraction-jobs/${encodeURIComponent(jobId)}`, { signal });
        if (!settled) applyJob(result?.job);
      } catch (error) {
        if (settled || signal?.aborted) return;
        if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
          if (!error.jobId) error.jobId = jobId;
          settle(() => reject(error));
        }
        // Transient transport/server read errors wait for EventSource reconnect/open.
      } finally {
        refreshing = false;
        if (refreshAgain && !settled) {
          refreshAgain = false;
          void refresh();
        }
      }
    };

    source.addEventListener('open', () => void refresh());
    source.addEventListener('invalidate', event => {
      try {
        const invalidation = JSON.parse(event.data);
        if (invalidation?.entityType === 'receipt-extraction-job' && invalidation.entityId === jobId) {
          void refresh();
        }
      } catch {
        // Reconnect/open refresh is the recovery path for malformed or missed invalidations.
      }
    });

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void refresh();
  });
}

export async function requestAiExtractionJob(captures, signal) {
  if (signal?.aborted) throw abortError();
  const created = await api('/api/v1/receipts/extraction-jobs', {
    method: 'POST',
    body: JSON.stringify({ captures, verifyWithAi: true }),
    signal,
  });
  const jobId = created?.job?.id;
  if (typeof jobId !== 'string' || !jobId) {
    throw jobError(undefined, 'RECEIPT_EXTRACTION_JOB_INVALID');
  }
  return waitForJob(jobId, signal);
}
