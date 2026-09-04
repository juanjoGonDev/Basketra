# Objetivo Central

Basketra es una aplicación privada, personal y mobile-first para convertir tickets físicos o digitales en observaciones históricas de precios, mantener listas de compra completas y comparar planes de compra verificables. Se ejecuta como un único proceso Node.js con SQLite en una Raspberry Pi ARM64 y se accede mediante una frontera de infraestructura privada.

Incluye captura o importación de imágenes/PDF, preservación de evidencias, OCR local para imágenes mediante proveedor sustituible y de carga efímera, revisión humana mediante filas editables, listas colaborativas realtime con sugerencias locales, integración opcional con proveedores compatibles con OpenAI, matching determinista, normalización exacta de precios, optimización de cesta y operaciones privadas de diagnóstico, logs, backup, restore y versión.

No es un SaaS multi-tenant, marketplace, red social, servicio de entrega, comprador automático ni plataforma de scraping masivo. No expone el servicio públicamente por defecto. No asume que Prime implica envío gratuito ni presenta precios generados por IA sin evidencia.

Suposiciones explícitas: una única instalación personal compartida por los dispositivos autorizados del perímetro privado; EUR y formato `es-ES`; acceso por loopback, VPN, túnel SSH, LAN revisada o proxy privado autenticado; Node.js 22.23.1; almacenamiento persistente montado; credenciales de proveedores opcionales por entorno. No objetivos: autenticación interna, autenticación federada, multi-tenant, pagos, ejecución distribuida y procesos residentes pesados.

# Requisitos Técnicos (RDD)

## Reglas de negocio

- El dinero se representa en unidades menores enteras y nunca con aritmética binaria en coma flotante.
- La interfaz presenta y acepta importes en euros con dos decimales; nunca exige al usuario introducir enteros en céntimos.
- Las cantidades normalizadas se representan mediante fracciones enteras reducidas.
- Una observación de precio es inmutable; un cambio crea una observación nueva.
- Añadir, completar o restaurar un producto de una lista no crea una observación de precio si no existe precio real confirmado con retailer.
- El matching prioriza EAN/GTIN, SKU, alias confirmado, mapeo histórico, atributos deterministas, similitud léxica, reranking IA y confirmación humana.
- Las salidas IA se validan localmente antes de persistirlas o mostrarlas como estructuradas.
- La IA nunca recibe capacidad directa de persistencia. Las propuestas de producto, precio y tienda requieren revisión y confirmación; las propuestas de categoría validadas y referenciadas por una clasificación de ticket sólo pueden materializarse en servidor mediante `CategoryRepository` antes de exponer el resultado completado.
- Las ofertas conservan fuente, momento de observación, confianza, stock, condiciones y transporte.
- Prime sólo reduce transporte a cero con evidencia vigente o regla confirmada por el usuario.
- La optimización es determinista y evalúa subconjuntos de retailers mientras el tamaño sea pequeño.
- Eliminar una captura de un borrador no elimina la evidencia física almacenada sin demostrar que no está referenciada.

## Frontera de acceso

- Basketra no tiene token interno, sesión ni pantalla de login.
- El bind por defecto es `127.0.0.1`; Docker publica en loopback por defecto.
- El acceso remoto soportado termina en VPN, túnel SSH, firewall LAN revisado o proxy privado con autenticación y TLS.
- La exposición directa a Internet no está soportada.
- Cualquier actor con conectividad HTTP a Basketra se considera plenamente autorizado para listas, tickets, diagnósticos, logs, backups y restore.
- La aplicación completa debe seguir funcionando sobre HTTP privado. Las capacidades de navegador que requieran secure context, como geolocalización en navegadores móviles normales, se degradan de forma localizada sin bloquear el resto del producto.

## Navegación web y estado de vista

