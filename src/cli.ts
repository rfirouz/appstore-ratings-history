#!/usr/bin/env node
import { collect } from "./collect.ts";
import { loadDotEnv, readConfig } from "./config.ts";
import { startDashboard } from "./server.ts";

const HELP = `appstore-ratings-history

Usage:
  collect      Take today's ratings snapshot for the apps in APP_IDS
  dashboard    Pull the latest snapshots and open the dashboard
               --port <n>   port to use (default 4321)
               --no-open    don't open a browser
               --no-pull    don't run "git pull" first

Settings come from environment variables or a .env file in this folder:
  APP_IDS             App Store IDs, separated by commas (required for collect)
  COUNTRIES           two-letter country codes to check (default: all)
  DATA_DIR            where snapshots are saved (default: ./data)
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY or ASC_PRIVATE_KEY_PATH
                      optional App Store Connect key for downloads and written reviews
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  loadDotEnv();
  if (command === "collect") return collect(readConfig());
  if (command === "dashboard") {
    await startDashboard({
      dataDir: readConfig().dataDir,
      port: Number(option(args, "--port") ?? 4321),
      open: !args.includes("--no-open"),
      pull: !args.includes("--no-pull"),
    });
    return -1;
  }
  console.log(HELP);
  return command && command !== "help" && command !== "--help" ? 1 : 0;
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
