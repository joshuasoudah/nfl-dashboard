// NFL live-data worker.
// Existing /teams, /scoreboard, and /standings proxies are unchanged.
// /roster and /draft are added for the standings Roster tab.
//
// Draft info is not on the roster or depth-chart payloads. Each athlete is
// loaded from the core API, at most 40 per /draft call, with a small parallel
// pool so one invocation stays under the Workers Free plan limit of 50
// subrequests. Results are stored with the Cache API (caches.default):
// athlete drafts for 30 days, a joined roster for 2 hours. No KV binding.

const ESPN_SITE = "https://site.api.espn.com";
const ESPN_CORE = "https://sports.core.api.espn.com";
export const ALLOWED_ORIGIN = "https://joshuasoudah.github.io";

export const MAX_TEAM_ID = 34;
export const MAX_DRAFT_IDS = 40;
export const DRAFT_CONCURRENCY = 6;
export const ROSTER_CACHE_SECONDS = 60 * 60 * 2;
export const DRAFT_CACHE_SECONDS = 60 * 60 * 24 * 30;

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

export function draftFromAthlete(athlete) {
  const draft = athlete && typeof athlete === "object" ? athlete.draft : null;
  if (!draft || typeof draft !== "object") return null;
  const year = Number(draft.year);
  if (!Number.isFinite(year) || year <= 0) return null;
  const round = Number(draft.round);
  const pickSource = draft.selection != null ? draft.selection : draft.pick;
  const pick = Number(pickSource);
  return {
    year,
    round: Number.isFinite(round) ? round : null,
    pick: Number.isFinite(pick) ? pick : null
  };
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
  const key = cacheRequest(`/athlete/${id}`);
  const cached = await cacheGet(deps.cache, key);
  if (cached && Object.prototype.hasOwnProperty.call(cached, "draft")) {
    return { id, ok: true, draft: cached.draft ?? null };
  }

  let response;
  try {
    response = await deps.fetch(`${ESPN_CORE}/v2/sports/football/leagues/nfl/athletes/${id}`, {
      headers: { "Accept": "application/json" }
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
  const draft = draftFromAthlete(athlete);
  await cachePut(deps.cache, key, { draft }, DRAFT_CACHE_SECONDS);
  return { id, ok: true, draft };
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
    fetch: deps.fetch || fetch,
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

    if (!PROXIED_ROUTES[url.pathname]) {
      return Response.json({
        message: "NFL Data API is running",
        endpoints: ["/teams", "/scoreboard", "/standings", "/roster", "/draft"]
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
