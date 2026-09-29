import { execFileSync } from "node:child_process";

export type PrivacyCheck = { allowed: boolean; reason: string };

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function githubRepoFromRemote(remote: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

function originRemote(): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

async function repoVisibility(fetchImpl: Fetch, repo: string, token?: string): Promise<"private" | "public" | "unknown"> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404 && !token) return "private";
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { private?: boolean };
    if (body.private === true) return "private";
    if (body.private === false) return "public";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Downloads and written reviews are only saved where the data cannot become
 * public. When the answer is unclear the data is not saved.
 */
export async function checkPrivateData(
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
  remote: () => string | null = originRemote,
): Promise<PrivacyCheck> {
  if (env.GITHUB_ACTIONS === "true") {
    const repo = env.GITHUB_REPOSITORY;
    if (!repo || !env.GITHUB_TOKEN) {
      return { allowed: false, reason: "the workflow did not pass GITHUB_TOKEN, so the repository's visibility could not be checked" };
    }
    const visibility = await repoVisibility(fetchImpl, repo, env.GITHUB_TOKEN);
    if (visibility === "private") return { allowed: true, reason: `${repo} is private` };
    if (visibility === "public") return { allowed: false, reason: `${repo} is public, and this data must stay private` };
    return { allowed: false, reason: `could not confirm that ${repo} is private` };
  }

  const url = remote();
  if (!url) return { allowed: true, reason: "this folder has no git remote, so the data stays on this computer" };
  const repo = githubRepoFromRemote(url);
  if (!repo) {
    if (env.PRIVATE_REPO_CONFIRMED === "true") return { allowed: true, reason: "PRIVATE_REPO_CONFIRMED is set" };
    return { allowed: false, reason: `the remote (${url}) is not on GitHub, so its visibility can't be checked. Set PRIVATE_REPO_CONFIRMED=true if it is private` };
  }
  const visibility = await repoVisibility(fetchImpl, repo);
  if (visibility === "private") return { allowed: true, reason: `${repo} is not publicly visible` };
  if (visibility === "public") return { allowed: false, reason: `${repo} is public, and this data must stay private` };
  return { allowed: false, reason: `could not confirm that ${repo} is private` };
}
