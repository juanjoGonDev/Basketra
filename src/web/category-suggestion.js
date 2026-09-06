import { api, setBusy } from './api.js';

function resolveElement(value) {
  return typeof value === 'function' ? value() : value;
}

function fieldValue(field, element) {
  if (typeof field.value === 'function') return field.value();
  return String(element?.value ?? '').trim();
}

function clearControl(control, invalidControls) {
  if (!control || !invalidControls.has(control)) return;
  control.setCustomValidity?.('');
  control.removeAttribute?.('aria-invalid');
  invalidControls.delete(control);
}

export function bindCategorySuggestion({
  button,
  status,
  select,
  surface,
  requiredFields,
  watch = [],
  buildPayload,
  request = (payload, signal) => api('/api/v1/categories/suggest', {
    method: 'POST',
    signal,
    body: JSON.stringify(payload),
  }),
}) {
  if (!button || !status || !select) throw new Error('Category suggestion controls are required');

  let generation = 0;
  let controller = null;
  const invalidControls = new Set();

  const clearValidation = () => {
    for (const control of [...invalidControls]) clearControl(control, invalidControls);
    for (const field of requiredFields) {
      if (field.errorElement) field.errorElement.textContent = '';
    }
  };

  const invalidate = ({ clearStatus = true } = {}) => {
    generation += 1;
    controller?.abort();
    controller = null;
    setBusy(button, false);
    if (clearStatus) status.textContent = '';
  };

  const reset = () => {
    invalidate();
    clearValidation();
  };

  const validate = () => {
    clearValidation();
    let firstInvalid = null;
    for (const field of requiredFields) {
      const element = resolveElement(field.element);
      const value = fieldValue(field, element);
      const valid = field.isValid ? field.isValid(value, element) : Boolean(String(value).trim());
      if (valid) continue;
      const message = field.message || 'Completa este campo antes de pedir una sugerencia.';
      element?.setCustomValidity?.(message);
      element?.setAttribute?.('aria-invalid', 'true');
      if (element) invalidControls.add(element);
      if (field.errorElement) field.errorElement.textContent = message;
      firstInvalid ??= element;
    }
    if (!firstInvalid) return true;
    status.textContent = 'Completa los campos marcados antes de consultar la IA.';
    firstInvalid.focus?.();
    firstInvalid.reportValidity?.();
    return false;
  };

  const run = async () => {
    invalidate({ clearStatus: false });
    clearValidation();
    if (!validate()) return;

    let payload;
    try {
      payload = { surface, ...buildPayload() };
    } catch {
      status.textContent = 'Revisa los datos del producto antes de consultar la IA.';
      return;
    }
    const signature = JSON.stringify(payload);
    const requestGeneration = generation;
    const nextController = new AbortController();
    controller = nextController;
    setBusy(button, true);
    status.textContent = 'Buscando una categoría existente…';

    try {
      const result = await request(payload, nextController.signal);
      if (nextController.signal.aborted || requestGeneration !== generation) return;
      let currentSignature = '';
      try {
        currentSignature = JSON.stringify({ surface, ...buildPayload() });
      } catch {
        return;
      }
      if (currentSignature !== signature) return;

      const categoryId = result?.categoryId;
      if (categoryId === null || categoryId === undefined || categoryId === '') {
        status.textContent = 'No hay una categoría existente con coincidencia suficiente.';
        return;
      }
      if (typeof categoryId !== 'string') {
        status.textContent = 'La IA no devolvió una categoría válida.';
        return;
      }
      const option = [...select.options].find((candidate) => candidate.value === categoryId);
      if (!option) {
        status.textContent = 'La categoría sugerida ya no está disponible.';
        return;
      }
      select.value = categoryId;
      status.textContent = `Categoría sugerida: ${option.textContent || categoryId}. Revisa y guarda cuando quieras.`;
    } catch (error) {
      if (error?.name === 'AbortError' || requestGeneration !== generation) return;
      status.textContent = 'No se pudo sugerir una categoría. Puedes elegirla manualmente.';
    } finally {
      if (requestGeneration === generation) {
        controller = null;
        setBusy(button, false);
      }
    }
  };

  button.addEventListener('click', () => void run());
  const watched = new Set([
    ...watch.map(resolveElement).filter(Boolean),
    select,
  ]);
  for (const element of watched) {
    const onEdit = () => {
      invalidate();
      clearValidation();
    };
    element.addEventListener('input', onEdit);
    element.addEventListener('change', onEdit);
  }

  return { reset, abort: invalidate };
}
