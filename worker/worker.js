// NFL live-data worker.
// Existing /teams, /scoreboard, and /standings proxies are unchanged.
// /roster and /draft serve the Roster tab.
// /stats serves the Stats tab: one ESPN statistics fetch, edge-cached with
// cf.cacheTtl (not the Cache API), normalized to the tiles the page shows.
//
// Draft info is not on the roster or depth-chart payloads. Each athlete is
// loaded from the core API, at most 40 per /draft call, with a small parallel
// pool so one invocation stays under the Workers Free plan limit of 50
// subrequests. Results are stored with the Cache API (caches.default):
// athlete drafts for 30 days, a joined roster for 2 hours. No KV binding.

const ESPN_SITE = "https://site.api.espn.com";
const ESPN_COMMON = "https://site.api.espn.com";
export const ALLOWED_ORIGIN = "https://joshuasoudah.github.io";

export const MAX_TEAM_ID = 34;
export const MAX_DRAFT_IDS = 40;
export const DRAFT_CONCURRENCY = 6;
export const ROSTER_CACHE_SECONDS = 60 * 60 * 2;
export const DRAFT_CACHE_SECONDS = 60 * 60 * 24 * 30;
export const STATS_CACHE_SECONDS = 1800;

const SECTION_ORDER = ["Offense", "Defense", "Special Teams"];

const PROXIED_ROUTES = {
  "/teams": "/apis/site/v2/sports/football/nfl/teams",
  "/scoreboard": "/apis/site/v2/sports/football/nfl/scoreboard",
  "/standings": "/apis/v2/sports/football/nfl/standings"
};

export function parseTeamId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_TEAM_ID) return null;
  return String(id);
}

export function parseDraftIds(value) {
  if (value == null || String(value).trim() === "") return { error: "Missing ids" };
  const parts = String(value).split(",").map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { error: "Missing ids" };
  const ids = [];
  const seen = new Set();
  for (const part of parts) {
    if (!/^[1-9]\d{0,11}$/.test(part)) return { error: "Invalid athlete id" };
    if (seen.has(part)) continue;
    seen.add(part);
    ids.push(part);
  }
  if (ids.length > MAX_DRAFT_IDS) return { error: "Too many ids (max 40)" };
  return { ids };
}

export function draftFromAthlete(payload) {
  // Common v3 athlete payload: { athlete: { displayDraft: "2022: Rd 2, Pk 41 (SEA)" } }.
  // Undrafted players have no displayDraft. The core API is not used: it returns 403 to Workers.
  const athlete = payload && typeof payload === "object" && payload.athlete ? payload.athlete : payload;
  const text = athlete && typeof athlete.displayDraft === "string" ? athlete.displayDraft : "";
  const match = /(\d{4})\s*:\s*Rd\s*(\d+)\s*,\s*Pk\s*(\d+)/i.exec(text);
  if (!match) return null;
  return { year: Number(match[1]), round: Number(match[2]), pick: Number(match[3]) };
}

export function classifyDepthChart(name) {
  const label = String(name || "").toLowerCase();
  if (label.includes("special")) return "Special Teams";
  if (
    label.includes("defense") ||
    label.includes("nickel") ||
    label.includes("dime") ||
    label.includes("base") ||
    /\d-\d/.test(label)
  ) {
    return "Defense";
  }
  return "Offense";
}

