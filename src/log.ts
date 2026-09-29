import { appendFileSync } from "node:fs";

const inActions = () => process.env.GITHUB_ACTIONS === "true";

const escapeCommand = (text: string) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

export const log = {
  info(message: string): void {
    console.log(message);
  },
  notice(message: string): void {
    console.log(inActions() ? `::notice::${escapeCommand(message)}` : message);
  },
  warn(message: string): void {
    if (inActions()) console.log(`::warning::${escapeCommand(message)}`);
    else console.warn(`Warning: ${message}`);
  },
  error(message: string): void {
    if (inActions()) console.log(`::error::${escapeCommand(message)}`);
    else console.error(`Error: ${message}`);
  },
};

/** Adds Markdown to the run's summary page on GitHub; does nothing elsewhere. */
export function summary(markdown: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, markdown.endsWith("\n") ? markdown : markdown + "\n");
}
