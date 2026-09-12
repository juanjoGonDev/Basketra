import { api } from './api.js';
import { createAppButton, createAppDialog, createAppField } from './components.js';

const PAGE_SIZE = 6;

function closeButton(dialog) {
  const { component, button } = createAppButton({ label: 'Cerrar', variant: 'icon' });
  component.classList.add('receipt-picker__close');
  button.setAttribute('aria-label', 'Cerrar');
  button.textContent = '×';
  button.addEventListener('click', () => dialog.close());
  return component;
}

function pickerDialog({ id, title, eyebrow }) {
  document.getElementById(id)?.remove();
  const dialog = createAppDialog({ id, label: title });
  dialog.dataset.size = 'picker';
  dialog.classList.add('receipt-picker-dialog');
  const header = document.createElement('div');
  header.className = 'app-dialog-header receipt-picker__header';
  header.slot = 'header';
  const copy = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'eyebrow';
  label.textContent = eyebrow;
  const heading = document.createElement('h2');
  heading.textContent = title;
  copy.append(label, heading);
  header.append(copy, closeButton(dialog));
  dialog.append(header);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}

function pageControls({ page, total, onPage }) {
  const controls = document.createElement('app-inline');
  controls.className = 'receipt-picker__pager';
  const from = Math.min(total, page * PAGE_SIZE + 1);
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const status = document.createElement('small');
  status.textContent = total ? `${from}–${to} de ${total}` : 'Sin resultados';
  const previous = createAppButton({ label: 'Anterior', variant: 'secondary' });
  previous.button.disabled = page === 0;
  previous.button.addEventListener('click', () => onPage(page - 1));
  const next = createAppButton({ label: 'Siguiente', variant: 'secondary' });
  next.button.disabled = to >= total;
  next.button.addEventListener('click', () => onPage(page + 1));
  controls.append(status, previous.component, next.component);
  return controls;
}