function injuryFrom(injuries) {
  if (!Array.isArray(injuries) || !injuries.length) return null;
  const status = injuries[0] && injuries[0].status;
  if (typeof status === "string" && status.trim()) return status.trim();
  if (status && typeof status === "object") {
    const label = status.description || status.name || status.abbreviation;
    return label ? String(label) : null;
  }
  return null;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rosterItems(roster) {
  const groups = Array.isArray(roster && roster.athletes) ? roster.athletes : [];
  const items = [];
  for (const group of groups) {
    const players = Array.isArray(group && group.items) ? group.items : [];
    for (const player of players) {
      if (player && player.id != null) items.push(player);
    }
  }
  return items;
}

function playerFromRoster(player, starter, injury) {
  const position = player.position || {};
  const college = player.college || {};
  return {
    id: String(player.id),
    name: player.displayName || player.fullName || player.shortName || "",
    jersey: player.jersey != null && String(player.jersey) !== "" ? String(player.jersey) : null,
    position: position.abbreviation || position.displayName || null,
    height: player.displayHeight || null,
    weight: player.displayWeight || null,
    age: numberOrNull(player.age),
    experience: player.experience && player.experience.years != null ? numberOrNull(player.experience.years) : null,
    headshot: player.headshot && player.headshot.href || null,
    college: college.name || college.shortName || null,
    injury: injury != null ? injury : injuryFrom(player.injuries),
    starter: !!starter,
    draft: null
  };
}

function playerFromDepth(athlete, starter) {
  return {
    id: String(athlete.id),
    name: athlete.displayName || athlete.shortName || "",
    jersey: null,
    position: null,
    height: null,
    weight: null,
    age: null,
    experience: null,
    headshot: null,
    college: null,
    injury: injuryFrom(athlete.injuries),
    starter: !!starter,
    draft: null
  };
}

export function joinRoster(roster, depth) {
  const byId = new Map();
  for (const player of rosterItems(roster)) byId.set(String(player.id), player);

  const positionsBySection = new Map(SECTION_ORDER.map(name => [name, []]));
  const seenPos = new Map(SECTION_ORDER.map(name => [name, new Set()]));
  const usedIds = new Set();
  const charts = Array.isArray(depth && depth.depthchart) ? depth.depthchart : [];

  for (const chart of charts) {
    const section = classifyDepthChart(chart && chart.name);
    const positions = chart && chart.positions && typeof chart.positions === "object" ? chart.positions : {};
    for (const [key, slot] of Object.entries(positions)) {
      const pos = String(key || "").toUpperCase();
      if (!pos || seenPos.get(section).has(pos)) continue;
      seenPos.get(section).add(pos);
      const athletes = Array.isArray(slot && slot.athletes) ? slot.athletes : [];
      const players = [];
      const seenInSlot = new Set();
      for (const athlete of athletes) {
        if (!athlete || athlete.id == null) continue;
        const id = String(athlete.id);
        if (seenInSlot.has(id)) continue;
        seenInSlot.add(id);
        usedIds.add(id);
        const starter = players.length === 0;
        const rosterPlayer = byId.get(id);
        if (rosterPlayer) {
          const injury = injuryFrom(rosterPlayer.injuries) || injuryFrom(athlete.injuries);
          players.push(playerFromRoster(rosterPlayer, starter, injury));
        } else {
          players.push(playerFromDepth(athlete, starter));
        }
      }
      if (players.length) positionsBySection.get(section).push({ pos, players });
    }
  }

  const sections = SECTION_ORDER
    .map(name => ({ name, positions: positionsBySection.get(name) }))
    .filter(section => section.positions.length);

  const other = [];
  for (const player of rosterItems(roster)) {
    if (usedIds.has(String(player.id))) continue;
    other.push(playerFromRoster(player, false, injuryFrom(player.injuries)));
  }

  return { sections, other };
}

export function statCategories(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    const direct = node.filter(item => item && typeof item === "object" && Array.isArray(item.stats));
    if (direct.length) return direct;
    return node.flatMap(item => (item && Array.isArray(item.categories) ? item.categories : []));
  }
  if (Array.isArray(node.categories)) return node.categories;
  if (Array.isArray(node.stats)) return [node];
  return [];
}

function indexStats(categories) {
  const byQualified = new Map();
  for (const category of categories) {
    if (!category || typeof category !== "object") continue;
    const cat = String(category.name || "");
    const stats = Array.isArray(category.stats) ? category.stats : [];
    for (const stat of stats) {
      if (!stat || typeof stat.name !== "string" || !stat.name) continue;
      const key = `${cat}.${stat.name}`;
      if (!byQualified.has(key)) byQualified.set(key, stat);
    }
  }
  return byQualified;
}

function lookupStat(index, keys) {
  for (const key of keys) {
    const stat = index.get(key);
    if (stat) return stat;
  }
  return null;
}

function numericStat(stat) {
  if (!stat || stat.value == null || stat.value === "") return null;
  const number = Number(stat.value);
  return Number.isFinite(number) ? number : null;
}

