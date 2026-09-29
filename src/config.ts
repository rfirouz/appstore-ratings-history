import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { STOREFRONTS, countryCode } from "./storefronts.ts";

export type AscConfig = { keyId: string; issuerId: string; privateKey: string };

export type Config = {
  apps: string[];
  countries: string[];
  dataDir: string;
  requestDelayMs: number;
  asc: AscConfig | null;
  warnings: string[];
};

type Env = Record<string, string | undefined>;

export function loadDotEnv(dir = process.cwd()): void {
  const path = resolve(dir, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

function value(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

/** Accepts plain IDs, "id123", or App Store links, separated by commas, spaces or new lines. */
export function parseAppIds(raw: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    const match = /(?:^|\/id|^id)(\d{6,12})(?:$|[/?#])/.exec(part);
    if (match?.[1]) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    } else {
      invalid.push(part);
    }
  }
  return { ids, invalid };
}

function readKey(env: Env): string {
  const inline = value(env, "ASC_PRIVATE_KEY");
  if (inline) return inline.replaceAll("\\n", "\n");
  const path = value(env, "ASC_PRIVATE_KEY_PATH");
  if (!path) return "";
  return readFileSync(path.startsWith("~") ? homedir() + path.slice(1) : path, "utf8");
}

export function readConfig(env: Env = process.env): Config {
  const warnings: string[] = [];
  const { ids, invalid } = parseAppIds(value(env, "APP_IDS"));
  if (invalid.length) warnings.push(`Ignored APP_IDS entries that are not App Store IDs: ${invalid.join(", ")}`);

  const known = new Set(STOREFRONTS.map((item) => item.code));
  let countries = STOREFRONTS.map((item) => item.code);
  const wanted = value(env, "COUNTRIES");
  if (wanted) {
    const picked = wanted.split(/[\s,]+/).filter(Boolean).map(countryCode);
    const unknown = picked.filter((code) => !known.has(code));
    if (unknown.length) warnings.push(`Ignored unknown COUNTRIES: ${unknown.join(", ")}`);
    countries = picked.filter((code, index) => known.has(code) && picked.indexOf(code) === index);
  }

  const delay = Number(value(env, "REQUEST_DELAY_MS") || 3000);

  const keyId = value(env, "ASC_KEY_ID");
  const issuerId = value(env, "ASC_ISSUER_ID");
  const anyAsc = keyId || issuerId || value(env, "ASC_PRIVATE_KEY") || value(env, "ASC_PRIVATE_KEY_PATH");
  let asc: AscConfig | null = null;
  if (anyAsc) {
    const privateKey = readKey(env);
    if (keyId && issuerId && privateKey) {
      asc = { keyId, issuerId, privateKey };
    } else {
      warnings.push("App Store Connect is partly configured. Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY to use it; skipping it for now.");
    }
  }

  return {
    apps: ids,
    countries,
    dataDir: resolve(value(env, "DATA_DIR") || "data"),
    requestDelayMs: Number.isFinite(delay) && delay >= 0 ? delay : 3000,
    asc,
    warnings,
  };
}
