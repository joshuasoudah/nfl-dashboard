import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeStandings,
  normalizeDraft,
  safe,
  sanitizeDraftCache,
  sanitizePrefs,
  seasonYear,
  winningPercentage
} from '../logic.js';

const IDS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','33','34'];

function teamsPayload(names = {}) {
  return {
    sports: [{ leagues: [{ teams: IDS.map(id => ({
      team: {
        id,
        displayName: names[id] || `Team ${id.padStart(2, '0')}`,
        abbreviation: `T${id}`,
        logos: [{ href: `https://example.com/${id}.png` }],
        color: '00338d'
      }
    })) }] }]
  };
}

function weeks(map = {}) {
  const slots = [];
  for (let week = 1; week <= 18; week++) slots.push({ ok: true, body: { events: map[week] || [] } });
  for (let week = 1; week <= 5; week++) slots.push({ ok: true, body: { events: map[`p${week}`] || [] } });
  return slots;
}

function game(week, homeId, awayId, homeScore, awayScore, extra = {}) {
  const live = !!extra.live;
  return {
    id: extra.id || `${extra.type || 2}-${week}-${homeId}-${awayId}`,
    date: extra.date || `2026-09-${String(Math.min(week, 28)).padStart(2, '0')}T17:00:00Z`,
    week: { number: extra.weekNumber || week },
    season: { type: extra.type || 2 },
    status: live ? {
      displayClock: extra.clock || '8:21',
      period: 2,
      type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS', shortDetail: 'Q2 8:21' }
    } : { type: { completed: extra.completed !== false, state: 'post', name: 'STATUS_FINAL' } },
    competitions: [{ competitors: [
      { id: String(homeId), homeAway: 'home', score: String(homeScore), team: { abbreviation: 'HOM' } },
      { id: String(awayId), homeAway: 'away', score: String(awayScore), team: { abbreviation: 'AWY' } }
    ] }]
  };
}

function byId(result, id) {
  return result.teams.find(team => team.id === id);
}

test('winning percentage counts a tie as half a win and zero games as zero', () => {
  assert.equal(winningPercentage(0, 0, 0), 0);
  assert.equal(winningPercentage(1, 0, 0), 1);
  assert.equal(winningPercentage(0, 0, 1), 0.5);
  assert.equal(winningPercentage(8, 8, 0), 0.5);
  assert.equal(winningPercentage(0, 0, 2), 0.5);
});

test('standings order is win percentage, then wins, then point differential, then name', () => {
  const result = computeStandings(teamsPayload({
    '34': 'AAA Zero',
    '22': 'ZZZ Zero'
  }), weeks({
    1: [
      game(1, '1', '3', 20, 0),
      game(1, '2', '4', 3, 0, { id: 'close' })
    ],
    2: [game(2, '1', '5', 7, 6, { id: 'second' })]
  }));
  assert.equal(result.ok, true);
  const order = result.teams.map(team => team.id);
  assert.equal(order[0], '1', 'two wins ranks above one win at the same percentage');
  assert.equal(order[1], '2');
  const top = byId(result, '1');
  assert.equal(top.w, 2);
  assert.equal(top.l, 0);
  assert.equal(top.pct, 1);
  assert.equal(top.pf - top.pa, 21);
  const oneWin = byId(result, '2');
  assert.equal(oneWin.w, 1);
  assert.equal(oneWin.pf - oneWin.pa, 3);
  const zeros = result.teams.filter(team => team.w + team.l + team.t === 0);
  assert.equal(zeros[0].name, 'AAA Zero');
  assert.equal(zeros.at(-1).name, 'ZZZ Zero');
});

test('a tie updates both clubs and does not invent a winner', () => {
  const result = computeStandings(teamsPayload(), weeks({ 1: [game(1, '30', '34', 10, 10)] }));
  const jax = byId(result, '30');
  const hou = byId(result, '34');
  assert.equal(jax.t, 1);
  assert.equal(hou.t, 1);
  assert.equal(jax.w, 0);
  assert.equal(jax.pct, 0.5);
  assert.equal(jax.games[0].result, 'T');
  assert.equal(hou.games[0].result, 'T');
  assert.ok(result.teams.indexOf(jax) < result.teams.findIndex(team => team.pct === 0));
});

test('zero games, bye weeks, live games, and the postseason stay out of the record', () => {
  const result = computeStandings(teamsPayload(), weeks({
    1: [game(1, '30', '34', 24, 17)],
    3: [game(3, '30', '10', 20, 10, { id: 'week3' })],
    2: [game(2, '2', '15', 14, 10, { live: true, id: 'live' })],
    p1: [game(1, '30', '2', 31, 3, { type: 3, id: 'wc' })]
  }));
  const jax = byId(result, '30');
  assert.deepEqual([jax.w, jax.l, jax.t], [2, 0, 0]);
  assert.deepEqual(jax.games.map(item => item.week).sort(), [1, 1, 3]);
  assert.equal(jax.games.filter(item => item.type === 2).length, 2);
  assert.equal(jax.games.some(item => item.week === 2), false);
  const playoff = jax.games.find(item => item.type === 3);
  assert.equal(playoff.round, 'Wild Card');
  assert.equal(playoff.result, 'W');
  const bills = byId(result, '2');
  assert.deepEqual([bills.w, bills.l, bills.t], [0, 0, 0]);
  const live = bills.games.find(item => item.live);
  assert.equal(live.myScore, 14);
  assert.equal(live.clock, 'Q2 8:21');
  assert.equal(live.myLogo.startsWith('https://'), true);
  assert.equal(live.otherLogo.startsWith('https://'), true);
  const idle = byId(result, '22');
  assert.equal(idle.pct, 0);
  assert.equal(idle.games.length, 0);
});

