# App Store ratings history

**See how many ratings your app gets every day, and what each update does to them, for free, with the data in your own GitHub repository.**

Apple only shows your app's current rating count and average. To know how many ratings arrived on a given day, someone has to write that number down every day and compare. Paid tools such as Appfigures, AppTweak and Sensor Tower do exactly this. This project does the same thing with a free GitHub job that you own.

History starts the day you set it up. Nobody can give you the ratings of days that were never recorded, so the best time to start is today.

What you get:

- New ratings per day, week or month, in every country and in total
- The average stars of those new ratings, next to the store average
- Every version you release, marked on the charts, with a before/after table
- A countries table showing where your ratings come from
- Optionally, with an App Store Connect key: first-time downloads, download → rating conversion, and your written reviews

![Dashboard](docs/dashboard.png)

## Set up (about 3 minutes)

1. Click **Use this template → Create a new repository** at the top of this page. Choose **Public** or **Private**; see [what it costs](#what-it-costs) and [privacy](#public-or-private).
2. Find your App Store ID. It's the number at the end of your app's link: `apps.apple.com/app/…/id`**`1512640380`**.
3. In your new repository, go to **Settings → Secrets and variables → Actions → Variables** and click **New repository variable**.
   Name: `APP_IDS`. Value: your App Store ID. To track several apps, separate the IDs with commas.
4. Open the **Actions** tab, click **Snapshot ratings**, then **Run workflow**. If GitHub asks you to enable workflows, say yes.

The first run takes about 10 minutes, because it checks every country slowly enough that Apple doesn't block it. After that it runs by itself every night at 00:37 UTC and saves the snapshot in the `data` folder. Each run's summary page shows the totals and the change since the last snapshot.

## See the dashboard

You need [Node.js](https://nodejs.org) 22.13 or newer and [git](https://git-scm.com/downloads).

```sh
git clone https://github.com/YOUR-NAME/YOUR-REPO.git
cd YOUR-REPO
npm run dashboard
```

Nothing else to install. The dashboard fetches the latest snapshots with `git pull`, then opens `http://localhost:4321` in your browser. Next time, just run `npm run dashboard` in the same folder again. Your data never leaves your computer and your repository.

Want to look around before you have any data? `npm run demo` opens the dashboard with a year of made-up history.

Daily numbers start after the second snapshot, so the charts fill in from day two.

## What it costs

GitHub runs the nightly job on its computers. At GitHub's prices in September 2026:

| Your repository | Nightly job | Dashboard | Total |
| --- | --- | --- | --- |
| Public | Free, no limit | Runs on your computer | **$0** |
| Private, free GitHub account | About 300 of your 2,000 free minutes a month | Runs on your computer | **$0** |
| Private, over your free minutes | $0.006 per minute, so about $2 a month | Runs on your computer | **about $2/month** |

A run takes about 10 minutes for all ~175 countries; most of that is waiting between requests. If your app is only in a few countries, set a `COUNTRIES` variable (for example `us,gb,de,fr`) to make runs a lot shorter. See [GitHub's billing page](https://docs.github.com/en/billing/concepts/product-billing/github-actions) for current prices.

## Public or private?

Rating counts are already public: anyone can see them on the App Store. A public repository only means that anyone can also see your rating history.

The optional App Store Connect key is different. It adds data that only you can see today:

|  | Without a key | With an App Store Connect key |
| --- | --- | --- |
| What's saved | Rating counts and averages per country (public data) | Also first-time downloads and your written reviews (private data) |
| Repository | Public or private | **Must be private** |
| Setup | Just your App Store ID | Also create a key and add three secrets |
| History | From the day you start | Written reviews: all of them. Downloads: from the day you add the key |
| If the repository becomes public later | Nothing sensitive | Your downloads become visible. Delete `data/*/private` and its git history first |

The job checks that your repository is private every time it runs. If the repository is public, or the job can't tell, it skips downloads and reviews, saves ratings as usual and says why on the run's summary page. If private data is already in a public repository, the run fails so you notice.

GitHub encrypts the key's secrets and never writes them to the repository.

### Adding an App Store Connect key

1. In [App Store Connect](https://appstoreconnect.apple.com), go to **Users and Access → Integrations → App Store Connect API → Team Keys** and generate a key. Pick the **Admin** role: Apple only lets Admin keys start the downloads report.
2. Download the `.p8` file (Apple only lets you do this once) and note the **Key ID** and the **Issuer ID** shown on that page.
3. In your repository, go to **Settings → Secrets and variables → Actions**. Stay on the **Secrets** tab and, under **Repository secrets**, click **New repository secret**. Add these three, one at a time. The names must match exactly:

   | Name | Value | Where to find it |
   | --- | --- | --- |
   | `ASC_KEY_ID` | The Key ID, 10 characters like `2X9R4HXF34` | The **Key ID** column next to your key in App Store Connect. It's also in the file name: `AuthKey_2X9R4HXF34.p8` |
   | `ASC_ISSUER_ID` | The Issuer ID, like `57246542-96fe-1a63-e053-0824d011072a` | Above the list of keys in App Store Connect |
   | `ASC_PRIVATE_KEY` | Everything in the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines | Open the file in a text editor and copy all of it. On a Mac, `pbcopy < AuthKey_2X9R4HXF34.p8` copies it for you |

   Once saved, GitHub shows only the names, never the values. To change one, click it and enter the new value.
4. Run **Snapshot ratings** again. Written reviews arrive on this run. The downloads report starts now, and Apple usually delivers the first days within 48 hours.

## How the numbers are worked out

- **Snapshot.** Each night the job asks Apple's public lookup API for your app's rating count and average in every country, and saves them in `data/<app-id>/ratings-<year>.csv`.
- **New ratings** are the change in each country's count since the previous snapshot, added up.
- **Average of new ratings** is the change in total stars (average × count) divided by the new ratings. With only a few new ratings it jumps around, and the tooltips say how many ratings it's based on.
- **Which day.** A snapshot taken before noon UTC counts as the end of the previous day. A manual run in the afternoon counts as "today so far", and the nightly run replaces it.
- **Missed days** show as grey stripes. Their ratings are included in the next snapshot, and the tooltip says so.
- **Resets.** If a country's count drops to half or less, you reset the rating summary with a release. That day counts the ratings since the reset. Smaller drops are ratings Apple removed, and count as zero new ratings.
- **Countries that fail** (Apple sometimes refuses a request) keep their last known total and are checked again the next night.
- **Lag.** Apple's own numbers can lag by a few hours, so a day can include a few ratings from the day before. Over a week this evens out.
- **Ratings vs. reviews.** Most people rate without writing anything, so written reviews are a small share of new ratings.

## Your data

Everything lives in plain files you can open in a spreadsheet:

```
data/<app-id>/
  app.json             name, seller, icon
  ratings-2026.csv     day, country, ratings, average
  runs.csv             when each snapshot ran and which countries failed
  versions.csv         each version seen, with its release date and notes
  private/             only with an App Store Connect key, in a private repository
    downloads.csv      day, country, first-time downloads, redownloads, school licences
    reviews.csv        written reviews
```

## Settings

Set these as repository **variables** (not secrets):

| Variable | What it does |
| --- | --- |
| `APP_IDS` | App Store IDs to track, separated by commas. Required. |
| `COUNTRIES` | Two-letter country codes to check, for example `us,gb,de`. Default: all ~175 countries. |

## Running it without GitHub Actions

It's a plain Node.js script, so it runs anywhere. Put your settings in a `.env` file in the repository folder, for example `APP_IDS=1512640380`, then run `npm run collect` once a day with cron, launchd or Task Scheduler. On your own machine, add `ASC_PRIVATE_KEY_PATH=/path/to/AuthKey.p8` instead of pasting the key.

## Troubleshooting

- **The run was late.** GitHub sometimes delays scheduled jobs by up to an hour or so when it's busy. The snapshot still counts for the right day unless it's more than 11 hours late.
- **Some countries failed.** Apple limits how often its lookup API can be called. Those countries keep their last total and are checked again the next night.
- **Scheduled runs stopped.** GitHub pauses schedules in public repositories after 60 days without activity. The nightly commit keeps the repository active, but if you get an email from GitHub about it, re-enable the workflow in the Actions tab.
- **"App was not found in any country".** Check that `APP_IDS` holds the number from your app's link and that the app is live.

## Contributing

The collector and the dashboard have no runtime dependencies: Node runs the TypeScript directly. TypeScript is only needed to type-check.

```sh
npm install      # TypeScript and Node types, for checks only
npm run check    # type-check
npm test         # unit tests
npm run demo     # dashboard with made-up data
```

Charts use [uPlot](https://github.com/leeoniya/uPlot) (MIT), vendored in `dashboard/vendor`.

## License

MIT