function colorDot(color) {
  const dot = document.createElement('span');
  dot.className = 'receipt-picker__color';
  dot.style.backgroundColor = /^#[0-9a-f]{6}$/iu.test(color || '') ? color : 'var(--color-outline)';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function normalize(value) { return String(value || '').trim().toLocaleLowerCase('es-ES'); }

export async function openReceiptCategoryPicker({ selectedId = '', onSelect }) {
  const dialog = pickerDialog({ id: 'receipt-category-picker', title: 'Elegir categoría', eyebrow: 'Categorías' });
  const body = document.createElement('app-stack');
  body.slot = 'body';
  body.className = 'receipt-picker';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'Buscar categoría'; search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Buscar categoría');
  body.append(createAppField('Buscar', search));
  const results = document.createElement('div');
  results.className = 'receipt-picker__results';
  const error = document.createElement('p'); error.className = 'field-help'; error.hidden = true;
  body.append(results, error);
  dialog.append(body);

  const footer = document.createElement('app-inline'); footer.slot = 'footer'; footer.className = 'app-dialog-actions';
  const add = createAppButton({ label: 'Añadir categoría', variant: 'secondary' });
  add.button.addEventListener('click', () => openReceiptCategoryCreator({
    initialName: search.value,
    onCreated: category => { onSelect(category); dialog.close(); },
  }));
  footer.append(add.component); dialog.append(footer);

  let categories = []; let page = 0;
  const render = () => {
    const filtered = categories.filter(category => normalize(category.name).includes(normalize(search.value)));
    if (page * PAGE_SIZE >= filtered.length) page = 0;
    results.replaceChildren();
    for (const category of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'receipt-picker__row';
      row.setAttribute('aria-pressed', String(category.id === selectedId));
      const name = document.createElement('span'); name.textContent = category.name;
      row.append(colorDot(category.color), name);
      row.addEventListener('click', () => { onSelect(category); dialog.close(); });
      results.append(row);
    }
    results.append(pageControls({ page, total: filtered.length, onPage: next => { page = next; render(); } }));
  };
  search.addEventListener('input', () => { page = 0; render(); });
  try {
    const response = await api('/api/v1/categories');
    categories = Array.isArray(response.categories) ? response.categories : [];
    render();
  } catch {
    error.hidden = false; error.textContent = 'No se pudieron cargar las categorías.';
  }
  dialog.showModal(); dialog.focus();
}

export function openReceiptCategoryCreator({ initialName = '', onCreated }) {
  const dialog = pickerDialog({ id: 'receipt-category-create', title: 'Nueva categoría', eyebrow: 'Categorías' });
  const body = document.createElement('app-stack'); body.slot = 'body'; body.className = 'receipt-picker';
  const name = document.createElement('input'); name.maxLength = 120; name.value = initialName; name.required = true; name.autocomplete = 'off';
  const color = document.createElement('input'); color.type = 'color'; color.value = '#007a5e';
  const description = document.createElement('textarea'); description.maxLength = 500; description.rows = 3;
  const message = document.createElement('p'); message.className = 'field-help'; message.setAttribute('role', 'alert');
  body.append(createAppField('Nombre', name), createAppField('Color', color), createAppField('Descripción opcional', description), message);
  dialog.append(body);
  const footer = document.createElement('app-inline'); footer.slot = 'footer'; footer.className = 'app-dialog-actions';
  const cancel = createAppButton({ label: 'Cancelar', variant: 'secondary' }); cancel.button.addEventListener('click', () => dialog.close());
  const save = createAppButton({ label: 'Crear categoría', variant: 'primary' });
  save.button.addEventListener('click', async () => {
    if (!name.reportValidity()) return;
    save.button.disabled = true; message.textContent = '';
    try {
      const response = await api('/api/v1/categories', { method: 'POST', body: JSON.stringify({ name: name.value.trim(), color: color.value, description: description.value.trim() || undefined }) });
      if (!response?.category?.id) throw new Error('No se pudo crear la categoría');
      onCreated(response.category); dialog.close();
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'No se pudo crear la categoría.'; }
    finally { save.button.disabled = false; }
  });
  footer.append(cancel.component, save.component); dialog.append(footer);
  dialog.showModal(); dialog.focus();
}

export async function openReceiptProductPicker({ description = '', selectedId = '', categoryId = '', onSelect }) {
  const dialog = pickerDialog({ id: 'receipt-product-picker', title: 'Relacionar producto', eyebrow: 'Productos guardados' });
  const body = document.createElement('app-stack'); body.slot = 'body'; body.className = 'receipt-picker';
  const search = document.createElement('input'); search.type = 'search'; search.value = description; search.placeholder = 'Buscar producto'; search.autocomplete = 'off'; search.setAttribute('aria-label', 'Buscar producto');
  body.append(createAppField('Buscar', search));
  const results = document.createElement('div'); results.className = 'receipt-picker__results';
  const message = document.createElement('p'); message.className = 'field-help'; message.setAttribute('role', 'alert');
  body.append(results, message); dialog.append(body);
  const footer = document.createElement('app-inline'); footer.slot = 'footer'; footer.className = 'app-dialog-actions';
  const add = createAppButton({ label: 'Añadir producto', variant: 'secondary' });
  add.button.addEventListener('click', () => openReceiptProductCreator({ initialName: search.value || description, categoryId, onCreated: product => { onSelect(product); dialog.close(); } }));
  footer.append(add.component); dialog.append(footer);
  let page = 0; let request = 0;
  const load = async () => {
    const query = search.value.trim(); if (!query) { results.replaceChildren(); return; }
    const current = ++request; message.textContent = 'Buscando…';
    try {
      const response = await api(`/api/v1/catalog?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
      if (current !== request) return;
      const catalog = response.catalog || { products: [], total: 0 };
      const products = Array.isArray(catalog.products) ? catalog.products : [];
      results.replaceChildren();
      for (const product of products) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'receipt-picker__row'; row.setAttribute('aria-pressed', String(product.id === selectedId));
        const copy = document.createElement('span'); copy.textContent = product.variantName || product.canonicalName || product.name;
        const detail = document.createElement('small'); detail.textContent = product.categoryName || 'Sin categoría';
        const wrap = document.createElement('span'); wrap.append(copy, detail); row.append(wrap);
        row.addEventListener('click', () => { onSelect(product); dialog.close(); }); results.append(row);
      }
      results.append(pageControls({ page, total: Number(catalog.total || 0), onPage: next => { page = next; void load(); } }));
      message.textContent = products.length ? '' : 'No hay productos coincidentes.';
    } catch { message.textContent = 'No se pudieron cargar los productos.'; }
  };
  let timer; search.addEventListener('input', () => { page = 0; clearTimeout(timer); timer = setTimeout(() => void load(), 180); });
  await load(); dialog.showModal(); dialog.focus();
}

async function categoriesForProduct(select, selectedId) {
  const response = await api('/api/v1/categories');
  for (const category of response.categories || []) select.add(new Option(category.name, category.id, false, category.id === selectedId));
}

export function openReceiptProductCreator({ initialName = '', categoryId = '', onCreated }) {
  const dialog = pickerDialog({ id: 'receipt-product-create', title: 'Nuevo producto', eyebrow: 'Productos guardados' });
  const body = document.createElement('app-stack'); body.slot = 'body'; body.className = 'receipt-picker';
  const canonicalName = document.createElement('input'); canonicalName.maxLength = 160; canonicalName.value = initialName; canonicalName.required = true;
  const variantName = document.createElement('input'); variantName.maxLength = 160; variantName.value = initialName;
  const category = document.createElement('select'); category.append(new Option('Sin categoría', ''));
  const brand = document.createElement('input'); brand.maxLength = 120;
  const aliases = document.createElement('input'); aliases.maxLength = 500; aliases.placeholder = 'Separados por comas';
  const message = document.createElement('p'); message.className = 'field-help'; message.setAttribute('role', 'alert');
  body.append(createAppField('Nombre canónico', canonicalName), createAppField('Variante', variantName), createAppField('Categoría', category), createAppField('Marca opcional', brand), createAppField('Alias opcionales', aliases), message);
  dialog.append(body); void categoriesForProduct(category, categoryId).catch(() => { message.textContent = 'No se pudieron cargar las categorías.'; });
  const footer = document.createElement('app-inline'); footer.slot = 'footer'; footer.className = 'app-dialog-actions';
  const cancel = createAppButton({ label: 'Cancelar', variant: 'secondary' }); cancel.button.addEventListener('click', () => dialog.close());
  const save = createAppButton({ label: 'Crear y relacionar', variant: 'primary' });
  save.button.addEventListener('click', async () => {
    if (!canonicalName.reportValidity()) return;
    save.button.disabled = true; message.textContent = '';
    try {
      const response = await api('/api/v1/products', { method: 'POST', body: JSON.stringify({ canonicalName: canonicalName.value.trim(), variantName: variantName.value.trim() || canonicalName.value.trim(), ...(category.value ? { categoryId: category.value } : {}), ...(brand.value.trim() ? { brand: brand.value.trim() } : {}), aliases: aliases.value.split(',').map(value => value.trim()).filter(Boolean) }) });
      if (!response?.product?.id) throw new Error('No se pudo crear el producto');
      onCreated(response.product); dialog.close();
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'No se pudo crear el producto.'; }
    finally { save.button.disabled = false; }
  });
  footer.append(cancel.component, save.component); dialog.append(footer); dialog.showModal(); dialog.focus();
}
