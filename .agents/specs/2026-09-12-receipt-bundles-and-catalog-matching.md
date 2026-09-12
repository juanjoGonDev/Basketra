# Receipt bundles: compact review, per-file stores and product matching

## Request

Receipt analysis must remain a dense professional workspace: final lines stay on one horizontal row with intentional edge spacing and no inline edit control. Receipt feedback is communicated through toasts rather than duplicated inline notifications. Operators can edit every uploaded source, including a detected or manually selected retailer/store, and create a store from that source editor. Different uploaded receipts must be reviewed, validated and confirmed independently; a total mismatch is a warning requiring explicit acceptance, not a dead end. Each detected line must expose a compact existing-catalog match suggestion and allow the operator to attach it to a canonical parent/variant.

## Decisions

- A capture belongs to a user-managed receipt draft group. Each group owns retailer, store, declared total, line set, validation state and evidence captures. Group changes are local draft state until confirmation.
- The durable analysis remains one bounded session. Its page interpretations are projected into draft groups by capture; the user can merge pages that belong to one physical receipt before confirmation. A group with multiple pages has one total; unrelated uploads never participate in its arithmetic validation.
- Confirmation validates and imports each approved group independently. A mismatch yields a structured warning and requires the explicit group approval; only malformed lines or missing required retailer/store fields block confirmation.
- Capture metadata is editable in a compact source editor. Store options are scoped by retailer; selecting an existing store records its id, while a new name is created only on the explicit source-editor save.
- Candidate product matching is deterministic and bounded. The UI shows one suggested saved product when available; assigning a candidate records the chosen canonical-product/variant link in the receipt line and is used by the existing receipt projection rather than creating a duplicate product.
- All terminal success, warning and failure feedback in this receipt workspace goes through the shared toast surface. Inline text is reserved for persistent field validation and processing state.

## Checklist

- [ ] Dense detected row has horizontal padding, aligned amount, no inline edit icon, pointer/keyboard opens the modal.
- [ ] Terminal receipt feedback has no raw ids or duplicated inline notification.
- [ ] Source editor lists each file and permits retailer/store selection or explicit store creation.
- [ ] Capture-level retailer/store choices persist in the draft and are used in the corresponding line editor/import preview.
- [ ] Captures can be partitioned/merged into receipt draft groups; each group shows its own total, evidence count and validation state.
- [ ] Total mismatch remains a warning and confirmation accepts an explicit group approval.
- [ ] Confirmation persists one receipt per approved group with only its own evidence, retailer/store and lines.
- [ ] Deterministic catalog candidate appears for a matching detected line and explicit assignment is preserved through validation/confirmation.
- [ ] Image and PDF evidence remains viewable from a group and line modal.
- [ ] Unit, integration and browser regression coverage cover every checklist item; `pnpm quality` passes.
