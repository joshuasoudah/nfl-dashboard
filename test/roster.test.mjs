import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_ORIGIN,
  DRAFT_CACHE_SECONDS,
  DRAFT_CONCURRENCY,
  MAX_DRAFT_IDS,
  ROSTER_CACHE_SECONDS,
  classifyDepthChart,
  createHandler,
  draftFromAthlete,
  joinRoster,
  mapPool,
  normalizeTeamStats,
  parseDraftIds,
  parseTeamId,
  STATS_CACHE_SECONDS,
  statCategories
} from '../worker/worker.js';

const root = dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(readFileSync(join(root, 'fixtures/roster30.json'), 'utf8'));
const depth = JSON.parse(readFileSync(join(root, 'fixtures/dc_site30.json'), 'utf8'));
const athlete = JSON.parse(readFileSync(join(root, 'fixtures/ath.json'), 'utf8'));
const undraftedAthlete = JSON.parse(readFileSync(join(root, 'fixtures/ath-undrafted.json'), 'utf8'));
const liveRoster = JSON.parse(readFileSync(join(root, 'fixtures/roster-live-30.json'), 'utf8'));
const statsFixture = JSON.parse(readFileSync(join(root, 'fixtures/stats30.json'), 'utf8'));

function flatten(joined) {
  const rows = [];
  for (const section of joined.sections) {
    for (const position of section.positions) {
      position.players.forEach((player, index) => {
        rows.push({ section: section.name, pos: position.pos, index, player });
      });
    }
  }
  return rows;
}

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      const found = store.get(request.url);
      return found ? found.clone() : undefined;
    },
    async put(request, response) {
      store.set(request.url, response.clone());
    }
  };
}

test('classifies ESPN chart names into the three sections', () => {
  assert.equal(classifyDepthChart('3WR 1TE'), 'Offense');
  assert.equal(classifyDepthChart('Base 4-3 D'), 'Defense');
  assert.equal(classifyDepthChart('Nickel'), 'Defense');
  assert.equal(classifyDepthChart('Special Teams'), 'Special Teams');
});