function rankOf(stat) {
  if (!stat || stat.rank == null || stat.rank === "") return null;
  const rank = Number(stat.rank);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function displayOf(stat) {
  if (!stat) return null;
  if (stat.displayValue != null && String(stat.displayValue).trim() !== "") return String(stat.displayValue).trim();
  const number = numericStat(stat);
  return number == null ? null : String(number);
}

function gamesPlayedFrom(index) {
  const stat = lookupStat(index, ["general.gamesPlayed", "passing.teamGamesPlayed", "rushing.teamGamesPlayed", "defensive.teamGamesPlayed"]);
  const value = numericStat(stat);
  if (value == null || value <= 0) return null;
  return value;
}

function formatPerGame(total, games) {
  const number = total / games;
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function statTile(key, label, extra) {
  const tile = { key, label, display: extra && extra.display != null ? String(extra.display) : null };
  if (extra && extra.computed) tile.computed = true;
  if (extra && extra.rank != null) tile.rank = extra.rank;
  return tile;
}

function directTile(key, label, stat) {
  return statTile(key, label, { display: displayOf(stat), rank: rankOf(stat) });
}

/* Prefer ESPN's own per-game figure. Otherwise divide a provided total by
   games played and mark the tile computed. A total with no games stays a total
   and keeps that stat's rank. A computed per-game figure does not inherit the
   total's rank, because that rank is not for the rate. */
function perGameTile(key, perLabel, totalLabel, perGameStat, totalStat, games) {
  const perDisplay = displayOf(perGameStat);
  if (perDisplay != null) return statTile(key, perLabel, { display: perDisplay, rank: rankOf(perGameStat) });
  const total = numericStat(totalStat);
  if (total != null && games) {
    const display = formatPerGame(total, games);
    if (display != null) return statTile(key, perLabel, { display, computed: true });
  }
  const totalDisplay = displayOf(totalStat);
  if (totalDisplay != null) return statTile(key, totalLabel, { display: totalDisplay, rank: rankOf(totalStat) });
  return statTile(key, perLabel, { display: null });
}

export function normalizeTeamStats(payload, teamId) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const results = body.results && typeof body.results === "object" && !Array.isArray(body.results) ? body.results : {};
  const teamIndex = indexStats(statCategories(results.stats));
  const oppIndex = indexStats(statCategories(results.opponent));
  const games = gamesPlayedFrom(teamIndex) || gamesPlayedFrom(oppIndex);
  const team = body.team && typeof body.team === "object" ? body.team : {};
  const seasonYear = Number(body.season && body.season.year);
  const offense = [
    perGameTile(
      "pointsPerGame",
      "Points per game",
      "Points",
      lookupStat(teamIndex, ["scoring.totalPointsPerGame", "passing.totalPointsPerGame"]),
      lookupStat(teamIndex, ["scoring.totalPoints", "passing.totalPoints"]),
      games
    ),
    perGameTile(
      "yardsPerGame",
      "Yards per game",
      "Total yards",
      lookupStat(teamIndex, ["passing.yardsPerGame"]),
      lookupStat(teamIndex, ["rushing.totalYards"]),
      games
    ),
    perGameTile(
      "passingYardsPerGame",
      "Passing yards per game",
      "Passing yards",
      lookupStat(teamIndex, ["passing.passingYardsPerGame", "passing.netPassingYardsPerGame"]),
      lookupStat(teamIndex, ["passing.passingYards", "passing.netPassingYards"]),
      games
    ),
    perGameTile(
      "rushingYardsPerGame",
      "Rushing yards per game",
      "Rushing yards",
      lookupStat(teamIndex, ["rushing.rushingYardsPerGame"]),
      lookupStat(teamIndex, ["rushing.rushingYards"]),
      games
    ),
    directTile("passingTouchdowns", "Passing TDs", lookupStat(teamIndex, ["passing.passingTouchdowns"])),
    directTile("rushingTouchdowns", "Rushing TDs", lookupStat(teamIndex, ["rushing.rushingTouchdowns"])),
    directTile("completionPct", "Completion %", lookupStat(teamIndex, ["passing.completionPct"])),
    directTile("yardsPerRush", "Yards per rush", lookupStat(teamIndex, ["rushing.yardsPerRushAttempt"])),
    directTile("thirdDownPct", "Third down %", lookupStat(teamIndex, ["miscellaneous.thirdDownConvPct"])),
    directTile("firstDowns", "First downs", lookupStat(teamIndex, ["miscellaneous.firstDowns"])),
    directTile("giveaways", "Giveaways", lookupStat(teamIndex, ["miscellaneous.totalGiveaways"])),
    directTile("sacksTaken", "Sacks taken", lookupStat(teamIndex, ["passing.sacks"]))
  ];
  const defense = [
    perGameTile(
      "yardsAllowed",
      "Yards allowed per game",
      "Yards allowed",
      lookupStat(oppIndex, ["passing.yardsPerGame"]),
      lookupStat(oppIndex, ["rushing.totalYards"]),
      games
    ),
    perGameTile(
      "pointsAllowed",
      "Points allowed per game",
      "Points allowed",
      lookupStat(oppIndex, ["scoring.totalPointsPerGame", "passing.totalPointsPerGame"]),
      lookupStat(oppIndex, ["scoring.totalPoints", "passing.totalPoints"]),
      games
    ),
    directTile("sacks", "Sacks", lookupStat(teamIndex, ["defensive.sacks"])),
    directTile("interceptions", "Interceptions", lookupStat(teamIndex, ["defensiveInterceptions.interceptions"])),
    directTile("forcedFumbles", "Forced fumbles", lookupStat(teamIndex, ["general.fumblesForced"])),
    directTile("fumbleRecoveries", "Fumble recoveries", lookupStat(teamIndex, ["general.fumblesRecovered"])),
    directTile("takeaways", "Takeaways", lookupStat(teamIndex, ["miscellaneous.totalTakeaways"])),
    directTile("tackles", "Tackles", lookupStat(teamIndex, ["defensive.totalTackles"])),
    directTile("tacklesForLoss", "Tackles for loss", lookupStat(teamIndex, ["defensive.tacklesForLoss"]))
  ];
  return {
    team: {
      id: String(teamId || team.id || ""),
      name: team.displayName || team.name || null,
      abbreviation: team.abbreviation || null
    },
    season: Number.isInteger(seasonYear) ? seasonYear : null,
    gamesPlayed: games,
    offense,
    defense
  };
}

export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Math.min(Math.max(1, limit), items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  if (runners > 0) await Promise.all(Array.from({ length: runners }, () => run()));
  return results;
}

function jsonResponse(corsHeaders, body, status, cacheSeconds) {
  const headers = {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8"
  };
  if (cacheSeconds != null) headers["Cache-Control"] = `public, max-age=${cacheSeconds}`;
  return Response.json(body, { status, headers });
}

function cacheRequest(pathname) {
  return new Request(`https://nfl-live-data.cache${pathname}`, { method: "GET" });
}

async function cacheGet(cache, request) {
  if (!cache) return null;
  try {
    const hit = await cache.match(request);
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function cachePut(cache, request, body, cacheSeconds) {
  if (!cache) return;
  try {
    await cache.put(request, new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${cacheSeconds}`
      }
    }));
  } catch {
    // Cache API is a no-op in the dashboard preview. The response still returns.
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function handleRoster(url, deps, corsHeaders) {
  const teamId = parseTeamId(url.searchParams.get("team"));
  if (!teamId) return jsonResponse(corsHeaders, { error: "Invalid team id" }, 400);

  const key = cacheRequest(`/roster/${teamId}`);
  const cached = await cacheGet(deps.cache, key);
  if (cached && Array.isArray(cached.sections) && Array.isArray(cached.other)) {
    return jsonResponse(corsHeaders, cached, 200, ROSTER_CACHE_SECONDS);
  }

  const rosterUrl = `${ESPN_SITE}/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
  const depthUrl = `${ESPN_SITE}/apis/site/v2/sports/football/nfl/teams/${teamId}/depthcharts`;
  let rosterResponse;
  let depthResponse;
  try {
    [rosterResponse, depthResponse] = await Promise.all([
      deps.fetch(rosterUrl, { headers: { "Accept": "application/json" } }),
      deps.fetch(depthUrl, { headers: { "Accept": "application/json" } })
    ]);
  } catch (error) {
    console.error(JSON.stringify({ msg: "roster fetch failed", teamId, error: String(error && error.message || error) }));
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  if (rosterResponse.status === 404 || depthResponse.status === 404) {
    return jsonResponse(corsHeaders, { error: "Roster unavailable", unavailable: true }, 404);
  }
  if (!rosterResponse.ok || !depthResponse.ok) {
    console.error(JSON.stringify({
      msg: "roster fetch failed",
      teamId,
      rosterStatus: rosterResponse.status,
      depthStatus: depthResponse.status
    }));
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  const rosterJson = await readJson(rosterResponse);
  const depthJson = await readJson(depthResponse);
  if (!rosterJson || !depthJson) {
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  const joined = joinRoster(rosterJson, depthJson);
  const team = rosterJson.team || {};
  const payload = {
    team: {
      id: teamId,
      name: team.displayName || null,
      abbreviation: team.abbreviation || null
    },
    updated: new Date().toISOString(),
    source: "ESPN depth chart",
    sections: joined.sections,
    other: joined.other
  };
  await cachePut(deps.cache, key, payload, ROSTER_CACHE_SECONDS);
  return jsonResponse(corsHeaders, payload, 200, ROSTER_CACHE_SECONDS);
}

async function loadDraft(id, deps) {
  // One subrequest per athlete. The Workers Free plan allows 50 per invocation and counts
  // Cache API calls too, so the edge cache is used through fetch options instead.
  let response;
  try {
    response = await deps.fetch(`${ESPN_COMMON}/apis/common/v3/sports/football/nfl/athletes/${id}`, {
      headers: { "Accept": "application/json" },
      cf: { cacheTtl: DRAFT_CACHE_SECONDS, cacheEverything: true }
    });
  } catch (error) {
    console.error(JSON.stringify({ msg: "athlete fetch failed", id, error: String(error && error.message || error) }));
    return { id, ok: false };
  }
  if (!response.ok) {
    console.error(JSON.stringify({ msg: "athlete fetch failed", id, status: response.status }));
    return { id, ok: false };
  }
  const athlete = await readJson(response);
  if (!athlete) return { id, ok: false };
  return { id, ok: true, draft: draftFromAthlete(athlete) };
}

async function handleStats(url, deps, corsHeaders) {
  const teamId = parseTeamId(url.searchParams.get("team"));
  if (!teamId) return jsonResponse(corsHeaders, { error: "Invalid team id" }, 400);

  const target = `${ESPN_SITE}/apis/site/v2/sports/football/nfl/teams/${teamId}/statistics`;
  let response;
  try {
    response = await deps.fetch(target, {
      headers: { "Accept": "application/json" },
      cf: { cacheTtl: STATS_CACHE_SECONDS, cacheEverything: true }
    });
  } catch (error) {
    console.error(JSON.stringify({ msg: "stats fetch failed", teamId, error: String(error && error.message || error) }));
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  if (response.status === 404) {
    return jsonResponse(corsHeaders, { error: "Stats unavailable", unavailable: true }, 404);
  }
  if (!response.ok) {
    console.error(JSON.stringify({ msg: "stats fetch failed", teamId, status: response.status }));
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  const body = await readJson(response);
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.results || typeof body.results !== "object" || Array.isArray(body.results)) {
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }

  return jsonResponse(corsHeaders, normalizeTeamStats(body, teamId), 200, STATS_CACHE_SECONDS);
}

async function handleDraft(url, deps, corsHeaders) {
  const parsed = parseDraftIds(url.searchParams.get("ids"));
  if (parsed.error) return jsonResponse(corsHeaders, { error: parsed.error }, 400);
  const rows = await mapPool(parsed.ids, DRAFT_CONCURRENCY, id => loadDraft(id, deps));
  const body = {};
  for (const row of rows) {
    if (row && row.ok) body[row.id] = row.draft;
  }
  return jsonResponse(corsHeaders, body, 200);
}

async function handleProxy(url, deps, corsHeaders) {
  const path = PROXIED_ROUTES[url.pathname];
  const target = new URL(path, ESPN_SITE);
  for (const [key, value] of url.searchParams) target.searchParams.append(key, value);
  try {
    const response = await deps.fetch(target.toString(), {
      headers: { "Accept": "application/json" },
      cf: { cacheTtl: 15, cacheEverything: true }
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=15"
      }
    });
  } catch (error) {
    console.error(JSON.stringify({ msg: "proxy fetch failed", path: url.pathname, error: String(error && error.message || error) }));
    return jsonResponse(corsHeaders, { error: "Unable to retrieve ESPN data" }, 502);
  }
}

export function createHandler(deps = {}) {
  const runtime = {
    fetch: deps.fetch || ((...args) => fetch(...args)),
    cache: deps.cache !== undefined ? deps.cache : runtimeCache()
  };

  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403, headers: corsHeaders });
    }

    if (url.pathname === "/roster") return handleRoster(url, runtime, corsHeaders);
    if (url.pathname === "/draft") return handleDraft(url, runtime, corsHeaders);
    if (url.pathname === "/stats") return handleStats(url, runtime, corsHeaders);

    if (!PROXIED_ROUTES[url.pathname]) {
      return Response.json({
        message: "NFL Data API is running",
        endpoints: ["/teams", "/scoreboard", "/standings", "/roster", "/draft", "/stats"]
      }, { headers: corsHeaders });
    }

    return handleProxy(url, runtime, corsHeaders);
  };
}

function runtimeCache() {
  try {
    if (typeof caches !== "undefined" && caches.default) return caches.default;
  } catch {
    // Not a Workers runtime.
  }
  return {
    async match() { return undefined; },
    async put() {}
  };
}

export default {
  async fetch(request) {
    return createHandler()(request);
  }
};
