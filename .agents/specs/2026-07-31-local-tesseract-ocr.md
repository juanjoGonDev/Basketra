# Local Tesseract OCR

## Request

Provide a free, local, low-memory OCR engine for receipt photographs on Raspberry Pi so extraction does not require an external AI provider.

## Evidence

- Image OCR currently uses the optional OpenAI-compatible provider.
- Without that provider, the UI reports that OCR is not configured.
- Production is Alpine Linux on AMD64 and ARM64 with a 192 MiB memory limit.
- Repository policy forbids resident OCR workers and requires bounded, lazy work.
- Tesseract 5 and Spanish language data are available as Apache-2.0 Alpine ARM64 packages.
- Official `tessdata_fast` models use a smaller integerized network for the speed/accuracy compromise.

## Decision

1. Install native Tesseract and Spanish fast language data in the runtime image.
2. Run it as an ephemeral child process only during OCR.
3. Limit it to one thread, one concurrent recognition, bounded timeout and bounded output.
4. Use fixed arguments without a shell and parse TSV into ordered text plus confidence.
5. Use local OCR for JPEG/PNG; retain optional multimodal AI for PDFs and optional verification.
6. Expose OCR and AI capability metadata so the UI does not imply AI is required.
7. Preserve manual transcription, original evidence and recovery behavior.

## Acceptance

- JPEG/PNG processing works without AI URL, model or API key.
- Timeout, abort, output limit, process failure, empty text and unsupported PDF have stable errors.
- OCR content, filenames and paths are never logged.
- Playwright runs a real local OCR flow with no AI configuration.
- Container smoke exercises OCR under the hardened 192 MiB runtime.
- Quality, security, CodeQL, Trivy, resource, AMD64 and ARM64 checks pass.

## Risks

- OCR uses transient CPU/RAM: existing file limits plus one process, one thread and timeout bound it.
- Poor photos reduce accuracy: original text, confidence, correction and manual fallback remain.
- Native packages enlarge the image: SBOM, Trivy and multi-architecture builds remain mandatory.
- Local PDF rasterization is out of scope; configured provider or manual text remains available.

## Rollback

Revert the PR. No schema or persisted-data migration is involved.

## Delivery

Branch `agent/feat-local-tesseract-ocr`; no merge, release, deployment or Raspberry mutation.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Implementation: in progress.
- Validation: pending.
- Delivery: pending.
