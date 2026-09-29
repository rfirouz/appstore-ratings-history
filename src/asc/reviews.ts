import type { AppFiles } from "../store.ts";
import { countryCode } from "../storefronts.ts";
import type { ReviewRow } from "../types.ts";
import type { AscClient } from "./client.ts";

type ReviewItem = {
  id: string;
  attributes?: {
    rating?: number;
    title?: string;
    body?: string;
    reviewerNickname?: string;
    createdDate?: string;
    territory?: string;
  };
};

/** Newest first; stops at the first page that contains a review already saved. */
export async function collectReviews(client: AscClient, files: AppFiles, appId: string): Promise<{ added: number; total: number }> {
  const saved = new Map(files.readReviews().map((row) => [row.id, row]));
  let added = 0;
  const pages = client.pages(`/v1/apps/${appId}/customerReviews`, {
    sort: "-createdDate",
    limit: "200",
    "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory",
  });
  for await (const page of pages) {
    let reachedSaved = false;
    for (const item of (page.data ?? []) as ReviewItem[]) {
      const attrs = item.attributes ?? {};
      if (saved.has(item.id)) reachedSaved = true;
      else added++;
      const row: ReviewRow = {
        id: item.id,
        created: attrs.createdDate ? new Date(attrs.createdDate).toISOString() : "",
        country: countryCode(attrs.territory ?? ""),
        rating: attrs.rating ?? 0,
        title: attrs.title ?? "",
        body: attrs.body ?? "",
        nickname: attrs.reviewerNickname ?? "",
      };
      saved.set(item.id, row);
    }
    if (reachedSaved) break;
  }
  files.writeReviews([...saved.values()]);
  return { added, total: saved.size };
}
