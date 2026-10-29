# nfl-live-data worker

This folder is the source for the `nfl-live-data` Worker. The owner has already deployed `worker/worker.js` to Cloudflare. Redeploy only if you change that file.

It keeps the `/teams`, `/scoreboard`, and `/standings` proxies and adds:

- `GET /roster?team={espnTeamId}` — team id must be an integer from 1 through 34. Fetches the ESPN roster and depth chart, joins them by player id, and returns offense, defense, and special teams in depth order plus an `other` list. The joined response is cached with the Cache API (`caches.default`) for 2 hours. `draft` on each player is `null`; the page fills that in separately.
- `GET /draft?ids=1,2,3` — at most 40 athlete ids, fetched from `https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}` with at most 6 requests in flight. `athlete.displayDraft` looks like `2022: Rd 2, Pk 41 (SEA)` and is parsed to `{year, round, pick}`. Players with no `displayDraft` return `null` (undrafted). A failed lookup is omitted so the page can tell it apart from undrafted. Each athlete request uses `cf: { cacheTtl, cacheEverything }` (30 days) instead of the Cache API.
- `GET /stats?team={espnTeamId}` — team id must be an integer from 1 through 34. One fetch of `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{id}/statistics` with `cf: { cacheTtl: 1800, cacheEverything: true }`. The Cache API is not used. The response is a small JSON document: team, season, games played, and offense/defense tiles (`key`, `label`, `display`, and `rank` or `computed` only when ESPN supplied them). Per-game rates are ESPN's own per-game stats when present. Otherwise a total is divided by games played and marked `computed`. Missing stats are `display: null`. ESPN 404 becomes `{ unavailable: true }` with status 404.

The Workers Free plan allows 50 subrequests per invocation, and Cache API `match`/`put` calls count toward that limit. `/roster` still uses the Cache API (one match, and one put on a miss, plus 2 ESPN fetches). `/draft` does not call the Cache API: it is one `fetch` per id, at most 40. `/stats` is a single `fetch` and does not call the Cache API.

`/stats` is not live until this file is deployed. Until then the page shows "Stats are not available yet."

`worker.js` is self-contained. The dashboard editor can run that one file. There is no KV binding.

Three fixes are in the deployed script, found while testing the first version live:

1. `fetch` is wrapped as `(...args) => fetch(...args)`. Passing the global `fetch` through and calling it as a method threw `Illegal invocation` in Workers.
2. `sports.core.api.espn.com` returns 403 to Workers. Draft text comes from the site common v3 athlete endpoint instead.
3. Per-athlete Cache API reads and writes were removed so a 40-id `/draft` call stays under the 50-subrequest cap. Edge caching is the `cf.cacheTtl` on that single fetch.

ESPN's API is unofficial. The depth chart is ESPN's own chart, not a chart published by the team.

## Redeploy

Only needed after a change to `worker/worker.js`. From a machine logged into the Cloudflare account that owns `nfl-live-data`:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

`wrangler deploy` publishes the Worker named `nfl-live-data` from `wrangler.toml` and replaces the live script. `compatibility_date` in that file is `2026-10-26`.

Dashboard alternative: Workers & Pages → `nfl-live-data` → Edit code. Replace the whole script with the contents of `worker/worker.js`, then Save and Deploy.

No KV namespace, secret, or new binding is required.

The page calls `https://nfl-live-data.josh-soudah.workers.dev`. Roster and draft responses that are not the expected JSON show as unavailable or "Draft unavailable" per player. A `/stats` response that is 404, not JSON, or still the old "API is running" JSON shows as "Stats are not available yet." Standings and the Games tab do not use those routes.

## Tests

From the repository root:

```bash
node --test test/*.test.mjs
```

Those tests use saved ESPN fixtures, including a common v3 athlete (`ath.json`, Kenneth Walker III) and an undrafted one (`ath-undrafted.json`, Jakobi Meyers). `roster-live-30.json` is a saved `GET /roster?team=30` response from the deployed Worker. The unit tests do not call ESPN or Cloudflare. The browser check is `node test/ui/roster-tab.mjs` (Playwright, Chrome). It serves `index.html` locally and returns that saved roster payload for `/roster`.
