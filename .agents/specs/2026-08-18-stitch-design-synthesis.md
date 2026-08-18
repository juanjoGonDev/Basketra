# Stitch-inspired native design synthesis

## Request

Use the user-supplied Google Stitch screens and `DESIGN.md` as visual reference material for PR #32, keeping the strongest patterns while deliberately removing inconsistencies between the reference screens. The resulting Basketra frontend must feel like one native Android application rather than a collection of web pages.

This iteration also preserves the regression requirements already recorded in `2026-08-18-native-ui-regressions.md`: AI-provider traffic must remain bounded, provider diagnostic text must have comfortable internal spacing, receipt confirmation failures must be visible beside the confirmation action, and receipt review lines must be visually coherent on mobile and desktop.

## Evidence

- The supplied Stitch screens consistently favour a compact app bar with Basketra identity plus connection state, a five-destination bottom navigation, large touch-first primary actions, flat bordered surfaces, prominent page titles and restrained green/mint accents.
- The references are not internally consistent: Settings uses a markedly different dark treatment, active-navigation presentation varies, some screens use large tinted backgrounds while others use white, and sample Home data such as a personal greeting, next purchase and latest receipt is not available from the current Basketra contracts.
- The supplied `DESIGN.md` defines a Smart Utility / Tonal Flatness direction, Roboto typography, a strict 4 px spacing grid, zero-shadow policy, 16 px standard container radius, 24 px interactive radius, pill chips, flat bordered cards and a five-destination mobile navigation.
- `DESIGN.md` contains conflicting primary-token descriptions: its YAML assigns `primary: #00513f`, `primary-container: #006b55`, while the prose calls `#006b55` Primary and `#8cf8d3` Primary Container. The existing Basketra PR already uses the latter pair and the supplied screens visually align with it.
- Current Basketra remains dependency-free HTML/CSS/JavaScript and already has semantic markup, SVG icons, Playwright browser evidence and the adaptive bottom-navigation / desktop-rail scaffold.

## Decision

1. Treat the Stitch output as a pattern reference, not a literal implementation.
2. Keep the current Basketra information architecture and available data. Do not invent a user name, predicted shopping list, latest receipt summary or AI insight endpoints merely to match mock data.
3. Canonicalise the visual direction around the prose/screenshot pair `#006b55` primary and `#8cf8d3` primary container while retaining semantic success/warning/error colours.
4. Adopt the reference app-bar treatment: stronger Basketra wordmark, quieter connection state, less decorative brand container and a mobile density similar to a native top app bar.
5. Adopt a persistent five-destination navigation with one strong active pill. Compact screens keep it at the bottom; expanded screens keep the same destinations in the existing rail.
6. Use white/default surfaces with subtle 1 px structural borders and zero shadows. Use mint tonal surfaces only for selected, highlighted or AI/supporting regions rather than making every container green.
7. Use 16 px card radius, 24 px interactive radius and 48-56 px primary touch controls from the supplied system.
8. Make Tickets the strongest native workflow: two large capture choices on compact screens, document/task rows, compact stage/status treatment, coherent receipt-review cards and one persistent confirmation action.
9. Keep receipt review dense but readable: product is full width; numeric fields remain compact and align consistently; destructive swipe rails are invisible until explicitly revealed.
10. Keep Settings visually identical to the rest of the product instead of adopting the isolated black Stitch mock. Metric tiles, diagnostics, logs and recovery use the shared surface/border/tokens.
11. Keep Plans comparable rather than decorative. The three strategies use the same card contract, with tonal emphasis only where the data/presentation already supports it.
12. Do not add a UI framework, icon dependency or new data contract.

## Mobile design

