import {
  ExchangeClientError,
  getFundingBalance,
  getSpotBalance,
  transferFundingToSpot,
} from "./exchange.js";
import { logger } from "./logger.js";

export class InsufficientFundsError extends ExchangeClientError {
  constructor(
    public available: number,
    public required: number,
    public coin: string
  ) {
    super(
      `Insufficient ${coin} balance: have ${available.toFixed(2)} (Spot + Funding), need ${required.toFixed(2)}`
    );
    this.name = "InsufficientFundsError";
  }
}

export interface EnsureResult {
  transferred: boolean;
  transferredAmount?: number;
  transferId?: string;
}

// Module-level coalescing lock: if two concurrent code paths (e.g. a scheduled
// DCA racing a manual run-now) both ask to ensure the same coin's Spot
// balance, the second caller awaits the first's Promise instead of launching
// a second transfer. Mirrors the pattern in priceCache.ts.
const inflight = new Map<string, Promise<EnsureResult>>();

export async function ensureSpotBalance(
  coin: string,
  required: number
): Promise<EnsureResult> {
  const existing = inflight.get(coin);
  if (existing) {
    return existing;
  }

  const work = (async (): Promise<EnsureResult> => {
    try {
      const spot = await getSpotBalance(coin);
      if (spot >= required) {
        return { transferred: false };
      }

      const deficit = required - spot;
      const funding = await getFundingBalance(coin);

      if (spot + funding < required) {
        throw new InsufficientFundsError(spot + funding, required, coin);
      }

      // Move deficit + 10% buffer, but never request more than Funding holds.
      const targetAmount = deficit * 1.1;
      const transferAmount = Math.min(targetAmount, funding);

      const { transferId } = await transferFundingToSpot(coin, transferAmount);

      logger.info("Auto-transfer Funding→Spot", {
        coin,
        amount: transferAmount.toFixed(2),
        transferId,
        spotBefore: spot.toFixed(2),
        fundingBefore: funding.toFixed(2),
      });

      return {
        transferred: true,
        transferredAmount: transferAmount,
        transferId,
      };
    } finally {
      inflight.delete(coin);
    }
  })();

  inflight.set(coin, work);
  return work;
}
