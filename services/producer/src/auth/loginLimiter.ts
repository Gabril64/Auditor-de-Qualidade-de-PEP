const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

interface Counter {
  failures: number;
  resetAt: number;
}

const counters = new Map<string, Counter>();

function current(key: string, now: number): Counter | undefined {
  const counter = counters.get(key);
  if (counter && counter.resetAt <= now) {
    counters.delete(key);
    return undefined;
  }
  return counter;
}

/** Seconds until the login may be tried again, or 0 when it is not blocked. In-memory: it resets
 * when the Producer restarts, which is acceptable with a single Producer process. */
export function retryAfterSeconds(email: string, ip: string, now = Date.now()): number {
  const limits: Array<[string, number]> = [
    [`email:${email.toLowerCase()}`, MAX_FAILURES_PER_EMAIL],
    [`ip:${ip}`, MAX_FAILURES_PER_IP],
  ];
  let wait = 0;
  for (const [key, max] of limits) {
    const counter = current(key, now);
    if (counter && counter.failures >= max) wait = Math.max(wait, Math.ceil((counter.resetAt - now) / 1000));
  }
  return wait;
}

export function recordFailure(email: string, ip: string, now = Date.now()): void {
  for (const key of [`email:${email.toLowerCase()}`, `ip:${ip}`]) {
    const counter = current(key, now) ?? { failures: 0, resetAt: now + WINDOW_MS };
    counter.failures++;
    counters.set(key, counter);
  }
}

export function recordSuccess(email: string): void {
  counters.delete(`email:${email.toLowerCase()}`);
}
