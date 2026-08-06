const SPEC_PATH = '/tests/browser/';

export async function resolve(specifier, context, nextResolve) {
  const parentUrl = context.parentURL || '';
  if (
    specifier === '@playwright/test'
    && parentUrl.includes(SPEC_PATH)
    && parentUrl.endsWith('.spec.mjs')
  ) {
    return {
      url: new URL('./coverage-fixture.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
