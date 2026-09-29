import { existsSync } from "node:fs";
import { createAscClient } from "./asc/client.ts";
import { collectDownloads } from "./asc/downloads.ts";
import { collectReviews } from "./asc/reviews.ts";
import type { Config } from "./config.ts";
import { log, summary } from "./log.ts";
import { collectLookups, defaultDeps, type Deps } from "./lookup.ts";
import { checkPrivateData } from "./privacy.ts";
import { openApp } from "./store.ts";

const number = (value: number) => new Intl.NumberFormat("en").format(value);

/** Returns the process exit code. */
export async function collect(config: Config, deps: Deps = defaultDeps): Promise<number> {
  for (const warning of config.warnings) log.warn(warning);
  if (!config.apps.length) {
    log.notice("No apps to track yet. Add your App Store ID as the APP_IDS variable (see the README), then run this again.");
    summary("### No apps configured\nAdd your App Store ID as the `APP_IDS` repository variable, then run the workflow again.");
    return 0;
  }

  let failures = 0;
  const run = await collectLookups(config, deps);
  const lines = [
    `### Ratings snapshot for ${run.day}`,
    "",
    "| App | Countries | Total ratings | Since last snapshot | Average |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const app of run.apps) {
    const change = app.change == null ? "first snapshot" : `${app.change >= 0 ? "+" : ""}${number(app.change)}`;
    lines.push(`| ${app.name} | ${app.listed} | ${number(app.ratings)} | ${change} | ${app.average?.toFixed(2) ?? "–"} |`);
    log.info(`${app.name}: ${number(app.ratings)} ratings in ${app.listed} ${app.listed === 1 ? "country" : "countries"} (${change}).`);
    if (app.newVersion) log.info(`  New version seen: ${app.newVersion}`);
  }
  if (run.failed.length) {
    const message = `Could not check ${run.failed.length} of ${run.checked} countries: ${run.failed.join(", ")}. They will be checked again tomorrow.`;
    log.warn(message);
    lines.push("", message);
  }
  if (!run.apps.length || run.failed.length === run.checked) {
    log.error("No ratings could be saved in this run.");
    failures++;
  }
  summary(lines.join("\n"));

  if (config.asc && run.apps.length) {
    const check = await checkPrivateData();
    if (!check.allowed) {
      log.warn(`Skipped downloads and written reviews: ${check.reason}. Ratings were saved as usual.`);
      summary(`\nDownloads and written reviews were **not** saved: ${check.reason}.`);
      for (const app of run.apps) {
        if (existsSync(openApp(config.dataDir, app.id).privateDir)) {
          log.error(`data/${app.id}/private holds App Store Connect data but ${check.reason}. Delete that folder and its git history if the repository is public.`);
          failures++;
        }
      }
    } else {
      log.info(`App Store Connect data allowed: ${check.reason}.`);
      const client = createAscClient(config.asc, deps);
      const notes: string[] = [];
      for (const app of run.apps) {
        const files = openApp(config.dataDir, app.id);
        try {
          const reviews = await collectReviews(client, files, app.id);
          notes.push(`${app.name}: ${reviews.added} new written reviews (${number(reviews.total)} saved).`);
        } catch (error) {
          log.error(`${app.name} reviews: ${(error as Error).message}`);
          failures++;
        }
        try {
          const downloads = await collectDownloads(client, files, app.id);
          if (downloads.started) notes.push(`${app.name}: asked Apple to start the daily downloads report. The first days usually arrive within 48 hours.`);
          notes.push(`${app.name}: ${downloads.processed} new download reports, ${downloads.days} days updated${downloads.latest ? `, latest day ${downloads.latest}` : ""}.`);
        } catch (error) {
          log.error(`${app.name} downloads: ${(error as Error).message}`);
          failures++;
        }
      }
      for (const note of notes) log.info(note);
      if (notes.length) summary(["", "#### App Store Connect", "", ...notes.map((note) => `- ${note}`)].join("\n"));
    }
  }

  return failures ? 1 : 0;
}
