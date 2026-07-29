import type { Offer } from '../domain/offers.ts';

export type OfferSearchInput = Readonly<{ itemId: string; query: string; signal?: AbortSignal }>;

export interface OfferProvider {
  readonly name: string;
  search(input: OfferSearchInput): Promise<readonly Offer[]>;
  dispose(): void;
}

export class ManualOfferProvider implements OfferProvider {
  readonly name = 'manual';
  readonly offers: readonly Offer[];
  constructor(offers: readonly Offer[]) {
    this.offers = offers;
  }
  async search(input: OfferSearchInput): Promise<readonly Offer[]> {
    input.signal?.throwIfAborted();
    return this.offers.filter((offer) => offer.itemId === input.itemId);
  }
  dispose(): void {}
}