- Las vistas navegables usan rutas same-origin limpias y canónicas; la navegación normal no depende de fragmentos `#`.
- El detalle de entidades se expresa en segmentos de path y el estado recuperable de la vista —pestaña, subvista de edición, página, búsqueda, filtros, orden y periodo— se expresa mediante query params acotados. Los valores por defecto se omiten de las URLs generadas.
- La selección explícita para acciones masivas, los formularios sin guardar y los diálogos de confirmación son estado transitorio y no se restauran desde la URL para evitar repetir acciones peligrosas o revivir borradores obsoletos.
- Un GET directo de cualquier ruta de aplicación conocida sirve el shell; rutas desconocidas, assets no permitidos y rutas API conservan su resolución explícita y fallan cerradas cuando no existen.
- El bootstrap aplica la ruta solicitada antes de revelar el contenido principal, de modo que una recarga profunda no muestra primero Inicio ni otra vista por defecto.
- Atrás/Adelante rehidrata la ruta y sus query params mediante `popstate` sin crear otra entrada. La búsqueda incremental usa `replaceState`; navegación comprometida, pestañas, paginación, filtros y detalles usan `pushState`.
- Los hashes de versiones anteriores sólo se aceptan como entrada de compatibilidad y se reemplazan inmediatamente por la URL limpia equivalente.
- Páginas, enums y texto procedentes de la URL se validan y acotan antes de alcanzar las consultas remotas; valores inválidos degradan al estado canónico por defecto.

## Flujos verificables

### Listas de compra

1. La entrada `Listas` abre una vista de gestión dedicada con todas las listas, resumen útil, creación, renombrado, borrado y estado vacío; no muestra automáticamente el contenido de una lista bajo el gestor.
2. Abrir una lista navega a una vista de detalle dedicada con cabecera compacta, back, título, estado realtime discreto, pendientes prioritarios y completados secundarios.
3. Añadir y editar productos, cantidad, unidad y preferencias exacto/sustitución mediante un diálogo/bottom-sheet compacto; el formulario completo no ocupa permanentemente la pantalla.
4. La captura rápida empieza con los campos mínimos y revela metadatos avanzados progresivamente.
5. Incrementar o reducir cantidades dentro de límites validados.
6. Marcar y desmarcar productos como comprados, preservando fecha de finalización cuando aplica.
7. Reordenar mediante un orden completo, único y transaccional protegido por versión de lista.
8. Mantener posiciones contiguas después de borrar.
9. Separar visualmente pendientes y completados y agrupar por categoría cuando exista metadata confirmada.
10. Preservar lista activa y borrador local apropiado tras recarga, sin convertir localStorage en fuente de verdad compartida.
11. Obtener sugerencias locales sin IA y cancelar respuestas obsoletas.
12. En móvil, deslizar a la derecha marca o desmarca como comprado.
13. Un desplazamiento corto a la izquierda mueve físicamente la fila y revela editar/eliminar.
14. Continuar hasta el umbral rojo elimina al soltar y ofrece Deshacer inmediatamente.
15. Los gestos tienen botones equivalentes para puntero simple, teclado y tecnología asistida; el borrado mediante botón conserva confirmación.
16. Una acción IA compacta permanece accesible al hacer scroll y abre un diálogo/sheet con texto o imagen; la respuesta es siempre una propuesta editable previa a persistencia.
17. Dos dispositivos visibles conectados a la misma instalación reciben invalidaciones realtime sin polling ni recarga manual y convergen releyendo el estado canónico por REST.
18. Una edición explícita basada en una versión obsoleta recibe `409` y muestra comparación entre cambios locales y estado remoto; «Usar mis cambios» reintenta intencionadamente contra la versión actual.
19. Una reordenación concurrente no sobrescribe silenciosamente otro orden.

### Productos, categorías, precios y tiendas

