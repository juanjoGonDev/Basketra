# Objetivo Central

Basketra es una aplicación privada, personal y mobile-first para convertir tickets físicos o digitales en observaciones históricas de precios, mantener listas de compra completas y comparar planes de compra verificables. Se ejecuta como un único proceso Node.js con SQLite en una Raspberry Pi ARM64 y se accede mediante una frontera de infraestructura privada.

Incluye captura o importación de imágenes/PDF, preservación de evidencias, OCR local para imágenes mediante proveedor sustituible y de carga efímera, revisión humana mediante filas editables, listas con sugerencias locales, integración opcional con proveedores compatibles con OpenAI, matching determinista, normalización exacta de precios y optimización de cesta.

No es un SaaS multi-tenant, marketplace, red social, servicio de entrega, comprador automático ni plataforma de scraping masivo. No expone el servicio públicamente por defecto. No asume que Prime implica envío gratuito ni presenta precios generados por IA sin evidencia.

Suposiciones explícitas: una única instalación personal; EUR y formato `es-ES`; acceso por loopback, VPN, túnel SSH, LAN revisada o proxy privado autenticado; Node.js 22.23.1; almacenamiento persistente montado; credenciales de proveedores opcionales por entorno. No objetivos: autenticación interna, autenticación federada, multiusuario, pagos, ejecución distribuida y procesos residentes pesados.

# Requisitos Técnicos (RDD)

## Reglas de negocio

- El dinero se representa en unidades menores enteras y nunca con aritmética binaria en coma flotante.
- La interfaz presenta y acepta importes en euros con dos decimales; nunca exige al usuario introducir enteros en céntimos.
- Las cantidades normalizadas se representan mediante fracciones enteras reducidas.
- Una observación de precio es inmutable; un cambio crea una observación nueva.
- El matching prioriza EAN/GTIN, SKU, alias confirmado, mapeo histórico, atributos deterministas, similitud léxica, reranking IA y confirmación humana.
- Las salidas IA se validan localmente antes de persistirlas o mostrarlas como estructuradas.
- Las ofertas conservan fuente, momento de observación, confianza, stock, condiciones y transporte.
- Prime sólo reduce transporte a cero con evidencia vigente o regla confirmada por el usuario.
- La optimización es determinista y evalúa subconjuntos de retailers mientras el tamaño sea pequeño.
- Eliminar una captura de un borrador no elimina la evidencia física almacenada sin demostrar que no está referenciada.

## Frontera de acceso

- Basketra no tiene token interno, sesión ni pantalla de login.
- El bind por defecto es `127.0.0.1`; Docker publica en loopback por defecto.
- El acceso remoto soportado termina en VPN, túnel SSH, firewall LAN revisado o proxy privado con autenticación y TLS.
- La exposición directa a Internet no está soportada.
- Cualquier actor con conectividad HTTP a Basketra se considera plenamente autorizado para listas, tickets, diagnósticos y backups.

## Flujos verificables

### Listas de compra

1. Crear, seleccionar, renombrar y eliminar listas sin `prompt` ni diálogos del navegador.
2. Añadir y editar productos, cantidad, unidad y preferencias exacto/sustitución.
3. Incrementar o reducir cantidades dentro de límites validados.
4. Marcar y desmarcar productos como comprados, preservando fecha de finalización cuando aplica.
5. Reordenar mediante un orden completo, único y transaccional.
6. Mantener posiciones contiguas después de borrar.
7. Separar visualmente pendientes y completados.
8. Preservar lista activa y borrador de producto tras recarga.
9. Obtener sugerencias locales sin IA y cancelar respuestas obsoletas.
10. En móvil, deslizar a la derecha marca o desmarca como comprado; deslizar a la izquierda revela edición y borrado.
11. Los gestos tienen botones equivalentes y un desplazamiento largo nunca ejecuta borrado sin una pulsación explícita.

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
12. En móvil, deslizar a la izquierda revela edición y borrado, manteniendo botones accesibles y confirmación destructiva explícita.

### Comparación y operación

