export type GateSignal = {
  signalHash: string;
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  leverageRaw: number;
};

export type GateContext = {
  config: {
    MAX_OPEN_POSITIONS: number;
    DAILY_LOSS_LIMIT_PCT: number;
    MAX_DRAWDOWN_PCT: number;
    CHASE_TOLERANCE_PCT: number;
    MIN_RR_RATIO: number;
    WHITELIST_SYMBOLS: string[];
  };
  state: {
    killed: boolean;
    killedReason: string | null;
    cooldownUntil: Date | null;
    initialCapital: number;
  };
  balance: number;
  openCount: number;
  dayPnl: number;
  dayBalanceStart: number;
  lastPrice: number;
  now: Date;
};

export type GateResult =
  | {
      ok: true;
      entryStrategy: "MARKET" | "LIMIT_CHASE";
      limitPrice?: number;
    }
  | {
      ok: false;
      reason:
        | "KILL_SWITCH_ACTIVE"
        | "SYMBOL_NOT_WHITELISTED"
        | "COOLDOWN_AFTER_LOSS"
        | "MAX_OPEN_POSITIONS"
        | "DAILY_LOSS_LIMIT"
        | "KILL_SWITCH_DRAWDOWN"
        | "PRICE_TOO_FAR"
        | "INVALID_SIGNAL_SL"
        | "INVALID_SIGNAL_TP"
        | "RR_TOO_LOW";
      meta?: Record<string, unknown>;
    };

export function evaluateRiskGate(signal: GateSignal, c: GateContext): GateResult {
  // G1: Kill switch
  if (c.state.killed) {
    return { ok: false, reason: "KILL_SWITCH_ACTIVE", meta: { killedReason: c.state.killedReason } };
  }

  // G2 (whitelist)
  if (!c.config.WHITELIST_SYMBOLS.includes(signal.symbol)) {
    return { ok: false, reason: "SYMBOL_NOT_WHITELISTED", meta: { symbol: signal.symbol } };
  }

  // G3 (cooldown)
  if (c.state.cooldownUntil && c.state.cooldownUntil > c.now) {
    return { ok: false, reason: "COOLDOWN_AFTER_LOSS", meta: { until: c.state.cooldownUntil.toISOString() } };
  }

  // G4 (max open)
  if (c.openCount >= c.config.MAX_OPEN_POSITIONS) {
    return { ok: false, reason: "MAX_OPEN_POSITIONS", meta: { openCount: c.openCount } };
  }

  // G5 (daily loss)
  if (c.dayBalanceStart > 0) {
    const lossPct = (-c.dayPnl / c.dayBalanceStart) * 100;
    if (lossPct >= c.config.DAILY_LOSS_LIMIT_PCT) {
      return { ok: false, reason: "DAILY_LOSS_LIMIT", meta: { lossPct } };
    }
  }

  // G6 (drawdown)
  if (c.state.initialCapital > 0) {
    const drawdownPct = ((c.state.initialCapital - c.balance) / c.state.initialCapital) * 100;
    if (drawdownPct >= c.config.MAX_DRAWDOWN_PCT) {
      return { ok: false, reason: "KILL_SWITCH_DRAWDOWN", meta: { drawdownPct } };
    }
  }

  // Sanity: SL direction
  if (signal.direction === "LONG" && signal.stopLoss >= signal.entryLow) {
    return { ok: false, reason: "INVALID_SIGNAL_SL" };
  }
  if (signal.direction === "SHORT" && signal.stopLoss <= signal.entryHigh) {
    return { ok: false, reason: "INVALID_SIGNAL_SL" };
  }

  // Sanity: TP direction — reject only if TP is on the wrong side of the entire entry zone
  if (signal.direction === "LONG" && signal.takeProfit1 <= signal.entryLow) {
    return { ok: false, reason: "INVALID_SIGNAL_TP" };
  }
  if (signal.direction === "SHORT" && signal.takeProfit1 >= signal.entryHigh) {
    return { ok: false, reason: "INVALID_SIGNAL_TP" };
  }

  // R:R
  const entryMid = (signal.entryLow + signal.entryHigh) / 2;
  const risk = Math.abs(entryMid - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit1 - entryMid);
  if (risk > 0 && reward / risk < c.config.MIN_RR_RATIO) {
    return { ok: false, reason: "RR_TOO_LOW", meta: { rr: reward / risk } };
  }

  // G7 (price in chase range)
  const tolerance = signal.entryHigh * (c.config.CHASE_TOLERANCE_PCT / 100);
  const expandedLow = signal.entryLow - tolerance;
  const expandedHigh = signal.entryHigh + tolerance;
  if (c.lastPrice >= signal.entryLow && c.lastPrice <= signal.entryHigh) {
    return { ok: true, entryStrategy: "MARKET" };
  }
  if (c.lastPrice >= expandedLow && c.lastPrice <= expandedHigh) {
    const limitPrice = signal.direction === "LONG" ? signal.entryLow : signal.entryHigh;
    return { ok: true, entryStrategy: "LIMIT_CHASE", limitPrice };
  }
  return { ok: false, reason: "PRICE_TOO_FAR", meta: { lastPrice: c.lastPrice } };
}