test('joins the Jacksonville roster to the ESPN depth chart', () => {
  const joined = joinRoster(roster, depth);
  assert.deepEqual(joined.sections.map(section => section.name), ['Offense', 'Defense', 'Special Teams']);

  const offense = joined.sections[0];
  assert.deepEqual(offense.positions.map(position => position.pos), [
    'WR1', 'WR2', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT', 'QB', 'TE', 'RB'
  ]);
  assert.deepEqual(joined.sections[1].positions.map(position => position.pos), [
    'LDE', 'LDT', 'RDT', 'RDE', 'WLB', 'MLB', 'SLB', 'LCB', 'SS', 'FS', 'RCB', 'NB'
  ]);
  assert.deepEqual(joined.sections[2].positions.map(position => position.pos), [
    'PK', 'P', 'H', 'PR', 'KR', 'LS'
  ]);

  const qb = offense.positions.find(position => position.pos === 'QB');
  assert.equal(qb.players[0].name, 'Trevor Lawrence');
  assert.equal(qb.players[0].starter, true);
  assert.equal(qb.players[0].jersey, '16');
  assert.equal(qb.players[0].position, 'QB');
  assert.equal(qb.players[0].height, '6\' 6"');
  assert.equal(qb.players[0].weight, '220 lbs');
  assert.equal(qb.players[0].age, 27);
  assert.equal(qb.players[0].experience, 6);
  assert.equal(qb.players[0].college, 'Clemson');
  assert.equal(qb.players[0].draft, null);
  assert.match(qb.players[0].headshot, /^https:\/\/a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/4360310\.png/);
  assert.equal(qb.players[1].name, 'Quinn Ewers');
  assert.equal(qb.players[1].starter, false);

  const wr1 = offense.positions.find(position => position.pos === 'WR1');
  assert.equal(wr1.players[0].name, 'Parker Washington');
  assert.equal(wr1.players[0].starter, true);
  assert.equal(wr1.players[1].starter, false);

  const rows = flatten(joined);
  const hunter = rows.filter(row => row.player.id === '4685415');
  assert.equal(hunter.length, 2);
  assert.deepEqual(hunter.map(row => [row.section, row.pos, row.player.starter]), [
    ['Offense', 'WR2', false],
    ['Defense', 'LCB', true]
  ]);

  const depthOnly = rows.find(row => row.player.id === '4241278');
  assert.equal(depthOnly.player.name, 'Jaylon Jones');
  assert.equal(depthOnly.pos, 'LCB');
  assert.equal(depthOnly.player.starter, false);
  assert.equal(depthOnly.player.college, null);
  assert.equal(depthOnly.player.jersey, null);
  assert.equal(depthOnly.player.headshot, null);
  assert.equal(depthOnly.player.injury, 'Questionable');

  const green = rows.find(row => row.player.name === 'B.J. Green II');
  assert.equal(green.pos, 'LDE');
  assert.equal(green.player.starter, false);
  assert.equal(green.player.injury, 'Injured Reserve');
  assert.equal(green.player.position, 'DE');

  const ameer = rows.find(row => row.player.id === '2576336' && row.pos === 'RB');
  assert.equal(ameer.player.college, 'Nebraska');
  assert.equal(ameer.player.experience, 12);
  assert.equal(ameer.player.starter, false);

  const brown = rows.find(row => row.player.name === 'Montaric Brown');
  assert.equal(brown.player.starter, true);
  assert.equal(brown.player.injury, 'Questionable');

  assert.equal(joined.other.length, 20);
  const otherIds = new Set(joined.other.map(player => player.id));
  assert.equal(otherIds.has('3059989'), true);
  assert.equal(joined.other.find(player => player.id === '3059989').name, 'Nick Mullens');
  assert.equal(otherIds.has('4047655'), true);
  assert.equal(joined.other.find(player => player.id === '4047655').name, 'Jaylon Jones');
  assert.equal(otherIds.has('4360310'), false);
  assert.equal(otherIds.has('4241278'), false);
  const aguilar = joined.other.find(player => player.name === 'Joey Aguilar');
  assert.equal(aguilar.experience, 0);
  assert.equal(aguilar.starter, false);
  assert.equal(aguilar.college, 'Tennessee');
  const hill = joined.other.find(player => player.name === 'Jamal Hill');
  assert.equal(hill.jersey, null);
  assert.equal(hill.experience, null);

  const rosterIds = new Set();
  for (const group of roster.athletes) {
    for (const player of group.items) rosterIds.add(String(player.id));
  }
  const seen = new Set(otherIds);
  for (const row of rows) seen.add(row.player.id);
  for (const id of rosterIds) assert.equal(seen.has(id), true, id);
  for (const player of [...rows.map(row => row.player), ...joined.other]) {
    assert.equal(player.draft, null);
    assert.equal(typeof player.starter, 'boolean');
  }
  for (const player of joined.other) assert.equal(player.starter, false);
});

test('depth order, duplicate slots, and players missing from the chart', () => {
  const joined = joinRoster({
    athletes: [
      { position: 'offense', items: [
        { id: '10', displayName: 'Starter QB', jersey: '1', displayHeight: '6\' 2"', displayWeight: '220 lbs', age: 28, experience: { years: 4 }, college: { name: 'Test U' }, headshot: { href: 'https://example.com/a.png' }, position: { abbreviation: 'QB' }, injuries: [] },
        { id: '11', displayName: 'Backup', jersey: '2', position: { abbreviation: 'QB' }, injuries: [{ status: 'Out' }], experience: { years: 0 }, age: 22, college: { name: 'Other' } }
      ]},
      { position: 'practiceSquad', items: [
        { id: '12', displayName: 'Practice Player', jersey: '3', position: { abbreviation: 'WR' }, injuries: [], experience: { years: 1 } }
      ]},
      { position: 'suspended', items: [
        { id: '13', displayName: 'Suspended Guy', position: { abbreviation: 'RB' }, injuries: [] }
      ]}
    ]
  }, {
    depthchart: [
      { name: 'Base 4-3 D', positions: { lcb: { athletes: [{ id: '99', displayName: 'Only Depth' }] } } },
      { name: '3WR 1TE', positions: { qb: { athletes: [
        { id: '10', displayName: 'Starter QB' },
        { id: '11', displayName: 'Backup' },
        { id: '10', displayName: 'Starter QB' }
      ] } } },
      { name: 'Special Teams', positions: { pk: { athletes: [{ id: '11', displayName: 'Backup', injuries: [{ status: 'Out' }] }] } } }
    ]
  });

  assert.deepEqual(joined.sections.map(section => section.name), ['Offense', 'Defense', 'Special Teams']);
  const qb = joined.sections[0].positions[0];
  assert.equal(qb.pos, 'QB');
  assert.deepEqual(qb.players.map(player => [player.id, player.starter]), [['10', true], ['11', false]]);
  assert.equal(qb.players[1].injury, 'Out');
  assert.equal(qb.players[0].college, 'Test U');
  assert.equal(joined.sections[2].positions[0].players[0].id, '11');
  assert.equal(joined.sections[2].positions[0].players[0].starter, true);
  assert.equal(joined.sections[1].positions[0].players[0].name, 'Only Depth');
  assert.equal(joined.sections[1].positions[0].players[0].headshot, null);
  assert.deepEqual(joined.other.map(player => player.id), ['12', '13']);
});

