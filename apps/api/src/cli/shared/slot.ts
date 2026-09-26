export type Slot = 0 | 1;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * `--slot 0` / `--slot=1` だけを受け付ける。他の値・欠落・重複・未知の引数は CliUsageError。
 */
export function parseSlot(argv: readonly string[]): Slot {
  let raw: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    let value: string | undefined;
    if (arg === "--slot") {
      value = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--slot=")) {
      value = arg.slice("--slot=".length);
    } else {
      throw new CliUsageError(`unknown argument: ${arg}`);
    }
    if (value === undefined || raw !== null) {
      throw new CliUsageError("usage: --slot 0|1");
    }
    raw = value;
  }
  if (raw !== "0" && raw !== "1") {
    throw new CliUsageError("usage: --slot 0|1");
  }
  return raw === "0" ? 0 : 1;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CliUsageError(`${name} is not set`);
  }
  return value;
}
