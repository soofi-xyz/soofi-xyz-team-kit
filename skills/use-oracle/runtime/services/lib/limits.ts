/**
 * In-process concurrency gates (durable-workflow-builder pattern 2).
 *
 * The Restate server does not cap per-service concurrency on this stack, so
 * each named stage/portal gets one semaphore in the services process with its
 * limit from `CONCURRENCY_<NAME>`. Empty, zero or garbage values fall back.
 * Change a cap by editing `.env` and restarting the services process; in-flight
 * invocations resume from their journals.
 */
import { envPart } from "./config.ts";

type Task<T> = () => Promise<T>;

class Semaphore {
  readonly limit: number;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: Task<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  get inFlight(): number {
    return this.active;
  }
}

const gates = new Map<string, Semaphore>();

function configuredLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[`CONCURRENCY_${envPart(name)}`]);
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : Math.max(1, Math.trunc(fallback) || 1);
}

/** Gate keyed by name; the cap comes from `CONCURRENCY_<NAME>`. */
export function gate(name: string, fallback: number) {
  const key = envPart(name);
  let semaphore = gates.get(key);
  if (!semaphore) {
    semaphore = new Semaphore(configuredLimit(name, fallback));
    gates.set(key, semaphore);
  }
  const bound = semaphore;
  return <T>(task: Task<T>): Promise<T> => bound.run(task);
}

/**
 * County-scoped cap when `CONCURRENCY_<STAGE>_<COUNTY>` is set, else the bare
 * stage cap (`CONCURRENCY_<STAGE>`).
 */
export function countyGate(stage: string, county: string, fallback: number) {
  const scoped = `${stage}_${county}`;
  return process.env[`CONCURRENCY_${envPart(scoped)}`]
    ? gate(scoped, fallback)
    : gate(stage, fallback);
}

/** Current caps and in-flight counts, for status endpoints and tests. */
export function gateSnapshot(): Record<string, { limit: number; inFlight: number }> {
  return Object.fromEntries(
    [...gates.entries()].map(([key, semaphore]) => [
      key,
      { limit: semaphore.limit, inFlight: semaphore.inFlight },
    ]),
  );
}

/** Test hook: forget every gate so new env values apply. */
export function resetGates(): void {
  gates.clear();
}
