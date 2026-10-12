import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";

export interface PushedMessage {
  key: string;
  value: string;
}

export interface Session {
  cookie: string;
  csrfToken: string;
}

export interface Harness {
  base: string;
  store: Map<string, string>;
  pushed: PushedMessage[];
  addUser(email: string, password: string, role: "auditor" | "admin", mustChangePassword?: boolean): Promise<number>;
  login(email: string, password: string): Promise<Session>;
  fetchAs(session: Session | null, route: string, init?: RequestInit): Promise<Response>;
  reset(): void;
}

/** Starts the Producer on a free port, with a temporary SQLite file and an in-memory Redis stand-in.
 * Each test file runs in its own process, so every file gets an isolated server. */
export async function startHarness(): Promise<Harness> {
  const store = new Map<string, string>();
  const pushed: PushedMessage[] = [];

  const fakeClient = {
    on() {},
    async connect() {},
    async lPush(key: string, value: string) {
      pushed.push({ key, value });
      return pushed.length;
    },
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return "OK";
    },
    async expire() {
      return true;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  };
  mock.module("redis", { namedExports: { createClient: () => fakeClient } });

  const port = await new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port: freePort } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(freePort));
    });
  });
  process.env.SQLITE_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "producer-test-")), "auditor.db");
  process.env.PORT = String(port);
  process.env.DISABLE_BACKGROUND_JOBS = "1";
  const base = `http://127.0.0.1:${port}`;

  await import("../../src/server.js");
  const { hashPassword } = await import("../../src/auth/passwords.js");
  const { insertUser } = await import("../../src/repositories/users.js");

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (attempt === 99) throw new Error("Producer did not start");
  }

  async function login(email: string, password: string): Promise<Session> {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.status !== 200) throw new Error(`Login failed with ${response.status}`);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    const { csrf_token: csrfToken } = (await response.json()) as { csrf_token: string };
    return { cookie, csrfToken };
  }

  return {
    base,
    store,
    pushed,
    async addUser(email, password, role, mustChangePassword = false) {
      return insertUser({
        email,
        name: email,
        passwordHash: await hashPassword(password),
        role,
        createdBy: null,
        mustChangePassword,
      });
    },
    login,
    fetchAs(session, route, init = {}) {
      const headers = new Headers(init.headers);
      if (session) {
        headers.set("cookie", session.cookie);
        headers.set("x-csrf-token", session.csrfToken);
      }
      return fetch(`${base}${route}`, { ...init, headers });
    },
    reset() {
      for (const key of [...store.keys()]) if (!key.startsWith("sessao:")) store.delete(key);
      pushed.length = 0;
    },
  };
}
