# Production AI timeout evidence

- Production Basketra `1.0.4` logged `ai.capability_probe_failed` with `status=504` and `code=AI_TIMEOUT` for request `ff275ff5-be38-410c-a007-e1bed01c4ee1`.
- The Settings UI reported that the multimodal probe exceeded a configured timeout while calling the configured `/v1/chat/completions` endpoint.
- Code inspection identified the Basketra-owned deadline in `OpenAiCompatibleProvider.executeStructured()`, where an internal timer aborted the provider request independently of the caller.
- This task removes that internal deadline. Provider-originated HTTP `408`/`504` responses remain classified as `AI_TIMEOUT`.
- No credential value, provider body, receipt content, image bytes, prompt, or schema payload is recorded here.
