# Repository agent instructions

Read `spec.md` and `.agents/specs/` before changing behavior.

- Use English for code, tests, commits, PRs, schemas, configuration, and documentation. `spec.md` remains Spanish by product requirement.
- Preserve the dependency-free runtime unless measured evidence proves a package is necessary.
- Keep one Node.js process, SQLite, bounded work, no polling, no resident OCR/browser worker, and no external database.
- Store money as integer minor units and quantities as exact rational values.
- Preserve evidence; never overwrite price observations or original receipt extraction data.
- Never expose secrets, receipt content, filesystem paths, or provider credentials.
- Add a regression test for every bug when practical.
- Run `pnpm quality` before delivery. Run Docker checks when a Docker daemon is available.
- Do not merge, release, deploy, change protected branches, or perform destructive data operations without explicit authorization.
