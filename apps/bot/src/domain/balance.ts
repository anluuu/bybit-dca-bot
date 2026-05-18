import {
  ExchangeClientError,
  getFundingBalance,
  getSpotBalance,
  transferFundingToSpot,
} from "../infra/exchange.js";
import { logger } from "../logger.js";
import { notifyTransfer } from "../infra/notifications.js";

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
// a second transfer.
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
      const rawSpot = await getSpotBalance(coin);
      // Belt-and-suspenders: getSpotBalance / getFundingBalance already
      // coerce non-finite values to 0, but guard here too so NaN cannot
      // sneak past the comparisons below and reach transferFundingToSpot
      // with a NaN amount (Bybit rejects with 131203).
      const spot = Number.isFinite(rawSpot) ? rawSpot : 0;
      if (spot >= required) {
        return { transferred: false };
      }

      const deficit = required - spot;
      const rawFunding = await getFundingBalance(coin);
      const funding = Number.isFinite(rawFunding) ? rawFunding : 0;

      if (spot + funding < required) {
        throw new InsufficientFundsError(spot + funding, required, coin);
      }

      // Move deficit + 10% buffer, but never request more than Funding holds.
      const targetAmount = deficit * 1.1;
      const transferAmount = Math.min(targetAmount, funding);

      let transferId: string;
      try {
        ({ transferId } = await transferFundingToSpot(coin, transferAmount));
      } catch (error) {
        // Bybit can still return 170131 on the transfer itself if Funding
        // actually held less than getFundingBalance reported (e.g. a manual
        // withdrawal raced our pre-check). Translate to InsufficientFundsError
        // so the strategy layer can fire the dedicated critical Telegram alert
        // instead of swallowing this as a generic ExchangeClientError.
        if (
          error instanceof ExchangeClientError &&
          error.statusCode === 170131
        ) {
          throw new InsufficientFundsError(spot + funding, required, coin);
        }
        throw error;
      }

      logger.info("Auto-transfer Funding→Spot", {
        coin,
        amount: transferAmount.toFixed(2),
        transferId,
        spotBefore: spot.toFixed(2),
        fundingBefore: funding.toFixed(2),
      });

      await notifyTransfer(transferAmount, coin, transferId);

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
