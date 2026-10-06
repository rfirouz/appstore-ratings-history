export type AppInfo = {
  id: string;
  name: string;
  seller: string;
  bundleId: string;
  url: string;
  icon: string;
  genre: string;
};

export type RatingRow = { day: string; country: string; ratings: number; average: number | null };

export type RunRow = {
  day: string;
  capturedAt: string;
  checked: number;
  listed: number;
  failed: string[];
};

export type VersionRow = { version: string; released: string; firstSeen: string; notes: string };

export type ReviewRow = {
  id: string;
  created: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  nickname: string;
};

export type DownloadRow = {
  day: string;
  country: string;
  firstTime: number;
  redownloads: number;
  institutional: number;
};

export type DayPoint = {
  day: string;
  /** Total ratings at the end of the day. */
  ratings: number | null;
  /** Store average at the end of the day. */
  average: number | null;
  /** Ratings added this day. A change spanning several days is shared out evenly across them. */
  newRatings: number | null;
  /** Average stars of those new ratings, worked out from the change in the store average. */
  newAverage: number | null;
  /** How many of the new ratings the average above is based on. */
  newAverageSample: number;
  /** Countries whose share for this day is estimated because a check failed. */
  estimated: string[];
  /** Whether part of this day's new ratings is an estimate for a missed snapshot. */
  missedShare: boolean;
  snapshot: boolean;
  /** Countries that could not be checked this day. */
  failed: string[];
  /** Countries whose rating summary was reset; their count restarts from zero. */
  resets: string[];
  /** Ratings that disappeared without a reset, usually removed by Apple. */
  removed: number;
  downloads: number | null;
  institutional: number | null;
  reviews: number;
  reviewStars: number;
};

export type CountrySummary = {
  code: string;
  name: string;
  ratings: number;
  average: number | null;
  newRatings: number;
  newAverage: number | null;
};

export type AppSummary = {
  app: AppInfo;
  firstDay: string | null;
  lastDay: string | null;
  countries: number;
  ratings: number | null;
  average: number | null;
};

export type AppPayload = {
  app: AppInfo;
  days: DayPoint[];
  versions: VersionRow[];
  countries: { code: string; name: string; ratings: number }[];
  lastRun: RunRow | null;
  hasReviews: boolean;
  hasDownloads: boolean;
};
