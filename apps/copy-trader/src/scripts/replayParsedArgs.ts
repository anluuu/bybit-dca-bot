export type ReplayParsedCliOptions = {
  limit: number;
  balanceUsdt: number;
  oldestFirst: boolean;
  help: boolean;
};

const DEFAULTS: ReplayParsedCliOptions = {
  limit: 10,
  balanceUsdt: 1000,
  oldestFirst: false,
  help: false,
};

function readOption(args: string[], index: number, name: string): [string, number] {
  const arg = args[index];
  const inline = arg.match(new RegExp(`^${name}=(.+)$`));
  if (inline) return [inline[1], index];
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
  return [next, index + 1];
}

function positiveNumber(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function positiveInt(raw: string, label: string): number {
  const value = positiveNumber(raw, label);
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
}

export function parseReplayParsedArgs(args: string[]): ReplayParsedCliOptions {
  const options: ReplayParsedCliOptions = { ...DEFAULTS };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--oldest-first") {
      options.oldestFirst = true;
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const [raw, nextIndex] = readOption(args, i, "--limit");
      options.limit = positiveInt(raw, "limit");
      i = nextIndex;
    } else if (arg === "--balance-usdt" || arg.startsWith("--balance-usdt=")) {
      const [raw, nextIndex] = readOption(args, i, "--balance-usdt");
      options.balanceUsdt = positiveNumber(raw, "balance-usdt");
      i = nextIndex;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}