1. `canonical_products` y `product_variants` siguen siendo el catálogo global; un `shopping_list_item` puede enlazar a una variante global sin dejar de aceptar ítems legacy sólo con texto.
2. Las categorías son entidades reutilizables persistidas con jerarquía padre-hijo acíclica de profundidad arbitraria, color canónico y fallback protegido `category_unknown` / `desconocido`. Los valores históricos y relaciones de producto se migran sin pérdida ni borrado prematuro.
3. El usuario puede editar metadata global aplicable: nombre canónico, variante, categoría, descripción, marca, EAN/GTIN, package y aliases; todos los campos no esenciales siguen siendo opcionales.
4. Un match exacto y una categoría confirmados se reutilizan antes de solicitar IA.
5. Una observación de precio sólo nace de evidencia confirmada: foto, ticket, entrada manual u otra fuente soportada explícitamente.
6. Un precio confirmado requiere retailer. La tienda física es opcional; si falta retailer, el producto/list item puede guardarse pero el precio no entra en historial.
7. Confirmar un precio resuelve/crea variante, retailer, listing, tienda opcional, evidencia y observación inmutable.
8. Corregir un precio crea una observación nueva y nunca sobrescribe evidencia histórica.
9. La ubicación es opt-in, nunca se solicita en carga ni al abrir el sheet de producto.
10. La selección de tienda usa primero retailers/stores guardados, observaciones previas y distancia determinista a stores conocidos.
11. Si no hay match local útil, el usuario puede iniciar explícitamente una búsqueda cercana basada en OpenStreetMap/Overpass, acotada, cancelable, de baja frecuencia y sin APIs de pago.
12. Los resultados externos no se persisten hasta confirmación y la UI muestra atribución OpenStreetMap.
13. La IA no inventa negocios ni coordenadas y no sustituye la verdad geográfica determinista.

### Captura rápida de producto/precio

1. Hacer foto con hint de cámara trasera o elegir imagen existente.
2. Validar y almacenar mediante el `FileStore` existente.
3. Reutilizar el proveedor IA, adjuntos y `StructuredAiExecutor` existentes cuando estén configurados; la ausencia de IA mantiene disponible el flujo manual.
4. La salida estructurada puede proponer, sólo si se detecta: producto/variante, brand, EAN, categoría, descripción, package, cantidad, precio, retailer, store, confidence y warnings.
5. La salida se valida localmente y se presenta en preview editable.
6. Cancelar el preview no persiste producto, precio, retailer, store ni observación.
7. Confirmar es la única transición que persiste datos derivados de la propuesta.
8. Un precio incierto nunca se confirma silenciosamente ni se inventa.

### Tickets

1. Abrir la cámara trasera cuando el navegador lo permita o usar selector de archivos como fallback.
2. Seleccionar imágenes JPEG/PNG o PDF mediante controles separados.
3. Validar tipo, tamaño, base64, firma real y clave de almacenamiento.
4. Mostrar miniaturas persistentes de imágenes y alternativa accesible para PDF.
5. Reordenar o retirar capturas del borrador sin borrar evidencia persistente.
6. Extraer JPEG/PNG con OCR local español sin proveedor externo; PDF usa proveedor compatible o revisión manual.
7. Mantener el borrador ante fallo de OCR o IA.
8. Presentar cada producto como una fila editable con descripción, cantidad, precio unitario y total en euros.
9. Permitir añadir, editar y retirar filas sin depender de un textarea de transcripción como interfaz principal.
10. Validar aritmética y confirmar de forma idempotente.
11. Preservar capturas, extracción original y correcciones.
12. En móvil, un gesto corto a la izquierda revela edición/borrado; continuar al umbral destructivo elimina al soltar y ofrece Deshacer.
13. Mantener botones accesibles y confirmación explícita cuando el borrado se ejecuta mediante botón.

### Comparación y operación

1. Normalizar ofertas y generar planes `single-retailer`, `balanced` y `maximum-saving`.
2. Crear una copia SQLite portable y decidir después si se descarga.
3. Descargar backups mediante streaming y cabeceras de attachment/no-store.
4. Importar bases `.db` mediante streaming a disco, con memoria constante, límite de 512 MiB, digest, integridad y esquema compatibles.
5. Preparar restore sólo tras confirmación exacta, creando un backup previo y aplicando el reemplazo antes de abrir SQLite durante el siguiente arranque.
6. Conservar la base activa y apartar el marcador si el restore falla, evitando bucles de reinicio.
7. Migrar antes de readiness con backup validado y transacción completa.
8. Mostrar versión desplegada, revisión, inicio y uptime en tiempo real derivado localmente.
9. Mostrar logs estructurados y acotados de cliente/servidor sin contenido sensible.
10. Diferenciar proveedor IA ausente, configurado con loopback incorrecto en Docker, inalcanzable, no autorizado, lento o disponible.
11. Recuperar el estado conectado tras volver la VPN mediante heartbeat adaptativo, sin depender de eventos `online` ni de recargar.
12. Cancelar operaciones caras o resultados obsoletos.

