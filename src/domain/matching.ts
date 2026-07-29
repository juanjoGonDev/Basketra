export type ProductCandidate = Readonly<{
  id: string;
  name: string;
  brand?: string;
  ean?: string;
  retailerSku?: string;
  packageMinor?: number;
  packageUnit?: string;
  dietaryTags?: readonly string[];
  confirmedAliases?: readonly string[];
  previousMappings?: readonly string[];
}>;

export type MatchInput = Readonly<{
  description: string;
  brand?: string;
  ean?: string;
  retailerSku?: string;
  packageMinor?: number;
  packageUnit?: string;
  dietaryTags?: readonly string[];
}>;

export type ProductMatch = Readonly<{
  candidate: ProductCandidate;
  score: number;
  reason: 'ean' | 'sku' | 'alias' | 'previous' | 'attributes' | 'lexical';
  requiresConfirmation: boolean;
}>;

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenScore(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function hasDietaryMismatch(input: MatchInput, candidate: ProductCandidate): boolean {
  const required = input.dietaryTags ?? [];
  const offered = new Set(candidate.dietaryTags ?? []);
  return required.some((tag) => !offered.has(tag));
}

function hasPackageMismatch(input: MatchInput, candidate: ProductCandidate): boolean {
  if (input.packageMinor === undefined || candidate.packageMinor === undefined) return false;
  if (input.packageUnit !== candidate.packageUnit) return true;
  return input.packageMinor !== candidate.packageMinor;
}

export function rankProductCandidates(input: MatchInput, candidates: readonly ProductCandidate[]): ProductMatch[] {
  const normalizedDescription = normalizeText(input.description);
  const matches: ProductMatch[] = [];
  for (const candidate of candidates) {
    if (hasDietaryMismatch(input, candidate)) continue;
    if (input.ean && candidate.ean === input.ean) {
      matches.push({ candidate, score: 1, reason: 'ean', requiresConfirmation: false });
      continue;
    }
    if (input.retailerSku && candidate.retailerSku === input.retailerSku) {
      matches.push({ candidate, score: 0.99, reason: 'sku', requiresConfirmation: false });
      continue;
    }
    if ((candidate.confirmedAliases ?? []).some((alias) => normalizeText(alias) === normalizedDescription)) {
      matches.push({ candidate, score: 0.98, reason: 'alias', requiresConfirmation: false });
      continue;
    }
    if ((candidate.previousMappings ?? []).some((mapping) => normalizeText(mapping) === normalizedDescription)) {
      matches.push({ candidate, score: 0.96, reason: 'previous', requiresConfirmation: false });
      continue;
    }
    const lexical = tokenScore(input.description, candidate.name);
    const brandMatch = input.brand && candidate.brand ? normalizeText(input.brand) === normalizeText(candidate.brand) : false;
    const packageMismatch = hasPackageMismatch(input, candidate);
    const score = Math.max(0, Math.min(0.95, lexical * 0.75 + (brandMatch ? 0.15 : 0) + (packageMismatch ? -0.2 : 0)));
    if (score > 0) {
      matches.push({ candidate, score, reason: brandMatch && !packageMismatch ? 'attributes' : 'lexical', requiresConfirmation: score < 0.9 });
    }
  }
  return matches.sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
}
