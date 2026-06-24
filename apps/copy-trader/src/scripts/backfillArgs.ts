export type BackfillCliOptions = {
  limit: number;
  batchSize: number;
  beforeId?: number;
  dryRun: boolean;
  help: boolean;
};

const DEFAULTS: BackfillCliOptions = {
  limit: 1000,
  batchSize: 100,
  dryRun: false,
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

function positiveInt(raw: string, label: string, max?: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  if (max != null && value > max) {
    throw new Error(`${label} must be <= ${max}`);
  }
  return value;
}

export function parseBackfillArgs(args: string[]): BackfillCliOptions {
  const options: BackfillCliOptions = { ...DEFAULTS };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const [raw, nextIndex] = readOption(args, i, "--limit");
      options.limit = positiveInt(raw, "limit", 100_000);
      i = nextIndex;
    } else if (arg === "--batch-size" || arg.startsWith("--batch-size=")) {
      const [raw, nextIndex] = readOption(args, i, "--batch-size");
      options.batchSize = positiveInt(raw, "batch-size", 100);
      i = nextIndex;
    } else if (arg === "--before-id" || arg.startsWith("--before-id=")) {
      const [raw, nextIndex] = readOption(args, i, "--before-id");
      options.beforeId = positiveInt(raw, "before-id");
      i = nextIndex;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}