## Sincronización realtime y concurrencia

- REST continúa siendo autoritativo para toda mutación y lectura canónica.
- SSE same-origin transmite sólo invalidaciones mínimas: entidad/tipo de mutación, list id, entity id cuando aplique, versión y timestamp.
- SSE no incluye nombres de productos, precios, tickets, imágenes, coordenadas ni credenciales.
- No existe polling de dominio, event sourcing ni historial persistido de eventos; una reconexión ejecuta resync canónico.
- El cliente mantiene un stream mientras el documento está visible, lo cierra al ocultarse y reconecta/re-sincroniza al volver visible.
- Ráfagas de eventos se coalescen para evitar lecturas repetidas.
- El stream no cuenta como operación cara ni impide hibernación de caches/proveedores.
- Los clientes SSE están acotados y se eliminan al desconectar.
- `OperationsGateway` debe transmitir `text/event-stream` de forma incremental y permitir las cabeceras mínimas para evitar buffering, sin acumular el cuerpo.
- `shopping_lists` y `shopping_list_items` usan versión entera explícita. Las escrituras CAS incrementan versión en la misma transacción.
- Un stale edit explícito responde `409` con código estable y el estado canónico actual suficiente para resolución.
- Reordenar exige versión de lista y no aplica si otro cliente ya cambió el orden.

## Modelo de datos

La migración inicial crea retailers, stores, canonical_products, product_variants, product_aliases, retailer_listings, price_observations, external_evidence, receipts, receipt_captures, receipt_extractions, receipt_items, receipt_corrections, shopping_lists, shopping_list_items, optimization_runs, optimization_plans, optimization_plan_items, ai_provider_configurations, ai_executions y ocr_executions.

La migración 2 registra backups previos a migraciones. La migración 3 añade `completed` y `completed_at` a productos de listas. La migración 4 añade el versionado colaborativo, la relación opcional con variantes, la base persistida de categorías reutilizables y la localización opcional de stores. Las migraciones 5 y 6 añaden el estado durable de extracción de tickets; la migración 7 proyecta líneas confirmadas al catálogo y a observaciones de precio sin reescribir evidencia. La migración 8 crea `runtime_settings` para la configuración persistida de la instancia. La migración 9 extiende categorías con `parent_id` y `color`, persiste `receipt_items.category_id` y materializa el fallback desconocido cuando falta. La migración 10 normaliza cualquier `desconocido` legacy al id estable `category_unknown` y retargeta en la misma transacción las referencias de categorías hijas, productos canónicos e ítems de ticket. La migración 11 añade a los tickets históricos la relación con Store, estado/método de pago, notas, impuestos y descuento de ticket, y añade unidad y descuento tipado a sus líneas junto con los índices de consulta de Inventario. Las migraciones aplicadas no se reescriben. Se habilitan claves foráneas, WAL, busy timeout, índices y FTS5.

## Persistencia, archivos y recuperación

- SQLite `basketra.db`, timestamps UTC y migraciones explícitas.
- Importación de ticket en una transacción.
- Listas modificadas mediante transacciones acotadas para cantidades, completado, borrado y orden.
- Las mutaciones colaborativas publican invalidación únicamente después de persistencia exitosa.
- Ficheros con nombre generado, validación de magic bytes, SHA-256, deduplicación y separación temporal/permanente.
- Las previews aceptan exclusivamente claves generadas de imagen, usan same-origin y `Cache-Control: private, no-store`.
- PDF no se sirve por el endpoint de preview de imagen.
- Nunca se exponen rutas del sistema ni se cachean capturas o respuestas `/api/` en el service worker.
- Los backups manuales se crean como SQLite portable y se descargan por streaming.
- Los imports de restore se escriben por streaming con permisos `0600`, límite durante lectura, hash incremental, validación y rename atómico.
- El restore nunca reemplaza una base abierta: se registra una intención atómica y se aplica durante startup antes de construir `BasketraDatabase`.
- Un backup previo válido es requisito de restore y un marcador fallido impide reintentos destructivos infinitos.
- El restore de base no sustituye automáticamente `/data/files`; una recuperación completa debe preservar ambas fuentes compatibles.

