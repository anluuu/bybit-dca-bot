import { getInstrumentInfo as fetchFromBybit } from "./bybit.js";

export interface InstrumentSpec {
  symbol: string;
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  tickSize: number;
}

const cache = new Map<string, Promise<InstrumentSpec>>();

export async function getInstrumentSpec(symbol: string): Promise<InstrumentSpec> {
  const existing = cache.get(symbol);
  if (existing) return existing;
  const p = (async () => {
    const raw = await fetchFromBybit(symbol);
    const spec: InstrumentSpec = {
      symbol: raw.symbol,
      qtyStep: Number(raw.lotSizeFilter.qtyStep),
      minOrderQty: Number(raw.lotSizeFilter.minOrderQty),
      maxOrderQty: Number(raw.lotSizeFilter.maxOrderQty),
      tickSize: Number(raw.priceFilter.tickSize),
    };
    return spec;
  })();
  cache.set(symbol, p);
  // Drop cache entry if the fetch failed so the next caller can retry.
  p.catch(() => cache.delete(symbol));
  return p;
}

// Test seam: lets tests clear or pre-populate the cache.
export function __resetCache(): void {
  cache.clear();
}