test('a bad week and a bad event do not throw away the good games', () => {
  const slots = weeks({ 1: [null, game(1, '9', '3', 17, 14)] });
  slots[1] = { ok: true, body: { events: 'not-a-list' } };
  slots[2] = { ok: false };
  const result = computeStandings(teamsPayload(), slots);
  assert.equal(result.ok, true);
  assert.ok(result.failures >= 2);
  assert.equal(byId(result, '9').w, 1);
  assert.equal(byId(result, '9').games[0].opponent, 'Team 03');
});

test('empty or hostile team payloads fail closed', () => {
  assert.equal(computeStandings(null, weeks()).ok, false);
  assert.equal(computeStandings({}, weeks()).ok, false);
  assert.equal(computeStandings({ sports: [{ leagues: [{ teams: [] }] }] }, weeks()).ok, false);
  assert.match(computeStandings({ sports: [] }, weeks()).error, /32/);
  const hostile = teamsPayload();
  hostile.sports[0].leagues[0].teams[0].team.displayName = '<img src=x onerror=alert(1)>';
  hostile.sports[0].leagues[0].teams[0].team.logos = [{ href: 'javascript:alert(1)' }];
  const named = computeStandings(hostile, weeks({ 1: [game(1, '1', '2', 1, 0)] }));
  assert.equal(named.ok, true);
  assert.equal(byId(named, '1').name, '<img src=x onerror=alert(1)>');
  assert.equal(byId(named, '1').logo, '');
  const empty = computeStandings(teamsPayload(), weeks());
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'No NFL schedule data available');
  const down = computeStandings(teamsPayload(), Array.from({ length: 23 }, () => ({ ok: false })));
  assert.equal(down.ok, false);
  assert.equal(down.error, 'Could not load the weekly schedule');
});

test('season year follows the NFL calendar and HTML escaping covers quotes', () => {
  assert.equal(seasonYear(new Date('2026-10-28T12:00:00Z')), 2026);
  assert.equal(seasonYear(new Date('2027-01-15T12:00:00Z')), 2026);
  assert.equal(seasonYear(new Date('2027-03-02T12:00:00Z')), 2027);
  assert.equal(safe(`<img src=x onerror=alert(1)>"'`), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
});

test('saved preferences and draft cache reject corrupt or hostile values', () => {
  assert.deepEqual(sanitizePrefs(null).theme, 'system');
  assert.equal(sanitizePrefs([]).autoRefresh, true);
  const clean = sanitizePrefs({
    theme: '<script>',
    autoRefresh: 'false',
    favoriteId: '<img src=x>',
    expanded: ['30', '<b>', '30', 2, null, '9999'],
    tabs: { '30': 'roster', '<bad>': 'roster', '2': 'nope', '15': 'games', '34': 'stats' },
    otherOpen: { '30': true, '2': 'yes', '<x>': true }
  });
  assert.equal(clean.theme, 'system');
  assert.equal(clean.autoRefresh, true);
  assert.equal('favoriteId' in clean, false);
  assert.deepEqual(clean.expanded, ['30', '2']);
  assert.deepEqual(clean.tabs, { '30': 'roster', '15': 'games', '34': 'stats' });
  assert.deepEqual(clean.otherOpen, { '30': true });
  assert.equal('favoriteId' in sanitizePrefs({ theme: 'light', favoriteId: 30, autoRefresh: false }), false);

  const now = Date.now();
  const drafts = sanitizeDraftCache({
    '4360310': { draft: { year: 2021, round: 1, pick: 1 }, exp: now + 1000 },
    '3916433': { draft: null, exp: now + 1000 },
    '<img>': { draft: { year: 2020, round: 1, pick: 1 }, exp: now + 1000 },
    '12': { draft: { year: '<img src=x>', round: 1, pick: 1 }, exp: now + 1000 },
    '13': { exp: now + 1000 },
    '14': { draft: { year: 2019, round: 2, pick: 3 }, exp: now - 5 }
  }, now);
  assert.deepEqual(drafts.map(entry => entry.id).sort(), ['3916433', '4360310']);
  assert.equal(normalizeDraft({ year: 2019.5, round: 1, pick: 1 }), null);
  assert.equal(sanitizeDraftCache(null).length, 0);
  assert.equal(sanitizeDraftCache('nope').length, 0);
});