test('empty depth chart leaves every roster player in other', () => {
  const joined = joinRoster(roster, { depthchart: [] });
  assert.deepEqual(joined.sections, []);
  assert.equal(joined.other.length, roster.athletes.reduce((sum, group) => sum + group.items.length, 0));
});

test('draft ids are validated and capped at 40', () => {
  assert.deepEqual(parseDraftIds(' 5, 5,6 ').ids, ['5', '6']);
  assert.equal(parseDraftIds('').error, 'Missing ids');
  assert.equal(parseDraftIds('1,abc').error, 'Invalid athlete id');
  assert.equal(parseDraftIds(Array.from({ length: MAX_DRAFT_IDS }, (_, index) => index + 1).join(',')).ids.length, 40);
  assert.match(parseDraftIds(Array.from({ length: 41 }, (_, index) => index + 1).join(',')).error, /max 40/);
  assert.equal(parseTeamId('30'), '30');
  assert.equal(parseTeamId('1'), '1');
  assert.equal(parseTeamId('34'), '34');
  for (const value of ['0', '35', '01', '30abc', '', '3.5']) assert.equal(parseTeamId(value), null);
});

test('displayDraft from the common v3 athlete payload parses to year, round, and pick', () => {
  assert.equal(athlete.athlete.id, '4567048');
  assert.equal(athlete.athlete.displayName, 'Kenneth Walker III');
  assert.equal(athlete.athlete.displayDraft, '2022: Rd 2, Pk 41 (SEA)');
  assert.deepEqual(draftFromAthlete(athlete), { year: 2022, round: 2, pick: 41 });
  assert.equal(undraftedAthlete.athlete.id, '3916433');
  assert.equal(undraftedAthlete.athlete.displayName, 'Jakobi Meyers');
  assert.equal(Object.hasOwn(undraftedAthlete.athlete, 'displayDraft'), false);
  assert.equal(draftFromAthlete(undraftedAthlete), null);
  assert.deepEqual(draftFromAthlete({ athlete: { displayDraft: '2019: Rd 4, Pk 12 (NYG)' } }), { year: 2019, round: 4, pick: 12 });
  assert.equal(draftFromAthlete({ athlete: { displayDraft: 'undrafted' } }), null);
  assert.equal(draftFromAthlete({ draft: { year: 2019, round: 4, selection: 12, displayText: 'Year: 2019 Round: 4 Pick: 12' } }), null);
});

test('saved live /roster response is the shape the page renders', () => {
  assert.equal(liveRoster.source, 'ESPN depth chart');
  assert.equal(liveRoster.team.id, '30');
  assert.equal(liveRoster.team.abbreviation, 'JAX');
  assert.equal(Array.isArray(liveRoster.sections), true);
  assert.equal(Array.isArray(liveRoster.other), true);
  const qb = liveRoster.sections[0].positions.find(position => position.pos === 'QB').players[0];
  assert.equal(qb.name, 'Trevor Lawrence');
  assert.equal(qb.starter, true);
  assert.equal(qb.draft, null);
  const meyers = liveRoster.sections[0].positions.find(position => position.pos === 'WR2').players[0];
  assert.equal(meyers.id, '3916433');
  assert.equal(meyers.name, 'Jakobi Meyers');
  assert.equal(meyers.draft, null);
});

