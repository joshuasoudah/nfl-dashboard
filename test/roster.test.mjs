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
  parseDraftIds,
  parseTeamId
} from '../worker/worker.js';

const root = dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(readFileSync(join(root, 'fixtures/roster30.json'), 'utf8'));
const depth = JSON.parse(readFileSync(join(root, 'fixtures/dc_site30.json'), 'utf8'));
const athlete = JSON.parse(readFileSync(join(root, 'fixtures/ath.json'), 'utf8'));

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

test('athlete draft uses year, round, and selection', () => {
  assert.deepEqual(draftFromAthlete(athlete), { year: 2022, round: 1, pick: 1 });
  assert.equal(draftFromAthlete({ id: '1', displayName: 'Undrafted' }), null);
  assert.equal(draftFromAthlete({ draft: { displayText: 'Undrafted' } }), null);
  assert.deepEqual(draftFromAthlete({ draft: { year: 2019, round: 4, pick: 12 } }), { year: 2019, round: 4, pick: 12 });
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

test('draft route batches with a concurrency cap, caches hits, and skips failures', async () => {
  let active = 0;
  let maxActive = 0;
  const fetched = [];
  const fetchImpl = async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    fetched.push(url);
    const id = url.slice(url.lastIndexOf('/') + 1);
    if (id === '9') return new Response('nope', { status: 500 });
    const body = id === '2' ? { id } : { id, draft: { year: 2020, round: 1, selection: Number(id) } };
    return Response.json(body);
  };
  const cache = memoryCache();
  const handler = createHandler({ fetch: fetchImpl, cache });
  const ids = Array.from({ length: 10 }, (_, index) => String(index + 1)).join(',');
  const response = await handler(new Request(`https://nfl.example/draft?ids=${ids}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(maxActive <= DRAFT_CONCURRENCY);
  assert.ok(maxActive > 1);
  assert.equal(body['1'].pick, 1);
  assert.equal(body['2'], null);
  assert.equal(Object.hasOwn(body, '9'), false);
  assert.equal(fetched.length, 10);

  const stored = cache.store.get('https://nfl-live-data.cache/athlete/4426349');
  assert.equal(stored, undefined);
  const cachedAthlete = cache.store.get('https://nfl-live-data.cache/athlete/1');
  assert.equal(cachedAthlete.headers.get('Cache-Control'), `public, max-age=${DRAFT_CACHE_SECONDS}`);
  assert.equal(cache.store.has('https://nfl-live-data.cache/athlete/9'), false);

  const again = await handler(new Request(`https://nfl.example/draft?ids=${ids}`));
  const againBody = await again.json();
  assert.equal(fetched.length, 11);
  assert.equal(againBody['1'].year, 2020);
  assert.equal(Object.hasOwn(againBody, '9'), false);
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
  assert.deepEqual(described.endpoints, ['/teams', '/scoreboard', '/standings', '/roster', '/draft']);
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

test('worker source stays on the Cache API without a KV binding', () => {
  const source = readFileSync(join(root, '../worker/worker.js'), 'utf8');
  const toml = readFileSync(join(root, '../worker/wrangler.toml'), 'utf8');
  assert.match(source, /caches\.default/);
  assert.doesNotMatch(source, /kv_namespaces|KVNamespace/);
  assert.doesNotMatch(toml, /kv_namespaces/);
  assert.match(toml, /name = "nfl-live-data"/);
});