## Fuentes únicas de verdad

- Unidades: `UNIT_VALUES` en dominio.
- Tipos de archivo: `SUPPORTED_FILE_MIME_TYPES` en `FileStore`.
- Límites de archivo: configuración backend expuesta por `/api/v1/meta`.
- Límites SQLite y backup: `DEFAULT_DATABASE_STORAGE_LIMITS`.
- Claves persistentes frontend: módulo `state.js`.
- Cliente HTTP frontend: módulo `api.js`.
- Conversión y formato EUR de la interfaz: funciones canónicas de `ui.js`; el backend conserva unidades menores enteras.
- Gestos móviles: un único componente reutilizable de swipe en `ui.js`; las features consumen sus acciones y no reimplementan umbrales.
- Categorías: `CategoryRepository` es el owner canónico de identidad, jerarquía, color, fallback protegido y materialización validada; API, catálogo y clasificación de tickets delegan en él.
- Operaciones transversales: `OperationsGateway`; no se duplican en el servidor de dominio ni en el navegador.
- Logs y redacción: `ApplicationLogStore` y `sanitizeClientLog`.
- Import/restore: `operations/restore.ts`.
- Versión runtime: `operations/version.ts`; asignación de releases: `scripts/release-version-policy.mjs`.
- Validaciones autoritativas: backend; las validaciones de navegador son preventivas, no de seguridad.
- Sincronización compartida: backend/SQLite es autoritativo; SSE sólo invalida y nunca sustituye una lectura canónica.
- Metadata global de productos/categorías confirmada se reutiliza antes de ejecutar IA.

## OCR e IA

- `OcrProvider` y `AiProvider` son contratos neutrales.
- JPEG y PNG usan por defecto Tesseract 5 local con modelo español rápido incluido en la imagen ARM64/AMD64.
- Tesseract se ejecuta sin shell, con argumentos fijos, un hilo OpenMP, una única operación simultánea, timeout, cancelación y límites de salida.
- No existe worker OCR residente; el proceso nace durante la petición y se libera al terminar.
- El contenido del ticket, salida OCR, nombre de archivo, rutas y errores crudos del proceso no se registran.
- The generic AI executor centralizes caller cancellation, capability selection, validation, bounded retries, redaction, and stable errors without imposing a product deadline. Receipt verification owns one separate five-minute total budget across OCR, queue wait, ordered pages, provider calls, retries, and continuation; expiry preserves OCR/manual recovery and surfaces `AI_RECEIPT_TIMEOUT`.
- La verificación IA de tickets recibe un snapshot compacto y persistido del inventario de categorías. Su salida estructurada requiere `items[].categoryId` y `newCategories`; sólo las propuestas referenciadas y sus ancestros se resuelven en servidor, y referencias inválidas degradan a `category_unknown` sin perder la extracción.
- La URL del proveedor procede exclusivamente de configuración administrativa; no se acepta por petición.
- En Docker, `127.0.0.1` apunta al contenedor Basketra. Un proveedor del host usa `host.docker.internal` con mapeo explícito al host gateway.
- Cambiar `.env` requiere validar Compose y recrear el contenedor; la aplicación no finge que una configuración no inyectada está activa.
- La IA es opcional para verificar OCR, ayudar con listas o procesar PDF/fotos de producto cuando el proveedor lo soporte.
- La ausencia o fallo de IA no bloquea OCR local de imágenes, corrección, validación, listas ni captura manual de productos.
- El OCR local no rasteriza PDF; se mantiene el proveedor sustituible y la edición manual como rutas explícitas.

## Ubicación y servicios externos

