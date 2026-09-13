import assert from 'node:assert/strict';
import test from 'node:test';

import { capturesByKeys } from '../../src/web/receipt-job-scope.js';

test('receipt jobs keep their submitted capture order and never fall back to completed captures', () => {
  const completed = { storageKey: 'completed.png', name: 'completed.png' };
  const queued = { storageKey: 'queued.pdf', name: 'queued.pdf' };

  assert.deepEqual(capturesByKeys([completed, queued], ['queued.pdf']), [queued]);
  assert.deepEqual(capturesByKeys([completed, queued], []), [completed, queued]);
  assert.deepEqual(capturesByKeys([completed], ['queued.pdf']), []);
});
