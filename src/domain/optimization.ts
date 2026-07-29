import { normalizeOffer, type Offer } from './offers.ts';

export type ShoppingRequirement = Readonly<{
  itemId: string;
  label: string;
  exactRequired: boolean;
  substitutionAllowed: boolean;
}>;

export type OptimizationInput = Readonly<{
  requirements: readonly ShoppingRequirement[];
  offers: readonly Offer[];
  retailerPenaltyMinor: number;
  maxRetailers?: number;
  travelCostMinorByRetailer?: Readonly<Record<string, number>>;
}>;

export type OptimizationPlan = Readonly<{
  kind: 'single-retailer' | 'balanced' | 'maximum-saving';
  retailerIds: readonly string[];
  selectedOffers: readonly Offer[];
  missingItemIds: readonly string[];
  productSubtotalMinor: number;
  shippingMinor: number;
  travelMinor: number;
  penaltyMinor: number;
  effectiveTotalMinor: number;
  substitutions: readonly string[];
  confidence: number;
  explanation: string;
}>;

function subsets(values: readonly string[], maxSize: number): string[][] {
  const result: string[][] = [];
  const count = 1 << values.length;
  for (let mask = 1; mask < count; mask += 1) {
    const selected = values.filter((_, index) => (mask & (1 << index)) !== 0);
    if (selected.length <= maxSize) result.push(selected);
  }
  return result;
}

function selectBestOffer(requirement: ShoppingRequirement, offers: readonly Offer[], retailers: ReadonlySet<string>): Offer | undefined {
  return offers
    .filter((offer) => offer.itemId === requirement.itemId && retailers.has(offer.retailerId) && offer.stock === 'in-stock')
    .filter((offer) => offer.exact || (!requirement.exactRequired && requirement.substitutionAllowed))
    .map(normalizeOffer)
    .sort((left, right) => left.effectiveMinor - right.effectiveMinor || right.confidence - left.confidence || left.id.localeCompare(right.id))[0];
}

function buildPlan(kind: OptimizationPlan['kind'], input: OptimizationInput, retailerIds: readonly string[], applyPenalty: boolean): OptimizationPlan {
  const retailerSet = new Set(retailerIds);
  const selectedOffers: Offer[] = [];
  const missingItemIds: string[] = [];
  const substitutions: string[] = [];
  for (const requirement of input.requirements) {
    const offer = selectBestOffer(requirement, input.offers, retailerSet);
    if (!offer) {
      missingItemIds.push(requirement.itemId);
      continue;
    }
    selectedOffers.push(offer);
    if (!offer.exact) substitutions.push(`${requirement.label} → ${offer.title}`);
  }
  const productSubtotalMinor = selectedOffers.reduce((sum, offer) => sum + offer.priceMinor - (offer.promotionMinor ?? 0), 0);
  const shippingMinor = [...new Set(selectedOffers.map((offer) => offer.retailerId))].reduce((sum, retailerId) => {
    const retailerOffers = selectedOffers.filter((offer) => offer.retailerId === retailerId);
    return sum + Math.max(...retailerOffers.map((offer) => normalizeOffer(offer).shippingMinor));
  }, 0);
  const travelMinor = retailerIds.reduce((sum, retailerId) => sum + (input.travelCostMinorByRetailer?.[retailerId] ?? 0), 0);
  const penaltyMinor = applyPenalty ? Math.max(0, retailerIds.length - 1) * input.retailerPenaltyMinor : 0;
  const missingPenalty = missingItemIds.length * 1_000_000;
  const effectiveTotalMinor = productSubtotalMinor + shippingMinor + travelMinor + penaltyMinor + missingPenalty;
  const confidence = selectedOffers.length === 0 ? 0 : selectedOffers.reduce((sum, offer) => sum + offer.confidence, 0) / selectedOffers.length;
  return {
    kind,
    retailerIds: [...retailerIds].sort(),
    selectedOffers,
    missingItemIds,
    productSubtotalMinor,
    shippingMinor,
    travelMinor,
    penaltyMinor,
    effectiveTotalMinor,
    substitutions,
    confidence,
    explanation: missingItemIds.length > 0 ? `Missing ${missingItemIds.length} item(s); incomplete plans are penalized.` : `${retailerIds.length} retailer(s), ${substitutions.length} substitution(s).`,
  };
}

function choose(plans: readonly OptimizationPlan[]): OptimizationPlan {
  const sorted = [...plans].sort((left, right) => left.effectiveTotalMinor - right.effectiveTotalMinor || left.retailerIds.length - right.retailerIds.length || left.retailerIds.join(',').localeCompare(right.retailerIds.join(',')));
  return sorted[0]!;
}

export function optimizeBasket(input: OptimizationInput): readonly OptimizationPlan[] {
  if (!Number.isSafeInteger(input.retailerPenaltyMinor) || input.retailerPenaltyMinor < 0) throw new RangeError('Retailer penalty must be a non-negative safe integer');
  const retailerIds = [...new Set(input.offers.map((offer) => offer.retailerId))].sort();
  if (retailerIds.length === 0) throw new RangeError('At least one offer is required');
  if (retailerIds.length > 12) throw new RangeError('Retailer enumeration is capped at 12');
  const maxRetailers = input.maxRetailers ?? retailerIds.length;
  if (!Number.isSafeInteger(maxRetailers) || maxRetailers < 1) throw new RangeError('Maximum retailer count must be a positive safe integer');
  const candidates = subsets(retailerIds, Math.min(maxRetailers, retailerIds.length));
  const single = choose(candidates.filter((set) => set.length === 1).map((set) => buildPlan('single-retailer', input, set, false)));
  const balanced = choose(candidates.map((set) => buildPlan('balanced', input, set, true)));
  const saving = choose(candidates.map((set) => buildPlan('maximum-saving', input, set, false)));
  return [single, balanced, saving];
}
