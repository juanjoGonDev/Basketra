# OCR limitations

Basketra defines a replaceable `OcrProvider` and implements three production paths:

- local Tesseract 5 OCR for JPEG and PNG receipt images;
- embedded or manually supplied text, which bypasses OCR entirely;
- bounded multimodal extraction through a configured OpenAI-compatible provider for PDF files and optional post-OCR verification.

## Local image OCR

The production container includes Tesseract and the Spanish `tessdata_fast` model. Image OCR is free, local and enabled without an API key, account or network request.

Basketra does not keep an OCR service or model worker resident. Each recognition starts one ephemeral child process and releases it when the page finishes. The provider:

- invokes `tesseract` directly without a shell;
- accepts only already validated JPEG or PNG bytes;
- uses the Spanish LSTM engine with receipt-oriented page segmentation;
- limits OpenMP to one thread;
- serializes recognition so only one Tesseract process runs per application instance;
- applies a 20-second timeout and bounded stdout/stderr;
- propagates request cancellation and kills the process;
- parses TSV into ordered lines and a bounded confidence value;
- never logs receipt text, OCR output, filenames, paths or raw process errors.

The container build fails unless the Tesseract executable and `spa` language model are both available on AMD64 and ARM64.

## Optional AI and PDF path

Configuration:

```dotenv
BASKETRA_AI_IMAGE_CAPABILITY=true
BASKETRA_AI_PDF_CAPABILITY=false
```

AI verification is disabled in the ticket UI unless a provider is configured. Local image OCR remains available independently. A configured provider can verify the locally extracted text; its result is still treated as a proposal and validated locally.

Local PDF rasterization is not bundled. PDF capability is disabled by default because OpenAI-compatible servers vary in file-message support. A PDF therefore requires one of these paths:

- a verified PDF-capable provider;
- embedded text supplied by a future adapter;
- manual editable receipt rows.

## Accuracy and recovery

OCR accuracy depends on lighting, focus, crop, rotation, print quality and receipt layout. Long receipts should be split into ordered captures. The interface preserves every original capture and presents editable rows in euros, so a partial or failed recognition never blocks manual correction.

Required deployment validation uses privacy-safe synthetic fixtures for supermarkets, long tickets, weights, discounts and split lines. No real personal receipts belong in Git or CI.

OCR output, deterministic parsing and optional AI interpretation are stored separately. Arithmetic is recalculated independently, uncertain lines are prioritized for review, and user corrections never overwrite original evidence.
