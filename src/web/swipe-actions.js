const START_GUARD_PX = 24;
const INTENT_PX = 8;
const OPEN_PX = 112;
const COMPLETE_RATIO = 0.38;
const DELETE_RATIO = 0.62;
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, summary';

function rowFromTarget(target) {
  return target instanceof Element ? target.closest('[data-swipe-row]') : null;
}

function surfaceOf(row) {
  return row.querySelector('[data-swipe-surface]');
}

function setOffset(row, value) {
  const surface = surfaceOf(row);
  if (!surface) return;
  row.style.setProperty('--swipe-offset', `${value}px`);
  surface.setAttribute('aria-expanded', String(value !== 0));
}

function closeRow(row) {
  row.classList.remove('is-swiping', 'is-open-start', 'is-open-end', 'is-delete-armed');
  setOffset(row, 0);
}

function closeOtherRows(root, activeRow) {
  root.querySelectorAll('[data-swipe-row]').forEach(row => {
    if (row !== activeRow) closeRow(row);
  });
}

function dispatchAction(row, action, source) {
  row.dispatchEvent(new CustomEvent('basketra:swipe-action', {
    bubbles: true,
    detail: {
      action,
      source,
      id: row.dataset.swipeId || '',
      kind: row.dataset.swipeKind || '',
    },
  }));
}

export function bindSwipeActions(root) {
  let gesture = null;

  const onPointerDown = event => {
    if (event.button !== 0 || event.clientX < START_GUARD_PX) return;
    if (event.target.closest(INTERACTIVE_SELECTOR)) return;
    const row = rowFromTarget(event.target);
    if (!row || !surfaceOf(row)) return;
    closeOtherRows(root, row);
    gesture = {
      row,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: 0,
      horizontal: false,
    };
  };

  const onPointerMove = event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < INTENT_PX && Math.abs(deltaY) < INTENT_PX) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture = null;
        return;
      }
      gesture.horizontal = true;
      gesture.row.classList.add('is-swiping');
      surfaceOf(gesture.row)?.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const allowsStart = Boolean(gesture.row.dataset.swipeStartAction);
    const allowsEnd = Boolean(gesture.row.dataset.swipeEndAction);
    const minimum = allowsEnd ? -Math.min(220, gesture.row.clientWidth * 0.74) : 0;
    const maximum = allowsStart ? Math.min(132, gesture.row.clientWidth * 0.46) : 0;
    gesture.offset = Math.max(minimum, Math.min(maximum, deltaX));
    const deleteArmed = allowsEnd && Math.abs(gesture.offset) >= gesture.row.clientWidth * DELETE_RATIO;
    gesture.row.classList.toggle('is-delete-armed', deleteArmed);
    setOffset(gesture.row, gesture.offset);
  };

  const finishGesture = event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { row, offset, horizontal } = gesture;
    gesture = null;
    row.classList.remove('is-swiping');
    if (!horizontal) return;
    const width = row.clientWidth;
    if (offset > width * COMPLETE_RATIO && row.dataset.swipeStartAction) {
      closeRow(row);
      dispatchAction(row, row.dataset.swipeStartAction, 'gesture');
      return;
    }
    if (offset < -OPEN_PX / 2 && row.dataset.swipeEndAction) {
      row.classList.add('is-open-end');
      row.classList.remove('is-open-start');
      setOffset(row, -OPEN_PX);
      return;
    }
    closeRow(row);
  };

  const onClick = event => {
    const actionButton = event.target.closest('[data-swipe-action]');
    if (actionButton) {
      const row = rowFromTarget(actionButton);
      if (!row) return;
      const action = actionButton.dataset.swipeAction;
      if (!action) return;
      closeRow(row);
      dispatchAction(row, action, 'button');
      return;
    }
    const row = rowFromTarget(event.target);
    if (!row) closeOtherRows(root, null);
  };

  const onKeyDown = event => {
    if (event.key !== 'Escape') return;
    const row = rowFromTarget(event.target);
    if (row) {
      closeRow(row);
      surfaceOf(row)?.focus();
    } else {
      closeOtherRows(root, null);
    }
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove, { passive: false });
  root.addEventListener('pointerup', finishGesture);
  root.addEventListener('pointercancel', finishGesture);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', finishGesture);
    root.removeEventListener('pointercancel', finishGesture);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
  };
}
