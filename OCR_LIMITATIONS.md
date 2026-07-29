# OCR limitations

Basketra defines a replaceable `OcrProvider` and implements embedded-text extraction behavior. The current UI preserves image/PDF captures and allows manual or embedded-text transcription and correction.

A production OCR engine is not bundled yet. It must meet these requirements before adoption:

- lazy load only within receipt capture;
- browser Web Worker or short-lived server process;
- cancellation and progress;
- termination after completion;
- bounded image dimensions and memory;
- synthetic Mercadona, Alcampo, Lidl, Carrefour, long-ticket, PDF, weight, discount, and split-line fixtures;
- no receipt content in logs;
- maintained official package, verified version, license, scripts, and vulnerabilities.

OCR output is evidence, not trusted data. Arithmetic and user review remain mandatory.