- 16 px page gutter on compact screens.
- App bar approximately 64-72 px with Basketra identity and connection status.
- Page headline 24-32 px depending on hierarchy, never marketing-sized.
- Primary buttons are 48-56 px high, full width when they represent the next dominant action.
- Bottom navigation is always reachable and uses one active pill; inactive destinations remain text-labelled.
- Ticket capture options remain side-by-side down to the narrowest practical width, then reflow without horizontal overflow.
- Receipt review uses compact fields and a sticky confirmation region that cannot hide its own error feedback.

## Desktop adaptation

- Preserve the existing navigation rail rather than creating a second desktop navigation architecture.
- Use the available width for comparison and two-column operational groups, not for stretching forms or paragraphs.
- Receipt-review numeric fields may share a row on wide layouts, while mobile remains content-driven.
- Maximum content width remains bounded around the existing 72 rem / 1200 px design intent.

## Visual system

Canonical tokens remain in `src/web/modern.css` and consume the supplied reference as follows:

- primary: `#006b55`
- primary container: `#8cf8d3`
- background/surface family: light green-white values derived from the supplied `DESIGN.md`
- structural borders: subtle on-surface/outline variants
- spacing: 4 px rhythm
- standard surface radius: 16 px
- interactive radius: 24 px
- chips/navigation indicators: full pill
- elevation: zero shadow

`src/web/operations.css` remains operations-specific and consumes the global tokens; receipt/global component styling belongs in `modern.css`, not the operations stylesheet.

## Accessibility

- Preserve semantic native controls and existing accessible names.
- Keep browser zoom enabled and 320 CSS px reflow.
- Maintain visible `:focus-visible` treatment.
- Keep text and required control boundaries at AA-oriented contrast.
- Do not expose state through colour alone; chips retain text.
- Keep touch actions at least 44 px where practical, normally 48-56 px for primary controls.
- Preserve reduced-motion support and accessible swipe alternatives.

## Tests

- Keep the existing browser design-contract suite for compact/expanded navigation, touch size, focus and overflow.
- Keep the native UI regression suite for bounded AI-provider reads, manual-only expensive probe, receipt confirmation feedback and hidden destructive rails.
- Capture Home, Lists, Tickets, Plans and Settings at 390 px plus Tickets at 320 px and Settings/receipt review on expanded desktop.
- Run `pnpm quality` through the authoritative PR workflow plus Browser E2E, Security, container smoke, amd64/arm64 and CodeQL.

## Files

In scope for this slice:

- `.agents/specs/2026-08-18-stitch-design-synthesis.md`
- `src/web/modern.css`
- `src/web/operations.css`
- existing browser tests only if the intentional visual contract requires assertion updates

No backend, database, API, authentication, dependency, deployment or release files are in scope.

## Risks

- A global visual rewrite can create specificity conflicts with `styles.css`; selectors must remain targeted and the base stylesheet continues to own structural behaviour.
- Over-copying the Stitch mocks would invent unavailable product data or create different visual systems per screen; this is explicitly rejected.
- Making every active or informational region mint would reduce hierarchy; tonal colour is reserved for selection/supporting state.
- Dense receipt forms can become unusable at 320 px; numeric-field reflow remains content-driven and is covered by Playwright.

## Acceptance

- The five primary destinations look like one product and use the same app bar, navigation, cards, buttons, fields, chips, spacing and radii.
- The product reads as an Android-style utility app rather than a web dashboard or landing page.
- The zero-shadow policy is respected by the canonical visual layers.
- Ticket capture and receipt review are visually coherent at 320/390 px and desktop.
- Provider status surfaces have internal spacing and never visually touch their container edge.
- Settings matches the same light/dark semantic system as every other destination.
- Existing regression behaviour and business contracts remain unchanged.
- No new runtime dependency or invented data source is introduced.
- Browser evidence and required CI are green before delivery.

## Delivery

Continue on `agent/ui-android-native-redesign` / PR #32 using atomic Conventional Commits. Do not merge without explicit merge authorization.

## Status

Accepted directly from the user's supplied Stitch references and request on 2026-08-18. Implementation in progress.