# Collaborative shopping lists

Basketra keeps the shopping-list database authoritative in SQLite and uses REST for every mutation. The collaborative layer adds lightweight Server-Sent Events (SSE) only as invalidation notifications.

## Realtime contract

A visible Lists screen maintains at most one same-origin SSE connection per browser client. The connection is used for both the lists overview and an opened list detail.

SSE events contain only change metadata:

- entity type;
- mutation type;
- affected list/entity identifiers when applicable;
- optimistic-concurrency version when applicable;
- update timestamp.

Events do not contain product descriptions, prices, receipt contents, images, credentials or coordinates. Clients coalesce bursts and re-read canonical state through the normal REST API. Basketra does not persist an event log and does not poll for domain changes.

The browser closes the stream when the document is hidden or the user leaves the Lists area. Reconnecting always performs a canonical resynchronization. The server keeps a bounded client set, removes disconnected clients and does not count a long-lived SSE stream as an expensive operation that blocks idle resource release.

## Concurrent changes

`shopping_lists` and `shopping_list_items` use explicit integer versions. Explicit edits, deletes and reorders send the version on which the action was based.

A stale write returns HTTP `409` with code `SHOPPING_CONFLICT` and the current canonical record required to resolve the conflict. Explicit item edits present the local attempted values beside the latest values and offer two intentional choices:

- use the latest saved version;
- re-submit the user's changes against the latest version.

Simple completion, quantity or reorder conflicts resynchronize and explain that another device changed the list instead of silently overwriting it.

## Product and price evidence

A list item may reference an existing global product variant, but legacy unlinked items remain valid. Reusable product categories and global metadata are persisted separately from list-specific quantity/completion state.

A price observation is created only when a real price is confirmed with at least a retailer. Adding or completing a list item never creates price history. Price observations are immutable evidence; a later correction creates another observation.

Product photos reuse Basketra's existing FileStore and structured AI executor. AI output is a validated proposal only and is never persisted directly. The user can edit or discard the proposal before saving.

## Optional location and private HTTP deployments

Basketra remains fully usable at a private address such as:

```text
http://<raspberry-local-ip>:<port>
```

Location is optional and is never requested on page load or merely because the Add Product sheet opens. The browser asks for geolocation only after the explicit **Use my current location to suggest the store** action.

Normal mobile browsers generally expose geolocation only in a secure browser context. When Basketra is opened over private HTTP and the browser refuses geolocation, only location-dependent assistance is disabled. Manual retailer/store selection and the rest of Basketra continue to work.

If location assistance is required, an existing private reverse proxy can expose Basketra through local HTTPS. Basketra's Node.js process does not need to terminate TLS itself and this feature does not require a new proxy stack. Keep the service private behind the existing VPN/LAN access boundary.

Saved stores are matched locally first using persisted integer microdegree coordinates. Exact coordinates are not written to application logs.

If local matching has no useful result, the user may explicitly request a bounded nearby-store lookup using OpenStreetMap Overpass data. The public-service endpoint is configured administratively with `BASKETRA_OVERPASS_BASE_URL`; normal browser requests cannot supply an arbitrary provider URL. External lookup is never automatic, results are not bulk-persisted, and a store is saved only after user confirmation. The UI displays `© OpenStreetMap contributors` attribution with nearby results.

## Resource model

The feature does not add another process, database, broker, worker, frontend framework, WebSocket server or polling loop. It preserves the existing single-process/SQLite architecture and current resource gates. Realtime connections perform no periodic domain reads and retain no event history.