1. Normalizar ofertas y generar planes `single-retailer`, `balanced` y `maximum-saving`.
2. Crear y validar copias de seguridad de SQLite.
3. Migrar antes de readiness con backup validado y transacción completa.
4. Cancelar operaciones caras o resultados obsoletos.

## Modelo de datos

La migración inicial crea retailers, stores, canonical_products, product_variants, product_aliases, retailer_listings, price_observations, external_evidence, receipts, receipt_captures, receipt_extractions, receipt_items, receipt_corrections, shopping_lists, shopping_list_items, optimization_runs, optimization_plans, optimization_plan_items, ai_provider_configurations, ai_executions y ocr_executions.

La migración 2 registra backups previos a migraciones. La migración 3 añade `completed` y `completed_at` a productos de listas. Las migraciones aplicadas no se reescriben. Se habilitan claves foráneas, WAL, busy timeout, índices y FTS5.

## Persistencia y archivos

- SQLite `basketra.db`, timestamps UTC y migraciones explícitas.
- Importación de ticket en una transacción.
- Listas modificadas mediante transacciones acotadas para cantidades, completado, borrado y orden.
- Ficheros con nombre generado, validación de magic bytes, SHA-256, deduplicación y separación temporal/permanente.
- Las previews aceptan exclusivamente claves generadas de imagen, usan same-origin y `Cache-Control: private, no-store`.
- PDF no se sirve por el endpoint de preview de imagen.
- Nunca se exponen rutas del sistema ni se cachean capturas o respuestas `/api/` en el service worker.

## Fuentes únicas de verdad

- Unidades: `UNIT_VALUES` en dominio.
- Tipos de archivo: `SUPPORTED_FILE_MIME_TYPES` en `FileStore`.
- Límites de archivo: configuración backend expuesta por `/api/v1/meta`.
- Claves persistentes frontend: módulo `state.js`.
- Cliente HTTP frontend: módulo `api.js`.
- Conversión y formato EUR de la interfaz: funciones canónicas de `ui.js`; el backend conserva unidades menores enteras.
- Gestos móviles: un único componente reutilizable de swipe; las features consumen sus acciones y no reimplementan umbrales.
- Validaciones autoritativas: backend; las validaciones de navegador son preventivas, no de seguridad.

## OCR e IA

- `OcrProvider` y `AiProvider` son contratos neutrales.
- JPEG y PNG usan por defecto Tesseract 5 local con modelo español rápido incluido en la imagen ARM64/AMD64.
- Tesseract se ejecuta sin shell, con argumentos fijos, un hilo OpenMP, una única operación simultánea, timeout, cancelación y límites de salida.
- No existe worker OCR residente; el proceso nace durante la petición y se libera al terminar.
- El contenido del ticket, salida OCR, nombre de archivo, rutas y errores crudos del proceso no se registran.
- El ejecutor IA centraliza timeout, cancelación, selección de capacidad, validación, reintentos finitos, redacción y errores.
- La URL del proveedor procede exclusivamente de configuración administrativa; no se acepta por petición.
- La IA es opcional para verificar OCR, ayudar con listas o procesar PDF cuando el proveedor lo soporte.
- La ausencia o fallo de IA no bloquea OCR local de imágenes, corrección, validación o confirmación manual.
- El OCR local no rasteriza PDF; se mantiene el proveedor sustituible y la edición manual como rutas explícitas.

## Seguridad

- CORS same-origin, CSP y cabeceras estrictas.
- Sondas de salud mínimas sin datos sensibles.
- Límites de cuerpo, capturas, concurrencia, timeout y tamaño de respuesta.
- Redacción de secretos y ausencia de contenido de tickets en logs por defecto.
- El proceso OCR no usa shell ni argumentos derivados del nombre del archivo o del contenido reconocido.
- Prevención de traversal y SSRF en configuración de proveedores.
- El contenedor final elimina gestores de paquetes no necesarios y CI falla ante vulnerabilidades HIGH o CRITICAL corregibles.
- La protección de red es responsabilidad operativa obligatoria, no una mejora opcional.

## Presupuesto de recursos

