# nfl-live-data worker

This folder is the source for the existing `nfl-live-data` Worker. It keeps the current `/teams`, `/scoreboard`, and `/standings` proxies and adds:

- `GET /roster?team={espnTeamId}` — team id must be an integer from 1 through 34. Fetches the ESPN roster and depth chart, joins them by player id, and returns offense, defense, and special teams in depth order plus an `other` list. Cached with the Cache API (`caches.default`) for 2 hours.
- `GET /draft?ids=1,2,3` — at most 40 athlete ids. Each id is read from `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/{id}` with at most 6 requests in flight. A hit returns `{year, round, pick}`. A player with no draft object returns `null` (undrafted). A failed lookup is omitted so the page can tell it apart from undrafted. Successful lookups are cached for 30 days. There is no KV binding.

The Workers Free plan allows 50 subrequests per invocation. `/roster` uses 2. `/draft` uses at most 40, and only for cache misses.

`worker.js` is self-contained. The dashboard editor can run that one file.

ESPN's API is unofficial. The depth chart is ESPN's own chart, not a chart published by the team. Do not deploy this until the pull request has been reviewed. This repository change does not deploy the Worker.

## Deploy

From a machine logged into the Cloudflare account that already owns `nfl-live-data`:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

`wrangler deploy` publishes the Worker named `nfl-live-data` using `wrangler.toml`. That replaces the live script. `compatibility_date` in that file is `2026-10-26`. The live Worker may be on an older compatibility date today; check the dashboard setting before deploying if you need to keep it.

Dashboard alternative: Workers & Pages → `nfl-live-data` → Edit code. Replace the whole script with the contents of `worker/worker.js`, then Save and Deploy. Paste the entire file. The quick editor's preview does not persist Cache API writes; caching still applies on the deployed Worker, and a cache failure does not fail the request.

No KV namespace, secret, or new binding is required.

## Until the Worker is deployed

The site keeps calling `https://nfl-live-data.josh-soudah.workers.dev`. The Worker that is live today answers unknown paths with its "API is running" JSON. The Roster tab treats that as unavailable and shows a retry. Standings, live scores, and the Games tab do not use `/roster` or `/draft`, so they keep working. After a deploy, open Roster again or press Retry. Draft lines fill in after `/draft` responds; until then they stay on `...`, and a failed batch shows "Draft unavailable" per player.

## Tests

From the repository root:

```bash
node --test test/*.test.mjs
```

Those tests use the saved Jacksonville roster, depth chart, and athlete fixtures. They do not call ESPN or Cloudflare. The browser check is `node test/ui/roster-tab.mjs` (Playwright, Chrome). It serves `index.html` locally and mocks the Worker.
