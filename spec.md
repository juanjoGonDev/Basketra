# Objetivo Central

Basketra es una aplicación privada, personal y mobile-first para convertir tickets físicos o digitales en observaciones históricas de precios, mantener listas de compra y comparar planes de compra verificables. Se ejecuta como un único proceso Node.js con SQLite en una Raspberry Pi ARM64 y se accede normalmente mediante VPN.

Incluye captura o importación de imágenes/PDF, preservación de evidencias, extracción OCR mediante proveedores sustituibles y de carga diferida, revisión humana, listas con sugerencias locales, integración opcional con proveedores compatibles con OpenAI, matching determinista, normalización exacta de precios y optimización de cesta.

No es un SaaS multi-tenant, marketplace, red social, servicio de entrega, comprador automático ni plataforma de scraping masivo. No expone el servicio públicamente por defecto. No asume que Prime implica envío gratuito ni presenta precios generados por IA sin evidencia.

Suposiciones explícitas: una única instalación personal; EUR y formato `es-ES` inicialmente; acceso VPN/LAN privado; Node.js 22.23.1; almacenamiento persistente montado; credenciales por entorno. Decisiones reversibles: proveedor OCR, proveedor IA, penalizaciones del optimizador y política de retención. No objetivos iniciales: autenticación federada, multiusuario, pagos, ejecución distribuida y procesos residentes pesados.

# Requisitos Técnicos (RDD)

## Reglas de negocio

- El dinero se representa en unidades menores enteras y nunca con aritmética binaria en coma flotante.
- Las cantidades normalizadas se representan mediante fracciones enteras reducidas.
- Una observación de precio es inmutable; un cambio crea una observación nueva.
- El matching prioriza EAN/GTIN, SKU, alias confirmado, mapeo histórico, atributos deterministas, similitud léxica, reranking IA y confirmación humana.
- Las salidas IA se validan localmente antes de persistirlas o mostrarlas como estructuradas.
- Las ofertas conservan fuente, momento de observación, confianza, stock, condiciones y transporte.
- Prime sólo reduce transporte a cero con evidencia vigente o regla confirmada por el usuario.
- La optimización es determinista y evalúa subconjuntos de retailers mientras el tamaño sea pequeño.

## Flujos verificables

1. Crear y editar listas; preservar borradores tras recarga; obtener sugerencias locales sin IA.
2. Añadir capturas de imagen, PDF o texto; validar tipo, tamaño, hash y orden; revisar extracción; confirmar importación idempotente.
3. Ejecutar OCR o extracción de texto mediante un contrato sustituible, con cancelación y sin worker residente.
4. Analizar una lista manualmente o tras espera configurable; cancelar resultados obsoletos y exigir confirmación para cambios materiales.
5. Normalizar ofertas y generar planes `single-retailer`, `balanced` y `maximum-saving` con desglose y explicación.
6. Crear y validar copias de seguridad de SQLite.

## Modelo de datos

La migración inicial crea retailers, stores, canonical_products, product_variants, product_aliases, retailer_listings, price_observations, external_evidence, receipts, receipt_captures, receipt_extractions, receipt_items, receipt_corrections, shopping_lists, shopping_list_items, optimization_runs, optimization_plans, optimization_plan_items, ai_provider_configurations, ai_executions y ocr_executions. Se habilitan claves foráneas, WAL, busy timeout, índices y FTS5.

## Persistencia y archivos

- SQLite `basketra.db`, timestamps UTC y migraciones explícitas.
- Importación de ticket en una transacción.
- Ficheros con nombre generado, validación de magic bytes, SHA-256, deduplicación y separación temporal/permanente.
- Nunca se exponen rutas del sistema ni se cachean capturas en el service worker.

## OCR e IA

- `OcrProvider` y `AiProvider` son contratos neutrales.
- El ejecutor IA centraliza timeout, cancelación, selección de capacidad, validación, reintentos finitos, redacción y errores.
- La URL del proveedor procede exclusivamente de configuración administrativa; no se acepta por petición.
- El OCR pesado se carga sólo durante el flujo y se libera al terminar.
- La base no incorpora un motor OCR productivo ni proveedores vivos de ofertas; esas integraciones deben aportar evidencia y respetar los contratos existentes.

## Seguridad

- Bind por defecto a `127.0.0.1`; CORS same-origin; CSP y cabeceras estrictas.
- Token local opcional para endpoints sensibles; sondas de salud mínimas sin datos sensibles.
- Límites de cuerpo, capturas, dimensiones, concurrencia, timeout y tamaño de respuesta.
- Redacción de secretos y ausencia de contenido de tickets en logs por defecto.
- Diagnóstico protegido, prevención de traversal y SSRF en configuración de proveedores.
- El contenedor final elimina gestores de paquetes no necesarios y falla CI ante vulnerabilidades HIGH o CRITICAL corregibles.

## Presupuesto de recursos

Objetivos sujetos a medición: RSS en reposo <= 80 MiB, uso API típico <= 128 MiB, límite Docker 192 MiB, CPU en reposo efectivamente cero, concurrencia baja y sin polling continuo. La hibernación libera caches y clientes tras inactividad. `IDLE_EXIT_AFTER_MS` está desactivado por defecto y sólo se usa con supervisor externo.

La evidencia del runner de CI con Node.js 22.23.1 registra 61,56 MiB RSS en reposo, 80,29 MiB bajo carga representativa, 0,039% CPU en la ventana medida, un proceso principal y estado hibernado. La medición física en la Raspberry Pi objetivo sigue siendo una validación de despliegue separada.

## Errores

