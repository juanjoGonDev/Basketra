import { normalizedMinorPerBaseUnit, type Quantity, type Rational } from './units.ts';

export type StockState = 'in-stock' | 'out-of-stock' | 'unknown';
export type Offer = Readonly<{
  id: string;
  itemId: string;
  retailerId: string;
  title: string;
  priceMinor: number;
  shippingMinor: number;
  quantity: Quantity;
  stock: StockState;
  observedAt: string;
  confidence: number;
  evidence: string;
  exact: boolean;
  substitutionQuality: number;
  primeEligible?: boolean;
  primeFreeDeliveryEvidence?: boolean;
  promotionMinor?: number;
  conditions?: readonly string[];
}>;

export type NormalizedOffer = Offer & Readonly<{ normalizedMinorPerBaseUnit: Rational; effectiveMinor: number }>;

export function normalizeOffer(offer: Offer): NormalizedOffer {
  const integers = [offer.priceMinor, offer.shippingMinor, offer.promotionMinor ?? 0];
  if (!integers.every(Number.isSafeInteger) || integers.some((value) => value < 0)) throw new RangeError('Offer money must be non-negative safe integers');
  if (offer.confidence < 0 || offer.confidence > 1 || offer.substitutionQuality < 0 || offer.substitutionQuality > 1) throw new RangeError('Offer scores must be between zero and one');
  if (!offer.evidence.trim()) throw new RangeError('Offer evidence is required');
  const shippingMinor = offer.primeEligible && offer.primeFreeDeliveryEvidence ? 0 : offer.shippingMinor;
  return {
    ...offer,
    shippingMinor,
    effectiveMinor: offer.priceMinor + shippingMinor - (offer.promotionMinor ?? 0),
    normalizedMinorPerBaseUnit: normalizedMinorPerBaseUnit(offer.priceMinor, offer.quantity),
  };
}
