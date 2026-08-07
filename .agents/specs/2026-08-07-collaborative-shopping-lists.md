# Objetivo Central

Evolucionar Basketra desde la pantalla de listas actualmente combinada a una experiencia de compra colaborativa, realtime y mobile-first para dos dispositivos que comparten la misma instalación privada y la misma base SQLite.

La lista debe convertirse en el foco visual principal. La gestión de listas, el detalle de una lista, la captura/edición de productos y la asistencia IA deben separarse en flujos claros sin sustituir la arquitectura actual ni introducir cuentas, servicios residentes, polling, brokers, frontend frameworks o procesos adicionales.

El cambio incluye frontend, backend, migraciones de base de datos, sincronización realtime, concurrencia optimista, catálogo global de productos, categorías reutilizables, historial de precios confirmado, captura de producto/precio desde fotografía, ubicación opcional, búsqueda cercana explícita mediante OpenStreetMap/Overpass y pruebas automatizadas. Cualquier especificación anterior que limitase este trabajo a frontend se considera obsoleta para este alcance.

## Evidencia de reconocimiento

- `main` inspeccionado en `93d40528fa026a91bc193b0b7e6c97a43689ab68`.
- Los únicos PRs abiertos al iniciar el trabajo son Dependabot (#5, #6 y #15); no existe un PR funcional abierto que solape materialmente este alcance.
- Schema actual al iniciar: v3. `shopping_lists` y `shopping_list_items` no tenían versión optimista; `shopping_list_items` no referenciaba `product_variants`; `canonical_products.category` seguía siendo texto libre; `stores` no tenía coordenadas.
- El servidor de aplicación y `OperationsGateway` comparten un único proceso. El gateway ya transmite las respuestas upstream con `pipe()`, por lo que SSE puede conservar streaming nativo si se allowlistean sus cabeceras necesarias.
- El heartbeat existente es una sonda de conectividad visible/oculta y debe seguir separado de la sincronización de dominio.
- `src/web/ui.js` ya posee la única implementación canónica de swipe y sus umbrales centralizados.
- `src/web/api.js` es el único cliente HTTP frontend; `state.js` es la única fuente de preferencias locales.
- `OpenAiCompatibleProvider`, `StructuredAiExecutor`, `ReceiptExtractionService` y `FileStore` son las fronteras canónicas para IA, Structured Outputs y adjuntos. El cambio reciente elimina deadlines internos de Basketra: la cancelación pertenece al caller y no debe reintroducirse un timeout paralelo.
- Presupuesto vigente: idle RSS CI 96 MiB, request RSS 144 MiB, idle CPU 1%, contenedor 192 MiB. SSE debe permanecer prácticamente inerte cuando no hay mutaciones.

# Requisitos Técnicos (RDD)

## 1. Modelo de datos y migración

1. Añadir migraciones nuevas y aditivas; no reescribir v1-v3.
2. Añadir `version INTEGER NOT NULL DEFAULT 1` a `shopping_lists` y `shopping_list_items`.
3. Añadir referencia opcional `product_variant_id` desde `shopping_list_items` a `product_variants`; los ítems existentes continúan siendo válidos sin vínculo.
4. Añadir `product_categories` como entidad plana reutilizable con `id`, `name`, descripción opcional y timestamps.
5. Añadir referencia opcional de categoría desde `canonical_products` y migrar los valores existentes de `canonical_products.category` sin perder información. La columna textual histórica no se elimina en esta migración.
6. Añadir sólo los metadatos globales con uso actual: descripción de producto y coordenadas/dirección/identidad OSM opcionales para `stores` cuando no existan.
7. Las coordenadas persistidas usarán microgrados enteros para mantener comparación determinista sin dependencia geoespacial.
8. Las observaciones de precio siguen siendo evidencia inmutable y nunca se crean por añadir/completar un ítem.

## 2. Concurrencia optimista

1. Todo edit explícito de lista o ítem incluye la versión base.
2. Un `UPDATE` debe condicionar `WHERE version = ?` e incrementar `version = version + 1` en la misma sentencia/transacción.
3. Si la versión ya cambió, el backend responde `409` con código estable y estado canónico actual suficiente para resolver el conflicto.
4. Reordenar exige `listVersion` y actualiza la versión de lista de forma transaccional; una reordenación concurrente no se sobrescribe silenciosamente.
5. Acciones simples como completar o ajustar cantidad pueden re-sincronizar y mostrar mensaje informativo ante conflicto. Los edits de campos muestran comparación.
6. «Usar mis cambios» reenvía intencionadamente el draft contra la versión canónica más reciente; no existe bypass de versión.

## 3. Realtime

1. REST permanece autoritativo para mutaciones y lecturas canónicas.
2. Exponer un único stream SSE same-origin para clientes visibles.
3. Los eventos contienen únicamente metadatos mínimos: recurso afectado, `listId`, `entityId` cuando proceda, tipo de mutación, versión y timestamp.
4. No enviar nombres de productos, precios, imágenes, tickets, coordenadas, credenciales ni payloads de dominio completos por SSE.
5. Publicar evento sólo después de commit/persistencia exitosa.
6. No persistir historial de eventos ni implementar event sourcing.
7. En reconexión, el frontend siempre re-sincroniza estado canónico por REST; no necesita replay.
8. Cerrar EventSource al ocultarse el documento; al volver visible reconectar y re-sincronizar.
9. Coalescer invalidaciones de ráfaga por lista para evitar lecturas redundantes.
10. El stream no cuenta como operación cara y no impide la liberación de caches/IA/OCR en hibernación.
11. Mantener colección acotada de clientes y retirar desconectados determinísticamente.
12. `OperationsGateway` debe propagar `text/event-stream`, `cache-control`, `connection`/cabeceras seguras pertinentes y `x-accel-buffering: no` sin acumular el cuerpo.

## 4. Arquitectura de información frontend

1. `Lists` abre una vista de overview dedicada con todas las listas, resumen pendiente/completado, última actividad, creación, renombrado, borrado y estado vacío.
2. Abrir una lista navega a una vista de detalle específica; no se renderiza automáticamente el contenido bajo el gestor.
3. El detalle usa cabecera compacta, back, título, estado realtime discreto, pendientes dominantes, completados secundarios y agrupación por categoría cuando exista.
4. El formulario permanente desaparece del layout. Añadir/editar usa un diálogo/bottom-sheet mobile-first.
5. El estado inicial de Add Product muestra sólo nombre/búsqueda y cantidad/unidad esenciales; preferencias y metadatos avanzados son divulgación progresiva.
6. La acción IA permanece visible al hacer scroll sin tapar filas ni navegación; abre sheet/dialog y produce preview editable antes de persistir.
7. No cambiar Tickets, Plans o Settings salvo navegación/estilos compartidos imprescindibles.

## 5. Catálogo global y categorías

1. Mantener la jerarquía `canonical_product -> product_variant`.
2. Un ítem puede enlazar a una variante global o seguir siendo texto libre legacy.
3. Exponer búsqueda/detalle/creación/edición mínima de producto global reutilizando FTS/aliases existentes.
4. Metadatos opcionales editables: nombre canónico, nombre de variante, categoría, descripción, brand, EAN/GTIN, package amount/unit y aliases.
5. Un match exacto persistido y una categoría confirmada se reutilizan antes de invocar IA.
6. Editar metadatos globales debe distinguirse de editar sólo la ocurrencia de la lista.

## 6. Evidencia de precio

1. Un precio confirmado requiere al menos retailer; store físico es opcional.
2. Si hay precio sin retailer, guardar el producto/ítem pero no crear `price_observation` y explicar el motivo en UI.
3. Confirmar precio crea/resuelve variante, retailer, listing, store opcional, evidencia y observación inmutable dentro de una operación transaccional.
4. Corregir un precio crea nueva observación; nunca actualiza una observación histórica.
5. IA nunca fabrica ni confirma un precio.

## 7. Captura de producto/precio mediante foto

1. Crear un flujo ligero separado del UI completo de tickets.
2. Reutilizar `FileStore`, validación existente, input con `capture="environment"`, galería, adjuntos del proveedor y `StructuredAiExecutor`.
3. La imagen se almacena/valida antes del análisis; IA recibe el adjunto original cuando la capacidad esté disponible.
4. La salida Structured Output contiene sólo campos opcionales detectados: producto/variante, brand, EAN, categoría, descripción, package, cantidad, precio, retailer/store, confidence y warnings.
5. La salida se valida localmente y se muestra como proposal editable. Cancelar no persiste dominio ni evidencia de precio.
6. Confirmar es la única transición que persiste catálogo/lista/precio.
7. Fallo o ausencia de IA mantiene disponible el flujo manual.

## 8. Ubicación y tiendas

1. Geolocalización está OFF por defecto y sólo se solicita mediante acción explícita.
2. La app completa funciona sin permiso, sin secure context o con geolocalización ausente.
3. Primero comparar localmente la posición con tiendas guardadas mediante distancia Haversine determinista sobre microgrados.
4. No registrar coordenadas exactas en logs ni guardarlas en localStorage.
5. Si no hay match local útil, ofrecer «Buscar tiendas cercanas» como acción explícita.
6. La consulta externa usa endpoint Overpass administrativamente confiable y fijo/configurado; el cliente no proporciona base URL arbitraria.
7. Consulta acotada, cancellable, una a la vez, con radio/límite estrictos y sin CI contra infraestructura pública.
8. Candidatos OSM no se persisten hasta confirmación y la UI muestra atribución OpenStreetMap.
9. No usar geocoder autocomplete comunitario, Google Places, Mapbox ni IA como fuente geográfica.
10. `Permissions-Policy` permite `geolocation=(self)` sin debilitar cámara/CSP; HTTP privado sigue operativo y sólo se deshabilita la capacidad dependiente de secure context.

## 9. Swipe y accesibilidad

1. `ui.js` sigue siendo el único owner de swipe y umbrales.
2. Derecha: completar/restaurar.
3. Izquierda corta/media: revelar Edit/Delete moviendo físicamente la fila.
4. Izquierda hasta umbral destructivo: estado destructivo y delete al soltar con Undo.
5. Mantener botones equivalentes para teclado, lector de pantalla, tap/pointer simple y controles de reordenado.
6. Mantener `prefers-reduced-motion`, foco visible, labels, diálogos con foco predecible y targets táctiles.

## 10. Contratos API previstos

- `GET /api/v1/realtime` — stream SSE de invalidación.
- `GET /api/v1/shopping-lists` — incluye resumen y `version`.
- `GET /api/v1/shopping-lists/:id` — lista e ítems con versiones y vínculo/catalog metadata suficiente para render.
- `PATCH /api/v1/shopping-lists/:id` — exige `version`.
- `PATCH /api/v1/shopping-lists/:id/items/:itemId` — exige `version` para edit explícito; respuesta 409 estable en stale write.
- `PUT /api/v1/shopping-lists/:id/items/order` — exige `listVersion`.
- Endpoints mínimos de catálogo/categorías/precio/store se añadirán sobre los repositorios existentes, sin crear API paralela.
- Operación photo proposal reutiliza el proveedor IA existente y nunca persiste por sí misma.
- Nearby-store lookup sólo acepta coordenadas/radio/límite validados; endpoint externo proviene de configuración administrativa.

## 11. Pruebas de aceptación

- Migración v3 -> nueva versión preserva ítems legacy y texto de categoría; version fields empiezan en 1.
- Unit/integration: CAS de versiones, reorder conflict, category migration, variant linkage, store coordinates, price evidence e inmutabilidad.
- API: SSE, invalidaciones, 409 con estado canónico, retry intencional, catálogo, category edit, photo proposal, manual fallback, ubicación y external failure.
- Playwright obligatorio con dos contextos móviles independientes contra backend real: add, complete, concurrent edit conflict, resolución y convergencia sin reload/polling.
- Playwright móvil: overview, detalle, add sheet, category grouping, swipe reveal/delete/Undo, AI siempre alcanzable, focus/keyboard y overflow.
- Photo/location: fixtures locales deterministas; nunca proveedor de pago ni OSM público en CI.
- Viewports: 320, 375/390, 430 y un ancho desktop/tablet.
- `pnpm quality`, `pnpm resource:measure`, security y Docker checks aplicables permanecen bloqueantes.

# Restricciones de Agente

- No introducir cuentas, multi-tenant, Redis, broker, WebSocket/Socket.IO, microservicio, ORM, framework frontend, worker OCR/IA residente o polling de dominio.
- No reimplementar cliente HTTP, money, swipe, FileStore, AI provider, Structured AI executor, heartbeat o matching exacto ya existente.
- No aceptar URLs arbitrarias de Overpass/servicios externos desde el navegador.
- No registrar imágenes, receipt/product payloads completos, coordenadas exactas, respuestas externas crudas, secretos o rutas filesystem.
- No debilitar budgets, coverage, lint, typecheck, dead-code, security o CI.
- No modificar migraciones aplicadas ni destruir columnas/datos existentes.
- No realizar merge, release, deployment, publicación, migración remota, secret rotation ni cambios sobre Raspberry.
- Mantener cambios reversibles y mínimos; no refactorizar áreas no necesarias.
- Si durante implementación aparece un conflicto arquitectónico o de seguridad no visible en el reconocimiento inicial, documentarlo y detener el cambio irreversible asociado.

# Lista de Tareas (Task List)

## Reconocimiento y especificación

- [x] Inspeccionar `main`, PRs abiertos, `AGENTS.md`, `spec.md`, arquitectura, seguridad, presupuesto, schema, listas, API, frontend, swipe, IA y gateway.
- [x] Confirmar schema v3 y ausencia de PR funcional solapado.
- [x] Definir realtime, conflictos, catálogo, evidencia de precio, foto y ubicación.
- [x] Actualizar `spec.md` canónico en español.

## Persistencia y dominio

- [x] Añadir migraciones aditivas para versiones, categorías, vínculo de variante, metadatos y store coordinates.
- [x] Implementar CAS de lista/ítem y reorder.
- [x] Implementar operaciones de catálogo/categoría/store/precio reutilizando entidades existentes.
- [x] Añadir cálculos puros de distancia/local-store ranking donde corresponda.
- [x] Añadir pruebas de migración y dominio antes de integrar API.

## API y realtime

- [x] Implementar broadcaster SSE acotado y lifecycle seguro.
- [x] Emitir invalidaciones sólo tras persistencia exitosa.
- [x] Añadir conflictos 409 estables.
- [x] Añadir operaciones de catálogo/precio/photo proposal/location.
- [x] Hacer que `OperationsGateway` transmita SSE sin buffering.
- [x] Mantener SSE fuera de expensive-operation/hibernation blockers.
- [x] Añadir integration tests de los contratos.

## Frontend

- [x] Separar overview y detail de listas.
- [x] Sustituir composer permanente por sheet/dialog compacto.
- [x] Mantener AI action visible y proposal editable.
- [x] Añadir EventSource visibility-aware con resync/coalescing.
- [x] Añadir conflicto comparativo y retry intencional.
- [x] Añadir category grouping y affordance de edición global.
- [x] Añadir captura de foto/precio y ubicación opt-in/local-first/Overpass explícito.
- [x] Conservar swipe canónico y accesibilidad.

## Validación

- [x] Añadir unit/integration/E2E/backend API deterministas.
- [x] Añadir Playwright con dos contextos móviles contra el mismo backend.
- [x] Añadir Playwright 320/390/430/desktop y evidencia visual.
- [x] Cubrir keyboard/focus/reduced motion con controles equivalentes y pruebas existentes.
- [ ] Confirmar `pnpm quality` verde en el head final del PR.
- [ ] Confirmar `pnpm resource:measure` verde en el head final del PR.
- [ ] Confirmar Docker smoke/build verde en el head final del PR.
- [ ] Confirmar security/dead-code/dependency gates verdes en el head final del PR.
- [x] Revisar los cambios sin introducir secretos reales ni coordenadas reales.
- [x] Abrir PR #19 no draft sin merge.

## Rollback

El rollback de código consiste en revertir el PR. Las migraciones son aditivas y no se reescriben ni se revierten destructivamente; las columnas/tablas nuevas pueden quedar sin consumidores si el código se revierte. No se realizará rollback remoto de datos ni de schema como parte de esta tarea.

## Estado

Implementación funcional completada en el PR #19. La entrega permanece sin merge, release, despliegue ni migración remota. La validación final se determina exclusivamente por los checks bloqueantes de GitHub Actions sobre el head del PR; este documento no fija conclusiones efímeras de CI para evitar un commit documental posterior que invalide un head ya verificado.