Todos los errores HTTP tienen código estable, mensaje accionable y `requestId`. Las operaciones caras aceptan cancelación. La incertidumbre parcial de un ticket no invalida las líneas legibles. Los fallos de autenticación, configuración o esquema no se reintentan.

## Criterios de aceptación automatizados

- Tests unitarios cubren dinero, unidades, matching, validación de tickets y optimización.
- Integración usa SQLite temporal real, migraciones, rollback, idempotencia, backup y restauración validada.
- E2E verifica API y shell PWA; Playwright ejecuta siete flujos móviles reales, incluidos autosave, sugerencias sin carreras, tickets, comparación, error IA recuperable, offline y foco visible.
- Código de dominio testable: 100% statements/branches/functions/lines con cobertura nativa de Node.
- Formato, lint, typecheck estricto, dead code, dependencias, build y smoke deben pasar.
- Docker valida amd64/arm64, usuario no root, señales, healthcheck, límites de compose, SBOM, provenance y escaneo HIGH/CRITICAL.

## Evidencia verificada del alcance base

- 18 tests unitarios, 2 de integración, 1 aceptación PWA estática y 7 Playwright pasan sin skip, todo ni retries.
- Cobertura del dominio: 100% líneas, ramas y funciones.
- Builds `linux/amd64` y `linux/arm64` pasan.
- El smoke endurecido, Trivy y apagado gradual pasan.
- Imagen medida: 162.815.322 bytes.
- Un motor OCR productivo, proveedores vivos de supermercado/Amazon y mediciones sobre hardware Raspberry Pi real no están implementados ni se consideran verificados por esta evidencia.

# Restricciones de Agente

- Nunca inventar archivos, servicios, endpoints, dependencias o abstracciones sin justificación verificable.
- Nunca refactorizar código ajeno al alcance ni modificar contratos públicos sin autorización o especificación.
- Nunca ampliar alcance silenciosamente; reutilizar patrones existentes y mantener cambios mínimos, trazables y reversibles.
- Detenerse y reportar sólo ante ambigüedad crítica de seguridad, arquitectura o alcance.
- Nunca incluir secretos, `.env` reales, claves, credenciales, sesiones ni tickets personales.
- Nunca debilitar tests, cobertura, lint, tipos, seguridad o CI para lograr verde.
- Nunca declarar completado mientras fallen checks propios del proyecto.
- Nunca crear capas sin propósito comprobado ni usar SOLID como excusa para complejidad.

# Lista de Tareas (Task List)

1. **Análisis de repositorio** — salida: inventario de ramas, commits e instrucciones; aceptación: evidencia remota; tests: no aplica; dependencia: ninguna.
2. **Especificación** — salida: este contrato y spec de tarea; aceptación: criterios objetivos y riesgos; tests: validación documental; dependencia: 1.
3. **Decisiones de arquitectura** — salida: ADR de monolito, SQLite y proveedores; aceptación: alternativas y consecuencias; tests: revisión de enlaces internos; dependencia: 2.
4. **Dominio** — salida: dinero, unidades, matching, tickets, ofertas y optimización; aceptación: resultados deterministas; tests: unitarios 100%; dependencia: 3.
5. **Persistencia** — salida: migraciones SQLite y repositorios transaccionales; aceptación: WAL/FTS/FK/idempotencia; tests: integración real; dependencia: 4.
6. **Backend** — salida: API versionada, errores, auth, límites y sondas; aceptación: contratos estables; tests: integración HTTP; dependencia: 5.
7. **Frontend** — salida: PWA mobile-first accesible; aceptación: navegación, autosave, estados y sin overflow; tests: E2E móvil; dependencia: 6.
8. **OCR** — salida: contrato, proveedor de texto embebido y worker sustituible; aceptación: cancelación y liberación; tests: fixtures sintéticos; dependencia: 7. Motor productivo pendiente de integración externa.
9. **IA** — salida: proveedor compatible OpenAI y ejecutor estructurado; aceptación: validación local y retries finitos; tests: mock; dependencia: 6.
10. **Matching** — salida: ranking explicable; aceptación: prioridad y ambigüedad; tests: casos requeridos; dependencia: 4 y 9.
11. **Comparación** — salida: normalización supermercado/Amazon; aceptación: evidencia, stock y Prime; tests: fixtures; dependencia: 4 y 10. Proveedores vivos pendientes de integración externa.
12. **Optimización** — salida: tres planes; aceptación: coste efectivo y desempate; tests: casos requeridos; dependencia: 11.
13. **Testing** — salida: unit/integration/e2e/security; aceptación: sin skip/only y cobertura acordada; dependencia: 4-12.
14. **Seguridad** — salida: controles y threat model; aceptación: regresiones verificadas; tests: traversal, auth, SSRF y límites; dependencia: 6-9.
15. **Docker** — salida: Dockerfile y compose; aceptación: no root, señales, límites y healthcheck; tests: smoke; dependencia: 6-14.
16. **Raspberry Pi** — salida: medición reproducible; aceptación: resultados reales o desviaciones; tests: script de recursos; dependencia: 15. Build ARM64 verificado; medición física pendiente del hardware objetivo.
17. **CI** — salida: workflows endurecidos; aceptación: acciones por SHA, permisos mínimos y gates; tests: ejecución remota; dependencia: 13-16.
18. **Documentación** — salida: guías operativas y limitaciones; aceptación: comandos ejecutables; tests: comprobación de referencias; dependencia: 1-17.
19. **Verificación final** — salida: diff, PR normal y estado CI; aceptación: checks verdes o bloqueo exacto; tests: `pnpm quality` y CI; dependencia: todas.