Objetivos sujetos a medición: RSS en reposo <= 80 MiB, uso API típico <= 128 MiB, límite Docker 192 MiB, CPU en reposo efectivamente cero, concurrencia baja y sin polling continuo. La hibernación libera caches y clientes tras inactividad. `IDLE_EXIT_AFTER_MS` está desactivado por defecto y sólo se usa con supervisor externo.

El OCR local puede consumir CPU y memoria transitoria, pero se limita a un proceso Tesseract, un hilo y una petición en cola. No aumenta el RSS en reposo mediante un servicio residente.

## Errores

Todos los errores HTTP tienen código estable, mensaje accionable y `requestId`. Las operaciones caras aceptan cancelación. La incertidumbre parcial de un ticket no invalida líneas legibles. Los fallos de configuración o esquema no se reintentan. Los errores OCR diferencian ejecutable ausente, timeout, salida excesiva, proceso fallido, texto no detectado y formato no soportado. Listas o productos inexistentes usan códigos diferenciados.

## Accesibilidad y responsive

- Navegación por teclado, foco visible y diálogos con nombre accesible.
- Botones con objetivo concreto y etiquetas de formulario asociadas.
- Estados de carga y error mediante regiones de estado.
- Controles táctiles de al menos 44 px.
- Sin scroll horizontal en el viewport móvil objetivo.
- Contraste WCAG AA y soporte para movimiento reducido.
- Los estados no dependen únicamente del color.
- Todo gesto de trayectoria dispone de una alternativa de puntero simple y teclado.
- Borrar nunca depende exclusivamente de un desplazamiento ni se activa por accidente al hacer scroll vertical.

## Criterios de aceptación automatizados

- Unitarios cubren configuración sin token, unidades y MIME compartidos, archivos, dinero, matching, tickets, optimización, TSV OCR, argumentos fijos, serialización, timeout, cancelación y límites de salida.
- Integración usa SQLite temporal real para CRUD de listas, cantidades, completado, reordenamiento, migración v1→v3, cascada, backups, previews y flujo de tickets.
- E2E estático verifica módulos, cámara, cache, OCR local y ausencia de token.
- Playwright verifica shell móvil, ciclo completo de listas, swipe reutilizable, sugerencias sin carreras, cámara/galería/PDF, previews, OCR local, filas editables en euros, recuperación manual, comparación, offline y foco visible.
- Las pruebas de navegador generan captura, vídeo y traza sin retries.
- Código de dominio testable mantiene 100% statements/branches/functions/lines con cobertura nativa de Node.
- Formato, lint, typecheck estricto, dead code, dependencias, build y smoke deben pasar.
- Docker valida el binario Tesseract y el modelo `spa` en amd64/arm64, usuario no root, señales, healthcheck, límites de Compose, SBOM, provenance y escaneo HIGH/CRITICAL.

# Restricciones de Agente

- Nunca inventar archivos, servicios, endpoints, dependencias o abstracciones sin justificación verificable.
- Nunca refactorizar código ajeno al alcance ni modificar contratos públicos sin especificación.
- Nunca ampliar alcance silenciosamente; mantener cambios trazables y reversibles.
- Nunca incluir secretos, `.env` reales, claves, credenciales, sesiones ni tickets personales.
- Nunca debilitar tests, cobertura, lint, tipos, seguridad o CI para lograr verde.
- Nunca declarar completado mientras fallen checks propios del proyecto.
- Nunca hacer merge, release, deploy ni publicación sin autorización explícita.

# Definición de terminado

- No existe `BASKETRA_AUTH_TOKEN` en runtime, navegador, Compose, `.env.example` o documentación operativa.
- La API funcional responde sin `Authorization` dentro del perímetro privado.
- El ciclo completo de listas y productos funciona, persiste y ofrece gestos móviles con alternativas accesibles.
- Cámara, galería, previews, OCR local de imágenes y revisión mediante filas en euros funcionan sin depender de IA.
- PDF conserva proveedor opcional y revisión manual sin perder evidencia.
- Migración v3 y backups previos se validan con base existente.
- La PWA no cachea datos privados.
- `pnpm quality`, Playwright, seguridad y validaciones Docker aplicables pasan en CI.
- Existe PR normal con evidencia visual directa y sin merge ni despliegue.
