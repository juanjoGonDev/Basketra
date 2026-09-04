const DEFAULT_SELECTION_LIMIT = 500;

export function createPagedSelection({ limit = DEFAULT_SELECTION_LIMIT } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Selection limit must be a positive integer');
  const selected = new Set();

  function normalize(id) {
    const value = String(id || '').trim();
    if (!value) throw new TypeError('Selection id is required');
    return value;
  }

  return {
    has(id) {
      return selected.has(String(id));
    },
    set(id, checked) {
      const value = normalize(id);
      if (!checked) {
        selected.delete(value);
        return;
      }
      if (!selected.has(value) && selected.size >= limit) throw new RangeError(`Selection is limited to ${limit} items`);
      selected.add(value);
    },
    toggle(id) {
      const value = normalize(id);
      this.set(value, !selected.has(value));
      return selected.has(value);
    },
    clear() {
      selected.clear();
    },
    values() {
      return [...selected];
    },
    get size() {
      return selected.size;
    },
    pageState(ids) {
      const pageIds = [...new Set(ids.map(id => normalize(id)))];
      const selectedOnPage = pageIds.filter(id => selected.has(id)).length;
      return {
        selectedOnPage,
        pageSize: pageIds.length,
        allSelected: pageIds.length > 0 && selectedOnPage === pageIds.length,
        someSelected: selectedOnPage > 0 && selectedOnPage < pageIds.length,
        selectedOutsidePage: selected.size - selectedOnPage,
      };
    },
    setPage(ids, checked) {
      const pageIds = [...new Set(ids.map(id => normalize(id)))];
      if (checked) {
        const additional = pageIds.filter(id => !selected.has(id)).length;
        if (selected.size + additional > limit) throw new RangeError(`Selection is limited to ${limit} items`);
        for (const id of pageIds) selected.add(id);
        return;
      }
      for (const id of pageIds) selected.delete(id);
    },
  };
}