- Geolocalización está desactivada hasta acción explícita del usuario y nunca se solicita en page load ni por abrir un diálogo.
- Las coordenadas actuales no se escriben en localStorage ni logs.
- Stores persistidos pueden conservar coordenadas mediante enteros deterministas de microgrados y metadata mínima de dirección/OSM.
- La selección local calcula distancia sobre el conjunto pequeño de stores guardados; no usa base geoespacial.
- Búsqueda externa cercana sólo se inicia manualmente y utiliza OpenStreetMap/Overpass mediante endpoint administrativo confiable, consulta acotada, una a la vez y cancelable.
- El navegador no puede proporcionar un base URL arbitrario para servicios externos.
- CI usa endpoint fake local determinista y nunca infraestructura pública OSM.
- La UI muestra atribución OpenStreetMap cuando presenta resultados externos.
- En HTTP/insecure context se deshabilita sólo ubicación y se explica que HTTPS local mediante proxy privado puede habilitarla; selección manual de retailer/store sigue disponible.

## Observabilidad y conectividad

- Los errores HTTP tienen `requestId`; los fallos inesperados mantienen una referencia correlacionable.
- El stream de aplicación es NDJSON persistente y admite `source=server|client`.
- Rotación por defecto: 10.000 líneas o 40 MiB por fichero activo, tres ficheros máximos, eliminando el más antiguo primero.
- Los eventos cliente son no confiables: esquema cerrado, campos acotados, lotes máximos y rate limit.
- Sólo se aceptan nivel, timestamp servidor, source, evento, requestId, método, path sin query, status, duración y código estable.
- Nunca se aceptan texto de tickets, nombres de fichero, cuerpos, headers, credenciales, respuestas de proveedor, mensajes arbitrarios, coordenadas exactas ni rutas de filesystem.
- El uptime se calcula cada segundo en cliente desde `startedAt`; no consulta el backend cada segundo.
- El heartbeat usa 15 s mientras está sano, 2 s tras fallo, timeout de 4 s, pausa con documento oculto e invalidación de respuestas obsoletas.
- La recuperación de ruta refresca metadatos/logs y continúa comprobando después de fallos previos.
- Heartbeat de conectividad y SSE de sincronización de dominio son conceptos independientes y no se reutilizan para polling.

## Releases y versionado

- El primer release confiable usa `1.0.0`; cada release posterior incrementa sólo el patch del release estable más alto.
- Un rerun para el mismo commit reutiliza su versión y no consume otro patch.
- La versión y revisión se inyectan en la imagen, labels OCI, `/api/v1/runtime` y la interfaz.
- El job de publicación se ejecuta sólo tras push confiable a `main`, con permisos de escritura limitados al job.
- Primero se publica el tag SHA inmutable, se verifica manifest/digest y se ejecuta ese digest bajo restricciones de producción.
- Sólo después se promueve el mismo digest a `stable` y al tag numérico, se verifican ambos y se crea/verifica el GitHub release.
- El PR nunca publica imágenes, tags ni releases.

## Seguridad

- CORS same-origin, CSP y cabeceras estrictas.
- `Permissions-Policy` permite cámara y geolocalización same-origin sólo para uso explícito; no se habilitan sensores/medios no requeridos.
- Sondas de salud mínimas sin datos sensibles.
- Límites de cuerpo, capturas, concurrencia y tamaño de respuesta.
- Redacción de secretos y ausencia de contenido de tickets/product photos en logs por defecto.
- El proceso OCR no usa shell ni argumentos derivados del nombre del archivo o del contenido reconocido.
- Prevención de traversal y SSRF en configuración de proveedores y lookup externo.
- Nombres de backup estrictos, directorios fijos y contenido binario allowlisted.
- Restore exige confirmación, backup previo, digest, integridad, esquema y reemplazo inactivo.
- El contenedor final elimina gestores de paquetes no necesarios y CI falla ante vulnerabilidades HIGH o CRITICAL corregibles.
- La protección de red es responsabilidad operativa obligatoria, no una mejora opcional.

## Presupuesto de recursos

Límites CI vigentes: RSS en reposo <= 96 MiB, RSS de petición representativa <= 144 MiB, V8 heap <= 64 MiB, CPU idle <= 1% y contenedor 192 MiB por defecto, además de los límites de crecimiento documentados en `RESOURCE_BUDGET.md`. La hibernación libera caches y clientes de proveedores tras inactividad. `IDLE_EXIT_AFTER_MS` está desactivado por defecto y sólo se usa con supervisor externo.