test('mapPool limits how many draft lookups run at once', async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active -= 1;
    return item;
  });
  assert.equal(maxActive, 3);
  assert.deepEqual(results, [1, 2, 3, 4, 5, 6, 7]);
});

function throwingCache() {
  return {
    async match() { throw new Error('cache.match should not run during /draft'); },
    async put() { throw new Error('cache.put should not run during /draft'); }
  };
}

test('draft route makes one common-v3 fetch per id and does not use the Cache API', async () => {
  let active = 0;
  let maxActive = 0;
  const fetched = [];
  const fetchImpl = async (url, init) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    fetched.push({ url, init });
    const id = url.slice(url.lastIndexOf('/') + 1);
    if (id === '9') return new Response('nope', { status: 500 });
    if (id === '2') return Response.json({ athlete: { id, displayName: 'No draft line' } });
    return Response.json({ athlete: { id, displayDraft: `2020: Rd 1, Pk ${id}` } });
  };
  const handler = createHandler({ fetch: fetchImpl, cache: throwingCache() });
  const ids = Array.from({ length: 10 }, (_, index) => String(index + 1));
  const response = await handler(new Request(`https://nfl.example/draft?ids=${ids.join(',')}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(maxActive <= DRAFT_CONCURRENCY);
  assert.ok(maxActive > 1);
  assert.deepEqual(body['1'], { year: 2020, round: 1, pick: 1 });
  assert.equal(body['2'], null);
  assert.equal(Object.hasOwn(body, '9'), false);
  assert.equal(fetched.length, ids.length);
  for (const call of fetched) {
    assert.match(call.url, /^https:\/\/site\.api\.espn\.com\/apis\/common\/v3\/sports\/football\/nfl\/athletes\/\d+$/);
    assert.equal(call.init.cf.cacheTtl, DRAFT_CACHE_SECONDS);
    assert.equal(call.init.cf.cacheEverything, true);
  }
  const again = await handler(new Request(`https://nfl.example/draft?ids=${ids.join(',')}`));
  assert.equal(again.status, 200);
  assert.equal(fetched.length, ids.length * 2);
  assert.equal((await again.json())['1'].year, 2020);
});

test('createHandler default fetch is not called with the deps object as this', async () => {
  const original = globalThis.fetch;
  const receivers = [];
  globalThis.fetch = function (...args) {
    receivers.push(this);
    const url = String(args[0]);
    assert.match(url, /\/apis\/common\/v3\/sports\/football\/nfl\/athletes\/4567048$/);
    return Promise.resolve(Response.json({ athlete: { displayDraft: '2022: Rd 2, Pk 41 (SEA)' } }));
  };
  try {
    const handler = createHandler();
    const response = await handler(new Request('https://nfl.example/draft?ids=4567048'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json())['4567048'], { year: 2022, round: 2, pick: 41 });
    assert.equal(receivers.length, 1);
    const receiver = receivers[0];
    const calledAsDeps = !!(receiver && typeof receiver === 'object' && typeof receiver.fetch === 'function' && Object.hasOwn(receiver, 'cache'));
    assert.equal(calledAsDeps, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('draft route rejects more than 40 ids before fetching', async () => {
  let calls = 0;
  const handler = createHandler({ fetch: async () => { calls += 1; return Response.json({}); }, cache: memoryCache() });
  const ids = Array.from({ length: 41 }, (_, index) => index + 1).join(',');
  const response = await handler(new Request(`https://nfl.example/draft?ids=${ids}`));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  const duplicate = await handler(new Request('https://nfl.example/draft?ids=5,5,6'));
  assert.equal(duplicate.status, 200);
  assert.equal(calls, 2);
});

test('roster route joins, caches for two hours, and keeps the old proxy', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/roster')) return Response.json(roster);
    if (url.endsWith('/depthcharts')) return Response.json(depth);
    return Response.json({ ok: true, url });
  };
  const cache = memoryCache();
  const handler = createHandler({ fetch: fetchImpl, cache });

  const missing = await handler(new Request('https://nfl.example/roster'));
  assert.equal(missing.status, 400);
  const high = await handler(new Request('https://nfl.example/roster?team=35'));
  assert.equal(high.status, 400);

  const response = await handler(new Request('https://nfl.example/roster?team=30', {
    headers: { Origin: ALLOWED_ORIGIN }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  assert.equal(response.headers.get('Cache-Control'), `public, max-age=${ROSTER_CACHE_SECONDS}`);
  const payload = await response.json();
  assert.equal(payload.source, 'ESPN depth chart');
  assert.equal(payload.team.id, '30');
  assert.equal(payload.team.abbreviation, 'JAX');
  assert.equal(payload.sections[0].positions.find(position => position.pos === 'QB').players[0].name, 'Trevor Lawrence');
  assert.equal(calls.length, 2);
  const cached = cache.store.get('https://nfl-live-data.cache/roster/30');
  assert.equal(cached.headers.get('Cache-Control'), `public, max-age=${ROSTER_CACHE_SECONDS}`);

  const second = await handler(new Request('https://nfl.example/roster?team=30'));
  assert.equal(second.status, 200);
  assert.equal(calls.length, 2);
  assert.equal((await second.json()).sections.length, 3);

  const blocked = await handler(new Request('https://nfl.example/roster?team=30', {
    headers: { Origin: 'https://evil.example' }
  }));
  assert.equal(blocked.status, 403);

  const options = await handler(new Request('https://nfl.example/roster?team=30', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  const posted = await handler(new Request('https://nfl.example/teams', { method: 'POST' }));
  assert.equal(posted.status, 405);

  const scoreboard = await handler(new Request('https://nfl.example/scoreboard?season=2026&seasontype=2&week=1&limit=30'));
  assert.equal(scoreboard.status, 200);
  assert.equal(scoreboard.headers.get('Cache-Control'), 'public, max-age=15');
  const target = calls.at(-1);
  assert.match(target, /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?/);
  assert.match(target, /season=2026/);
  assert.match(target, /seasontype=2/);
  assert.match(target, /week=1/);
  assert.match(target, /limit=30/);

  const root = await handler(new Request('https://nfl.example/'));
  const described = await root.json();
  assert.deepEqual(described.endpoints, ['/teams', '/scoreboard', '/standings', '/roster', '/draft', '/stats']);
  assert.equal(described.message, 'NFL Data API is running');
});

test('roster failures are not cached', async () => {
  let mode = 'missing';
  const fetchImpl = async (url) => {
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'missing') return new Response('missing', { status: url.endsWith('/roster') ? 404 : 200 });
    return new Response('upstream', { status: 500 });
  };
  const cache = memoryCache();
  const handler = createHandler({ fetch: fetchImpl, cache });
  const missing = await handler(new Request('https://nfl.example/roster?team=30'));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).unavailable, true);
  mode = 'throw';
  assert.equal((await handler(new Request('https://nfl.example/roster?team=30'))).status, 502);
  mode = 'down';
  assert.equal((await handler(new Request('https://nfl.example/roster?team=30'))).status, 502);
  assert.equal(cache.store.size, 0);
});

test('stats route normalizes the saved ESPN payload with one fetch and no Cache API', async () => {
  const calls = [];
  let cacheHits = 0;
  const cache = memoryCache();
  const match = cache.match.bind(cache);
  const put = cache.put.bind(cache);
  cache.match = async (...args) => { cacheHits += 1; return match(...args); };
  cache.put = async (...args) => { cacheHits += 1; return put(...args); };
  const handler = createHandler({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(statsFixture);
    },
    cache
  });

  const blocked = await handler(new Request('https://nfl.example/stats?team=30', {
    headers: { Origin: 'https://evil.example' }
  }));
  assert.equal(blocked.status, 403);
  assert.equal(calls.length, 0);

  const missing = await handler(new Request('https://nfl.example/stats'));
  assert.equal(missing.status, 400);
  const high = await handler(new Request('https://nfl.example/stats?team=35'));
  assert.equal(high.status, 400);
  assert.equal(calls.length, 0);

  const response = await handler(new Request('https://nfl.example/stats?team=30', {
    headers: { Origin: ALLOWED_ORIGIN }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
  assert.equal(response.headers.get('Cache-Control'), `public, max-age=${STATS_CACHE_SECONDS}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.cf.cacheTtl, STATS_CACHE_SECONDS);
  assert.equal(calls[0].init.cf.cacheEverything, true);
  assert.match(calls[0].url, /\/apis\/site\/v2\/sports\/football\/nfl\/teams\/30\/statistics$/);
  assert.equal(cacheHits, 0);

  const body = await response.json();
  assert.equal(body.team.id, '30');
  assert.equal(body.team.abbreviation, 'JAX');
  assert.equal(body.team.name, 'Jacksonville Jaguars');
  assert.equal(body.season, 2026);
  assert.equal(body.gamesPlayed, 6);
  assert.ok(JSON.stringify(body).length < 5000, `stats payload is ${JSON.stringify(body).length} bytes`);
  const offense = Object.fromEntries(body.offense.map(tile => [tile.key, tile]));
  const defense = Object.fromEntries(body.defense.map(tile => [tile.key, tile]));
  assert.equal(offense.pointsPerGame.display, '25.7');
  assert.equal(offense.pointsPerGame.rank, undefined);
  assert.equal(offense.yardsPerGame.display, '359.5');
  assert.equal(offense.passingYardsPerGame.display, '246.7');
  assert.equal(offense.rushingYardsPerGame.display, '112.8');
  assert.equal(offense.passingTouchdowns.display, '14');
  assert.equal(offense.rushingTouchdowns.display, '4');
  assert.equal(offense.completionPct.display, '65.2');
  assert.equal(offense.yardsPerRush.display, '4.1');
  assert.equal(offense.thirdDownPct.display, '47.95');
  assert.equal(offense.firstDowns.display, '128');
  assert.equal(offense.giveaways.display, '4');
  assert.equal(offense.sacksTaken.display, '10');
  assert.equal(defense.yardsAllowed.display, '355.2');
  assert.equal(defense.yardsAllowed.rank, 18);
  assert.equal(defense.pointsAllowed.display, '17.3');
  assert.equal(defense.pointsAllowed.rank, 3);
  assert.equal(defense.sacks.display, '11');
  assert.equal(defense.sacks.rank, undefined);
  assert.equal(defense.interceptions.display, '7');
  assert.equal(defense.forcedFumbles.display, '4');
  assert.equal(defense.fumbleRecoveries.display, '2');
  assert.equal(defense.takeaways.display, '9');
  assert.equal(defense.tackles.display, '383');
  assert.equal(defense.tacklesForLoss.display, '24');

  const again = await handler(new Request('https://nfl.example/stats?team=30'));
  assert.equal(again.status, 200);
  assert.equal(calls.length, 2, 'each /stats call is one fetch; the Cache API is not used');
  assert.equal(cacheHits, 0);
});

test('stats route computes per-game rates only from totals and games played', () => {
  assert.equal(statCategories(statsFixture.results.opponent).length, 11);
  assert.equal(statCategories(statsFixture.results.stats).length, 11);
  const normalized = normalizeTeamStats({
    team: { id: '4', displayName: 'Cincinnati Bengals', abbreviation: 'CIN' },
    season: { year: 2025 },
    results: {
      stats: {
        categories: [
          { name: 'general', stats: [{ name: 'gamesPlayed', displayValue: '4', value: 4 }] },
          { name: 'scoring', stats: [{ name: 'totalPoints', displayValue: '80', value: 80 }] },
          { name: 'rushing', stats: [{ name: 'totalYards', displayValue: '1000', value: 1000 }, { name: 'rushingYards', displayValue: '400', value: 400 }] },
          { name: 'passing', stats: [{ name: 'passingYards', displayValue: '600', value: 600, rank: 4 }, { name: 'sacks', displayValue: '8', value: 8 }] },
          { name: 'defensive', stats: [{ name: 'sacks', displayValue: '9', value: 9 }] }
        ]
      },
      opponent: {
        categories: [
          { name: 'scoring', stats: [{ name: 'totalPoints', displayValue: '60', value: 60, rank: 2 }] }
        ]
      }
    }
  }, '4');
  const offense = Object.fromEntries(normalized.offense.map(tile => [tile.key, tile]));
  const defense = Object.fromEntries(normalized.defense.map(tile => [tile.key, tile]));
  assert.equal(normalized.gamesPlayed, 4);
  assert.equal(offense.pointsPerGame.display, '20');
  assert.equal(offense.pointsPerGame.computed, true);
  assert.equal(offense.pointsPerGame.rank, undefined);
  assert.equal(offense.yardsPerGame.display, '250');
  assert.equal(offense.yardsPerGame.computed, true);
  assert.equal(offense.passingYardsPerGame.display, '150');
  assert.equal(offense.passingYardsPerGame.computed, true);
  assert.equal(offense.passingYardsPerGame.rank, undefined);
  assert.equal(offense.sacksTaken.display, '8');
  assert.equal(offense.thirdDownPct.display, null);
  assert.equal(defense.pointsAllowed.display, '15');
  assert.equal(defense.pointsAllowed.computed, true);
  assert.equal(defense.pointsAllowed.rank, undefined);
  assert.equal(defense.yardsAllowed.display, null);
  assert.equal(defense.sacks.display, '9');
  assert.equal(defense.tacklesForLoss.display, null);

  const totalsOnly = normalizeTeamStats({
    results: {
      stats: { categories: [{ name: 'scoring', stats: [{ name: 'totalPoints', displayValue: '99', value: 99, rank: 8 }] }] }
    }
  }, '8');
  const points = totalsOnly.offense.find(tile => tile.key === 'pointsPerGame');
  assert.equal(points.display, '99');
  assert.equal(points.label, 'Points');
  assert.equal(points.rank, 8);
  assert.equal(points.computed, undefined);
  assert.equal(totalsOnly.gamesPlayed, null);
});

test('stats failures are not turned into an empty success', async () => {
  let mode = 'missing';
  const handler = createHandler({
    fetch: async () => {
      if (mode === 'throw') throw new Error('network down');
      if (mode === 'missing') return new Response('missing', { status: 404 });
      if (mode === 'html') return new Response('<html>nope</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      return new Response('upstream', { status: 500 });
    },
    cache: memoryCache()
  });
  const missing = await handler(new Request('https://nfl.example/stats?team=30'));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).unavailable, true);
  mode = 'html';
  assert.equal((await handler(new Request('https://nfl.example/stats?team=30'))).status, 502);
  mode = 'throw';
  assert.equal((await handler(new Request('https://nfl.example/stats?team=30'))).status, 502);
  mode = 'down';
  assert.equal((await handler(new Request('https://nfl.example/stats?team=30'))).status, 502);
});

test('worker source stays on the Cache API without a KV binding', () => {
  const source = readFileSync(join(root, '../worker/worker.js'), 'utf8');
  const toml = readFileSync(join(root, '../worker/wrangler.toml'), 'utf8');
  assert.match(source, /caches\.default/);
  assert.match(source, /\(\.\.\.args\) => fetch\(\.\.\.args\)/);
  assert.match(source, /apis\/common\/v3\/sports\/football\/nfl\/athletes/);
  assert.doesNotMatch(source, /sports\.core\.api\.espn\.com/);
  const statsFn = source.slice(source.indexOf('async function handleStats'), source.indexOf('async function handleDraft'));
  assert.match(statsFn, /teams\/\$\{teamId\}\/statistics/);
  assert.match(statsFn, /cacheTtl:\s*STATS_CACHE_SECONDS/);
  assert.match(statsFn, /cacheEverything:\s*true/);
  assert.doesNotMatch(statsFn, /cacheGet|cachePut|caches/);
  assert.doesNotMatch(source, /kv_namespaces|KVNamespace/);
  assert.doesNotMatch(toml, /kv_namespaces/);
  assert.match(toml, /name = "nfl-live-data"/);
});
