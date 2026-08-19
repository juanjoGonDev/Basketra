# Danger button foreground token regression

## Request

Continue PR #32 and close any remaining UI/UX regressions before final visual review.

## Evidence

- `src/web/modern.css` makes `.button.danger` consume `var(--color-on-error)`.
- The semantic palette defined error backgrounds and container foregrounds but did not define `--color-on-error` in either light or dark mode.
- An unresolved custom property makes the `color` declaration invalid at computed-value time, so destructive buttons can inherit an unintended foreground color.
- The canonical frontend guide requires semantic state tokens and verified contrast instead of implicit or arbitrary fallbacks.

## Decision

Define `--color-on-error` alongside the existing error palette in both color schemes. Keep `.button.danger` consuming that semantic token so the error foreground has one canonical owner.

Use `#ffffff` on the light error background `#ba1a1a` and `#690005` on the dark error background `#ffb4ab`. These pairs have WCAG AA contrast for normal text.

## Acceptance

- `--color-on-error` exists exactly once in the light palette and once in the dark palette.
- `.button.danger` continues to consume `var(--color-on-error)`.
- A unit regression test prevents removing either definition while the destructive-button contract remains.
- No unrelated visual, API, backend, dependency, or workflow behavior changes.
- PR quality and exact-head browser evidence are revalidated after the fix.

## Checks

- `pnpm test`
- `pnpm quality`
- Pull Request Quality
- CodeQL Advanced
- Publish PR visual evidence

## Delivery

Branch: `agent/ui-android-native-redesign`.

Atomic commits. PR #32 remains unmerged pending final visual review.

## Status

Regression reproduced by static inspection on head `6ca34339bcc3586140c2d757870d87156f25e1dd`. Regression test added in `c85f9114dbe87efbf8c1d0fd16897885cac186f1`. Semantic foreground tokens implemented in `8c96ad9d00af530224620a4c3a902c540e088ec8`. Implementation is complete; the final PR head must satisfy the checks above before merge.