El OCR local puede consumir CPU y memoria transitoria, pero se limita a un proceso Tesseract, un hilo y una petición en cola. No aumenta el RSS en reposo mediante un servicio residente.

Los imports de backup no convierten a Base64 ni cargan la base completa en memoria. El heartbeat es una sonda HTTP mínima con frecuencia adaptativa y se detiene cuando la pestaña está oculta. SSE mantiene como máximo una conexión ligera por cliente visible, no realiza trabajo periódico de dominio y no puede causar crecimiento de memoria no acotado.

## Errores

Todos los errores HTTP tienen código estable, mensaje accionable y `requestId`. Las operaciones caras aceptan cancelación. La incertidumbre parcial de un ticket no invalida líneas legibles. Los fallos de configuración o esquema no se reintentan. Los errores OCR diferencian ejecutable ausente, timeout, salida excesiva, proceso fallido, texto no detectado y formato no soportado. Listas o productos inexistentes usan códigos diferenciados.

Los diagnósticos IA diferencian `AI_NOT_CONFIGURED`, `AI_LOOPBACK_CONTAINER`, `AI_UNREACHABLE`, `AI_AUTHENTICATION_FAILED`, timeout upstream y error HTTP. Import/restore diferencia nombre, content type, tamaño, integridad, esquema, confirmación, candidato ausente, backup previo ausente y digest divergente. Las ediciones concurrentes usan códigos de conflicto estables y estado canónico actual; fallos de ubicación distinguen contexto inseguro/permiso, ausencia local y fallo externo.

## Accesibilidad y responsive

- Navegación por teclado, foco visible y diálogos con nombre accesible.
- Botones con objetivo concreto y etiquetas de formulario asociadas.
- Estados de carga y error mediante regiones de estado.
- Controles táctiles de al menos 44 px cuando sea razonable.
- Sin scroll horizontal en 320 px y viewports móviles objetivo.
- Contraste WCAG 2.2 AA y soporte para movimiento reducido.
- Los estados no dependen únicamente del color.
- Todo gesto de trayectoria dispone de una alternativa de puntero simple y teclado.
- Borrar nunca depende exclusivamente de un desplazamiento ni se activa por accidente al hacer scroll vertical.
- Sheets/dialogs mantienen foco, cierre y safe-area; la acción IA flotante no tapa filas ni navegación.

## Criterios de aceptación automatizados

- Unitarios cubren configuración sin token, unidades y MIME compartidos, archivos, dinero, matching, tickets, optimización, TSV OCR, argumentos fijos, serialización, cancelación, límites de salida, redacción/rotación de logs, versión y política de release, streaming de import y restore.
- Persistencia cubre migración desde schemas soportados, ítems legacy, categorías jerárquicas, fallback protegido, version increments/CAS, variant linkage, stores y observaciones de precio inmutables.
- Integración usa SQLite temporal real para CRUD de listas, cantidades, completado, reordenamiento, conflictos stale, cascada, backups, descarga, import binario, content type, restore staged, previews, catálogo/precio/ubicación y flujo de tickets.
- API cubre SSE, invalidaciones, reconnect semantics, `409`, retry contra versión actual, catálogo/categorías, propuesta de foto, IA no disponible y fallo externo de nearby stores.
- E2E estático verifica módulos, cámara, cache, OCR local, operaciones y ausencia de token.
- Playwright usa dos contextos móviles independientes contra el mismo backend real para demostrar add/complete/edit conflict/resolution/convergencia sin reload ni polling.
- Playwright verifica overview y detalle de listas, add-product sheet compacto, gestión de categorías con creación/reparentado/color/fallback, swipe reutilizable, delete/Undo, IA siempre accesible, cámara/galería, preview, geolocalización disponible y fallback inseguro/no disponible.
- Playwright comprueba 320, 375/390, 430 y desktop/tablet sin overflow, solapamiento de navegación o acciones flotantes.
- Las pruebas de navegador generan captura, GIF, vídeo y traza sin retries, y el PR las renderiza directamente.
- Código determinista nuevo mantiene cobertura significativa cercana al 100%; los gates de cobertura diferenciales existentes no se debilitan.
- Formato, lint, typecheck estricto, dead code, dependencias, build y smoke deben pasar.
- `pnpm quality` y `pnpm resource:measure` son obligatorios antes de entrega.
- Docker valida el binario Tesseract y el modelo `spa` en amd64/arm64, usuario no root, señales, healthcheck, límites de Compose, SBOM, provenance y escaneo HIGH/CRITICAL.
- CI valida estáticamente la secuencia de publicación, permisos mínimos, versionado idempotente y promoción del mismo digest.

