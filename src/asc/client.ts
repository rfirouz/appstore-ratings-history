import { createPrivateKey, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { AscConfig } from "../config.ts";
import type { Deps } from "../lookup.ts";

const BASE = "https://api.appstoreconnect.apple.com";
const TOKEN_LIFETIME_S = 19 * 60;
const TOKEN_REUSE_MS = 15 * 60_000;
const RETRY_WAITS_MS = [2_000, 8_000, 30_000];

export class AscError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function ascToken(config: AscConfig, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: config.issuerId, iat: now, exp: now + TOKEN_LIFETIME_S, aud: "appstoreconnect-v1" }),
  );
  let key;
  try {
    key = createPrivateKey(config.privateKey);
  } catch {
    throw new AscError(0, "ASC_PRIVATE_KEY is not a valid .p8 key. Paste the whole file, including the BEGIN and END lines.");
  }
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(signature)}`;
}

type Json = { data?: unknown; links?: { next?: string }; errors?: { detail?: string; title?: string }[] };

export function createAscClient(config: AscConfig, deps: Pick<Deps, "fetch" | "sleep">) {
  let token = "";
  let tokenAt = 0;
  const auth = () => {
    if (!token || Date.now() - tokenAt > TOKEN_REUSE_MS) {
      token = ascToken(config);
      tokenAt = Date.now();
    }
    return `Bearer ${token}`;
  };

  const url = (path: string, params?: Record<string, string>) => {
    const target = new URL(path.startsWith("http") ? path : BASE + path);
    for (const [name, value] of Object.entries(params ?? {})) target.searchParams.set(name, value);
    return target.toString();
  };

  async function send(method: string, target: string, body?: unknown): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      const response = await deps.fetch(target, {
        method,
        headers: { Authorization: auth(), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
      const wait = RETRY_WAITS_MS[attempt];
      if ((response.status === 429 || response.status >= 500) && wait != null) {
        await deps.sleep(wait);
        continue;
      }
      const text = await response.text();
      const json = (text ? JSON.parse(text) : {}) as Json;
      if (!response.ok) {
        const detail = json.errors?.[0]?.detail ?? json.errors?.[0]?.title ?? text.slice(0, 300);
        throw new AscError(response.status, `App Store Connect ${method} ${new URL(target).pathname} failed (${response.status}): ${detail}`);
      }
      return json;
    }
  }

  return {
    get: (path: string, params?: Record<string, string>) => send("GET", url(path, params)),
    post: (path: string, body: unknown) => send("POST", url(path), body),

    async *pages(path: string, params?: Record<string, string>): AsyncGenerator<Json> {
      let next: string | undefined = url(path, params);
      while (next) {
        const page = await send("GET", next);
        yield page;
        next = page.links?.next;
      }
    },

    /** Report segments are pre-signed links; they are fetched without the token first. */
    async download(link: string): Promise<string> {
      let response = await deps.fetch(link, { signal: AbortSignal.timeout(120_000) });
      if (response.status === 401 || response.status === 403) {
        response = await deps.fetch(link, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(120_000) });
      }
      if (!response.ok) throw new AscError(response.status, `Report download failed (${response.status})`);
      const raw = Buffer.from(await response.arrayBuffer());
      return (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString("utf8");
    },
  };
}

export type AscClient = ReturnType<typeof createAscClient>;
