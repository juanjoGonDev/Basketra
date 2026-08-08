export const REALTIME_ENTITY_TYPES = ['shopping-list', 'shopping-list-item', 'product', 'category', 'store', 'price-observation'] as const;
export const REALTIME_MUTATION_TYPES = ['created', 'updated', 'deleted', 'reordered'] as const;

export type RealtimeEntityType = typeof REALTIME_ENTITY_TYPES[number];
export type RealtimeMutationType = typeof REALTIME_MUTATION_TYPES[number];

export type RealtimeInvalidation = Readonly<{
  entityType: RealtimeEntityType;
  mutation: RealtimeMutationType;
  updatedAt: string;
  version?: number;
  listId?: string;
  entityId?: string;
}>;

export type RealtimeListener = (event: RealtimeInvalidation) => void;

export class RealtimeHub {
  readonly #listeners = new Set<RealtimeListener>();
  readonly #maxClients: number;

  constructor(maxClients = 8) {
    if (!Number.isSafeInteger(maxClients) || maxClients < 1 || maxClients > 64) {
      throw new RangeError('Realtime max clients must be between 1 and 64');
    }
    this.#maxClients = maxClients;
  }

  get clientCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: RealtimeListener): () => void {
    if (this.#listeners.size >= this.#maxClients) {
      throw new Error('REALTIME_CLIENT_LIMIT_REACHED');
    }
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  publish(event: RealtimeInvalidation): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