# Restricciones de Agente

- Nunca inventar archivos, servicios, endpoints, dependencias o abstracciones sin justificación verificable.
- Nunca refactorizar código ajeno al alcance ni modificar contratos públicos sin especificación.
- Nunca ampliar alcance silenciosamente; mantener cambios trazables y reversibles.
- Nunca incluir secretos, `.env` reales, claves, credenciales, sesiones, tickets personales, imágenes privadas ni coordenadas exactas en logs/fixtures públicos.
- Nunca debilitar tests, cobertura, lint, tipos, seguridad, recursos o CI para lograr verde.
- Nunca introducir polling de dominio, Redis, brokers, microservicios, frontend frameworks, Socket.IO, workers residentes o APIs de mapas de pago para este alcance.
- Nunca duplicar swipe, cliente HTTP, representación monetaria, AI provider/executor, FileStore o heartbeat existentes.
- Nunca aceptar base URLs externas arbitrarias desde una petición normal del navegador.
- Nunca declarar completado mientras fallen checks propios del proyecto o falte evidencia obligatoria.
- Nunca hacer merge, release, deploy, publicación, migración remota ni cambios Raspberry sin autorización explícita.

# Definición de terminado

- No existe `BASKETRA_AUTH_TOKEN` en runtime, navegador, Compose, `.env.example` o documentación operativa.
- La API funcional responde sin `Authorization` dentro del perímetro privado.
- Gestión de listas y detalle de lista son vistas separadas; el contenido de compra domina el detalle y Add Product ya no ocupa permanentemente gran altura.
- Tabs, subvistas, detalle de entidad, paginación, búsqueda, filtros, orden y periodos recuperables quedan reflejados en una URL limpia; recarga y Atrás/Adelante restauran ese estado sin flash de Inicio.
- Dos dispositivos visibles convergen mediante SSE+REST sin polling/manual refresh; ocultar el documento suspende el stream y volver a mostrarlo re-sincroniza.
- Simultaneous explicit edits y reorders no sobrescriben silenciosamente; producen conflicto resoluble y retry intencional.
- Ítems pueden enlazar a variantes globales y los legacy siguen válidos.
- Categorías son reutilizables, jerárquicas, coloreables y acíclicas; `category_unknown` permanece protegido y la clasificación de tickets reutiliza el inventario persistido antes de proponer categorías nuevas.
- Historial de precio contiene sólo observaciones reales confirmadas e inmutables.
- Foto/galería produce propuesta estructurada editable y cancelar no persiste.
- Ubicación es opt-in, local-first y degradable sobre HTTP; nearby lookup sólo es explícito, OSM/Overpass y sin servicios de pago.
- Swipe móvil progresivo conserva Undo y alternativas accesibles sin una segunda implementación.
- Cámara, galería, previews, OCR local de imágenes y revisión mediante filas en euros funcionan sin depender de IA.
- PDF conserva proveedor opcional y revisión manual sin perder evidencia.
- Diagnóstico IA explica configuración ausente, loopback Docker incorrecto y fallos de conexión sin exponer la clave.
- Uptime, versión y logs acotados aparecen en Ajustes.
- La conexión se recupera tras volver la VPN sin recarga y el heartbeat no se usa para sincronización de dominio.
- Backup create/download, import streaming y restore staged protegen la base activa y el backup previo.
- Las migraciones aditivas y backups previos se validan con base existente.
- La PWA no cachea datos privados.
- El workflow confiable asigna un patch idempotente, verifica el digest y sólo después promueve tags/release.
- `pnpm quality`, `pnpm resource:measure`, Playwright multi-dispositivo, seguridad y validaciones Docker aplicables pasan en CI.
- Existe PR normal con evidencia visual directa y sin merge ni despliegue.
