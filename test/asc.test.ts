import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { ascToken } from "../src/asc/client.ts";
import { aggregateDownloads, mergeDownloads } from "../src/asc/downloads.ts";
import { checkPrivateData, githubRepoFromRemote } from "../src/privacy.ts";

test("App Store Connect token is a valid ES256 JWT", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const token = ascToken({ keyId: "KEY123", issuerId: "issuer", privateKey: pem }, 1_700_000_000_000);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  assert.equal(claims.aud, "appstoreconnect-v1");
  assert.equal(claims.exp - claims.iat, 19 * 60);
  const ok = verify("sha256", Buffer.from(`${header}.${payload}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"));
  assert.ok(ok);
});

test("downloads report keeps first-time downloads, redownloads and school licences apart", () => {
  const tsv = [
    "Date\tApp Apple Identifier\tDownload Type\tSource Type\tTerritory\tCounts",
    "2026-01-02\t111\tFirst-time download\tApp Store search\tUS\t40",
    "2026-01-02\t111\tFirst-time download\tWeb referrer\tUS\t10",
    "2026-01-02\t111\tFirst-time download\tInstitutional purchase\tUS\t300",
    "2026-01-02\t111\tRedownload\tApp Store search\tUS\t4",
    "2026-01-02\t111\tAuto-update\tUnavailable\tUS\t900",
    "2026-01-02\t111\tFirst-time download\tApp Store browse\tDEU\t7",
    "2026-01-02\t999\tFirst-time download\tApp Store browse\tUS\t1000",
  ].join("\n");
  const rows = aggregateDownloads(tsv, "111").sort((a, b) => a.country.localeCompare(b.country));
  assert.deepEqual(rows, [
    { day: "2026-01-02", country: "de", firstTime: 7, redownloads: 0, institutional: 0 },
    { day: "2026-01-02", country: "us", firstTime: 50, redownloads: 4, institutional: 300 },
  ]);
});

test("a smaller restatement of a day does not replace it", () => {
  const full = [{ day: "2026-01-02", country: "us", firstTime: 50, redownloads: 0, institutional: 0 }];
  const partial = [{ day: "2026-01-02", country: "us", firstTime: 20, redownloads: 0, institutional: 0 }];
  const bigger = [{ day: "2026-01-02", country: "us", firstTime: 55, redownloads: 0, institutional: 0 }];
  assert.deepEqual(mergeDownloads(full, partial), full);
  assert.deepEqual(mergeDownloads(full, bigger), bigger);
});

test("GitHub remotes are recognised in HTTPS and SSH form", () => {
  assert.equal(githubRepoFromRemote("https://github.com/reza/my-ratings.git"), "reza/my-ratings");
  assert.equal(githubRepoFromRemote("git@github.com:reza/my-ratings.git"), "reza/my-ratings");
  assert.equal(githubRepoFromRemote("https://gitlab.com/reza/my-ratings.git"), null);
});

const github = (status: number, body: unknown) => (async () => Response.json(body, { status })) as typeof fetch;

test("private data is only allowed when the repository is confirmed private", async () => {
  const actions = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "reza/r", GITHUB_TOKEN: "t" };
  assert.equal((await checkPrivateData(actions, github(200, { private: true }))).allowed, true);
  assert.equal((await checkPrivateData(actions, github(200, { private: false }))).allowed, false);
  assert.equal((await checkPrivateData(actions, github(500, {}))).allowed, false);
  assert.equal((await checkPrivateData({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "reza/r" }, github(200, { private: true }))).allowed, false);

  const local = () => "git@github.com:reza/r.git";
  assert.equal((await checkPrivateData({}, github(404, {}), local)).allowed, true);
  assert.equal((await checkPrivateData({}, github(200, { private: false }), local)).allowed, false);
  assert.equal((await checkPrivateData({}, github(200, {}), () => null)).allowed, true);
  assert.equal((await checkPrivateData({}, github(200, {}), () => "https://gitlab.com/a/b.git")).allowed, false);
  assert.equal((await checkPrivateData({ PRIVATE_REPO_CONFIRMED: "true" }, github(200, {}), () => "https://gitlab.com/a/b.git")).allowed, true);
});
