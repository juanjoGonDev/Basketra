# OCR limitations

Basketra defines a replaceable `OcrProvider` and implements two production paths:

- embedded or manually supplied text, which bypasses OCR entirely;
- bounded multimodal extraction through the configured OpenAI-compatible provider for image captures and, when explicitly enabled, PDF files.

The backend validates every stored capture again before reading it, preserves page order, propagates cancellation, applies one operation deadline through the centralized AI executor and releases the lazy provider during hibernation. The browser never contacts the provider directly.

Configuration:

```dotenv
BASKETRA_AI_IMAGE_CAPABILITY=true
BASKETRA_AI_PDF_CAPABILITY=false
```

PDF capability is disabled by default because OpenAI-compatible servers vary in file-message support. Enable it only after the provider connection and a synthetic PDF fixture have been verified. When usable embedded text is supplied, Basketra does not invoke image/PDF OCR.

Current limitations:

- Basketra does not yet parse embedded PDF text itself; the client or a future PDF adapter must supply that text, otherwise a PDF-capable provider is required.
- The provider returns a transcription proposal, not trusted application data.
- Accuracy depends on capture quality, provider capability and model selection.
- The current server path sends validated files as bounded data URLs; very long receipts should be split into ordered captures.
- A client-side Web Worker OCR adapter remains possible for fully local extraction but is not bundled.

Required deployment validation includes privacy-safe synthetic Mercadona, Alcampo, Lidl, Carrefour, long-ticket, PDF, weight, discount and split-line fixtures. No real personal receipts belong in Git or CI.

OCR output, deterministic parsing and AI interpretation are stored separately. Arithmetic is recalculated independently, uncertain lines are prioritized for review, and user corrections never overwrite original evidence.
