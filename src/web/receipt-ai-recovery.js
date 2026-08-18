const RECOVERY_GUIDANCE = Object.freeze({
  AI_AUTHENTICATION_FAILED: 'webApi rechazó el token gestionado. Crea o habilita un token en /admin, actualiza BASKETRA_AI_API_KEY y recrea Basketra antes de reintentar.',
  AI_UNREACHABLE: 'No hay conectividad con el proveedor. Revisa la dirección privada, el puerto, la VPN o el firewall antes de reintentar.',
  AI_TIMEOUT: 'webApi o el proveedor agotó su propio tiempo de espera. Basketra no impone un límite de tiempo a la verificación.',
  AI_RATE_LIMITED: 'El proveedor alcanzó su límite de solicitudes. Espera y reintenta con IA más tarde.',
  AI_ATTACHMENT_TOO_LARGE: 'El proveedor rechazó el tamaño del adjunto. Reduce, recorta o divide la captura antes de reintentar.',
  AI_ATTACHMENT_UPLOAD_FAILED: 'webApi no pudo preparar el adjunto en su sesión de navegador. Repara o renueva esa sesión antes de reintentar.',
  AI_IMAGE_CAPABILITY_UNAVAILABLE: 'El modelo configurado no ha demostrado capacidad de imagen. Ejecuta el diagnóstico estricto o selecciona un modelo compatible.',
  AI_PDF_CAPABILITY_UNAVAILABLE: 'El modelo configurado no ha demostrado capacidad PDF. Usa imágenes compatibles o completa el ticket manualmente.',
  AI_REQUEST_REJECTED: 'El proveedor rechazó la solicitud. Revisa el modelo y el contrato OpenAI-compatible antes de reintentar.',
  AI_INVALID_RESPONSE: 'El proveedor respondió sin respetar el JSON Schema estricto. Revisa la capacidad de salida estructurada.',
  AI_EMPTY_RESPONSE: 'El proveedor terminó sin devolver una respuesta estructurada. Reintenta o revisa su estado.',
  AI_RESPONSE_TOO_LARGE: 'La respuesta superó el límite de respuesta configurado. Revisa el modelo o los límites antes de reintentar.',
  AI_PROVIDER_FAILED: 'El proveedor falló durante la verificación. Revisa webApi y reintenta cuando esté estable.',
});

function normalizedCode(error) {
  return typeof error?.code === 'string' ? error.code.trim() : '';
}

function normalizedMessage(error) {
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'No se pudo procesar esta imagen';
}

function manualReviewEvidence(hasOcrDraft) {
  return hasOcrDraft
    ? 'El OCR de esta imagen se conserva localmente, pero no se considera un ticket estructurado válido hasta reintentar con IA o revisar manualmente todas las líneas.'
    : 'No se obtuvo un borrador OCR utilizable; la captura original se conserva para que puedas reintentar.';
}

export function buildReceiptAiRecovery(error, options = {}) {
  const code = normalizedCode(error);
  const mimeType = typeof options.mimeType === 'string' ? options.mimeType : '';
  const hasOcrDraft = options.hasOcrDraft === true;

  if (code === 'AI_NOT_CONFIGURED' && mimeType === 'application/pdf') {
    return {
      message: 'Este PDF necesita un proveedor compatible. La captura original se conserva y puedes completar el ticket manualmente desde cero.',
      retryLabel: 'Reintentar imagen',
      manualLabel: 'Revisar manualmente',
      allowManualReview: true,
    };
  }

  if (code.startsWith('AI_')) {
    const guidance = RECOVERY_GUIDANCE[code]
      || 'El proveedor de IA no pudo completar la verificación. Revisa su configuración y vuelve a intentarlo.';
    return {
      message: `${guidance} ${manualReviewEvidence(hasOcrDraft)}`,
      retryLabel: 'Reintentar imagen',
      manualLabel: 'Revisar manualmente',
      allowManualReview: hasOcrDraft,
    };
  }

  return {
    message: `${normalizedMessage(error)}. Reintenta esta imagen o retírala del borrador.`,
    retryLabel: 'Reintentar imagen',
    manualLabel: 'Revisar manualmente',
    allowManualReview: false,
  };
}
