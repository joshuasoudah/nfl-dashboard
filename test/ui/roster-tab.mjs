import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { joinRoster } from '../../worker/worker.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rosterJson = JSON.parse(readFileSync(join(root, 'test/fixtures/roster30.json'), 'utf8'));
const depthJson = JSON.parse(readFileSync(join(root, 'test/fixtures/dc_site30.json'), 'utf8'));
const joined = joinRoster(rosterJson, depthJson);
const jaguars = {
  team: { id: '30', name: 'Jacksonville Jaguars', abbreviation: 'JAX' },
  updated: '2026-10-26T16:00:00.000Z',
  source: 'ESPN depth chart',
  sections: joined.sections,
  other: joined.other
};

const TEAMS = [
  [1, 'Atlanta Falcons', 'ATL', 'atl'],
  [2, 'Buffalo Bills', 'BUF', 'buf'],
  [3, 'Chicago Bears', 'CHI', 'chi'],
  [4, 'Cincinnati Bengals', 'CIN', 'cin'],
  [5, 'Cleveland Browns', 'CLE', 'cle'],
  [6, 'Dallas Cowboys', 'DAL', 'dal'],
  [7, 'Denver Broncos', 'DEN', 'den'],
  [8, 'Detroit Lions', 'DET', 'det'],
  [9, 'Green Bay Packers', 'GB', 'gb'],
  [10, 'Tennessee Titans', 'TEN', 'ten'],
  [11, 'Indianapolis Colts', 'IND', 'ind'],
  [12, 'Kansas City Chiefs', 'KC', 'kc'],
  [13, 'Las Vegas Raiders', 'LV', 'lv'],
  [14, 'Los Angeles Rams', 'LAR', 'lar'],
  [15, 'Miami Dolphins', 'MIA', 'mia'],
  [16, 'Minnesota Vikings', 'MIN', 'min'],
  [17, 'New England Patriots', 'NE', 'ne'],
  [18, 'New Orleans Saints', 'NO', 'no'],
  [19, 'New York Giants', 'NYG', 'nyg'],
  [20, 'New York Jets', 'NYJ', 'nyj'],
  [21, 'Philadelphia Eagles', 'PHI', 'phi'],
  [22, 'Arizona Cardinals', 'ARI', 'ari'],
  [23, 'Pittsburgh Steelers', 'PIT', 'pit'],
  [24, 'Los Angeles Chargers', 'LAC', 'lac'],
  [25, 'San Francisco 49ers', 'SF', 'sf'],
  [26, 'Seattle Seahawks', 'SEA', 'sea'],
  [27, 'Tampa Bay Buccaneers', 'TB', 'tb'],
  [28, 'Washington Commanders', 'WSH', 'wsh'],
  [29, 'Carolina Panthers', 'CAR', 'car'],
  [30, 'Jacksonville Jaguars', 'JAX', 'jax'],
  [33, 'Baltimore Ravens', 'BAL', 'bal'],
  [34, 'Houston Texans', 'HOU', 'hou']
];

const teamsPayload = {
  sports: [{ leagues: [{ teams: TEAMS.map(([id, name, abbr, slug]) => ({
    team: {
      id: String(id),
      displayName: name,
      abbreviation: abbr,
      logos: [{ href: `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png` }]
    }
  })) }] }]
};

function competitor(id, name, abbr, homeAway, score) {
  return { id: String(id), homeAway, score: String(score), team: { displayName: name, abbreviation: abbr } };
}

const weekOne = {
  events: [{
    id: 'jax-hou',
    date: '2026-09-13T17:00:00Z',
    week: { number: 1 },
    season: { type: 2 },
    status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitions: [{ competitors: [
      competitor(30, 'Jacksonville Jaguars', 'JAX', 'home', 24),
      competitor(34, 'Houston Texans', 'HOU', 'away', 17)
    ] }]
  }]
};

const weekTwo = {
  events: [{
    id: 'buf-mia',
    date: new Date().toISOString(),
    week: { number: 2 },
    season: { type: 2 },
    status: {
      displayClock: '8:21',
      period: 2,
      type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS', shortDetail: 'Q2 8:21' }
    },
    competitions: [{ competitors: [
      competitor(2, 'Buffalo Bills', 'BUF', 'home', 14),
      competitor(15, 'Miami Dolphins', 'MIA', 'away', 10)
    ] }]
  }]
};

function scoreboardFor(url) {
  const params = new URL(url).searchParams;
  if (params.get('seasontype') === '2' && params.get('week') === '1') return weekOne;
  if (params.get('seasontype') === '2' && params.get('week') === '2') return weekTwo;
  return { events: [] };
}

function mockDraft(id) {
  if (id === '4360310') return { year: 2021, round: 1, pick: 1 };
  if (id === '4426349') return { year: 2022, round: 1, pick: 1 };
  if (id === '4889929') return null;
  const n = Number(id.slice(-3)) || 1;
  return { year: 2018 + (n % 8), round: (n % 7) + 1, pick: (n % 200) + 1 };
}

const billsRoster = {
  team: { id: '2', name: 'Buffalo Bills', abbreviation: 'BUF' },
  updated: '2026-10-26T16:00:00.000Z',
  source: 'ESPN depth chart',
  sections: [{
    name: 'Offense',
    positions: [{
      pos: 'QB',
      players: [{
        id: '14876',
        name: 'Josh Allen',
        jersey: '17',
        position: 'QB',
        height: '6\' 5"',
        weight: '237 lbs',
        age: 30,
        experience: 8,
        headshot: null,
        college: 'Wyoming',
        injury: null,
        starter: true,
        draft: null
      }]
    }]
  }],
  other: []
};

function contentType(path) {
  const ext = extname(path);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webmanifest') return 'application/manifest+json';
  if (ext === '.png') return 'image/png';
  return 'text/plain; charset=utf-8';
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      if (path.includes('..')) {
        res.writeHead(400);
        res.end();
        return;
      }
      try {
        const body = readFileSync(join(root, decodeURIComponent(path)));
        res.writeHead(200, { 'Content-Type': contentType(path), 'Cache-Control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function teamEntry(page, name) {
  return page.locator('.entry').filter({ has: page.locator('.name', { hasText: name }) });
}

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  let releaseDraft = () => {};
  let draftGate = new Promise(resolve => { releaseDraft = resolve; });
  const draftCalls = [];
  let billsFail = true;
  let draftEnabled = true;

  await page.route('**/nfl-live-data.josh-soudah.workers.dev/**', async route => {
    const url = route.request().url();
    if (url.includes('/teams')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(teamsPayload) });
      return;
    }
    if (url.includes('/scoreboard')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scoreboardFor(url)) });
      return;
    }
    if (url.includes('/roster')) {
      const team = new URL(url).searchParams.get('team');
      if (team === '30') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jaguars) });
        return;
      }
      if (team === '2') {
        if (billsFail) {
          await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to retrieve ESPN data' }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(billsRoster) });
        return;
      }
      if (team === '33') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'NFL Data API is running', endpoints: ['/teams', '/scoreboard', '/standings'] })
        });
        return;
      }
      await route.abort('failed');
      return;
    }
    if (url.includes('/draft')) {
      const ids = (new URL(url).searchParams.get('ids') || '').split(',').filter(Boolean);
      draftCalls.push(ids);
      assert(ids.length <= 40, `draft batch has ${ids.length} ids`);
      if (!draftEnabled) {
        await route.abort('failed');
        return;
      }
      await draftGate;
      const body = {};
      for (const id of ids) body[id] = mockDraft(id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    await route.abort('failed');
  });

  await page.route('**/headshots/nfl/players/full/4432620.png', route => route.abort());

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/Updated/).waitFor();
    assert(await page.locator('.team').count() === 32, 'expected 32 teams');
    await teamEntry(page, 'Buffalo Bills').locator('.live-indicator').waitFor();
    await teamEntry(page, 'Miami Dolphins').locator('.live-indicator').waitFor();
    assert((await page.locator('.entry').first().innerText()).includes('Jacksonville Jaguars'), 'Jaguars should rank first');

    const jaguarsButton = teamEntry(page, 'Jacksonville Jaguars').locator('button.team');
    await jaguarsButton.click();
    await page.getByRole('tab', { name: 'Games', selected: true }).waitFor();
    await teamEntry(page, 'Jacksonville Jaguars').locator('.game', { hasText: 'Houston Texans' }).waitFor();
    await page.locator('.result.W').first().waitFor();
    assert(await page.getByText('ESPN depth chart').count() === 0, 'roster should not load with the games tab');

    await page.getByRole('tab', { name: 'Roster' }).click();
    await page.getByText('Loading roster…').waitFor();
    await page.getByText('Parker Washington').first().waitFor();
    const parker = page.locator('.player', { hasText: 'Parker Washington' }).first();
    assert((await parker.locator('.draft').innerText()) === '...', 'draft placeholder before /draft returns');
    assert((await page.locator('.roster-source').innerText()) === 'ESPN depth chart');
    assert((await parker.locator('.badge-starter').innerText()) === 'Starter');
    await page.waitForTimeout(200);
    assert((await parker.locator('.draft').innerText()) === '...', 'draft stays on the placeholder while /draft is held');

    releaseDraft();
    await page.locator('.player', { hasText: 'Trevor Lawrence' }).locator('.draft', { hasText: 'Drafted 2021 · Rd 1, Pk 1' }).waitFor();
    const quinn = page.locator('.player', { hasText: 'Quinn Ewers' });
    await quinn.scrollIntoViewIfNeeded();
    assert((await quinn.locator('.draft').innerText()) === 'Undrafted');
    assert(await quinn.locator('.badge-starter').count() === 0, 'backup is not the starter');

    const uniqueIds = new Set(jaguars.sections.flatMap(section => section.positions.flatMap(position => position.players.map(player => player.id))).concat(jaguars.other.map(player => player.id)));
    const requestedDeadline = Date.now() + 3000;
    while (new Set(draftCalls.flat()).size < uniqueIds.size && Date.now() < requestedDeadline) {
      await page.waitForTimeout(50);
    }
    const requested = new Set(draftCalls.flat());
    assert(draftCalls.length === Math.ceil(uniqueIds.size / 40), `expected ${Math.ceil(uniqueIds.size / 40)} draft batches, got ${draftCalls.length}`);
    assert(requested.size === uniqueIds.size, 'every roster id was requested once');

    await parker.locator('.headshot-fallback', { hasText: 'PW' }).waitFor();
    assert(await parker.locator('img.headshot').count() === 0, 'broken headshot should fall back');

    const travon = page.locator('.player', { hasText: 'Travon Walker' }).first();
    await travon.scrollIntoViewIfNeeded();
    assert((await travon.locator('.draft').innerText()) === 'Drafted 2022 · Rd 1, Pk 1');
    assert(await travon.locator('.badge-starter').count() === 1);

    const brown = page.locator('.player', { hasText: 'Montaric Brown' });
    await brown.scrollIntoViewIfNeeded();
    assert((await brown.locator('.badge-injury').innerText()) === 'Questionable');
    const green = page.locator('.player', { hasText: 'B.J. Green II' });
    assert((await green.locator('.badge-injury').innerText()) === 'Injured Reserve');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nfl-draft-cache-v1')));
    assert(stored['4360310'].draft.year === 2021, 'draft cache stored Trevor Lawrence');
    assert(stored['4889929'].draft === null, 'undrafted cache stored null');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('.entry img')].slice(0, 8);
      await Promise.all(imgs.map(img => img.complete ? null : new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })));
    });
    await page.screenshot({ path: '/opt/cursor/artifacts/roster_tab_desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('tab', { name: 'Roster', selected: true }).waitFor();
    await page.screenshot({ path: '/opt/cursor/artifacts/roster_tab_mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });

    const other = page.locator('.other-roster');
    assert(await other.evaluate(el => el.open) === false, 'other roster starts collapsed');
    await other.locator('summary').click();
    await page.getByText("Cam'Ron Silmon-Craig").waitFor();
    await page.getByText('Nick Mullens').waitFor();
    const mullens = page.locator('.player', { hasText: 'Nick Mullens' });
    assert((await mullens.locator('.meta-chip').first().innerText()) === '#14');
    assert(await page.locator('.other-roster .badge-starter').count() === 0, 'other roster has no starters');

    await page.getByRole('button', { name: '↻ Refresh' }).click();
    await page.getByRole('status').getByText(/Updated/).waitFor();
    assert(await page.getByRole('tab', { name: 'Roster', selected: true }).count() === 1, 'refresh keeps the roster tab');
    assert(await page.locator('.player', { hasText: 'Trevor Lawrence' }).locator('.draft').innerText() === 'Drafted 2021 · Rd 1, Pk 1');
    assert(await page.locator('.other-roster').evaluate(el => el.open) === true, 'refresh keeps Other roster open');
    assert(await page.locator('.player', { hasText: 'Parker Washington' }).first().locator('img.headshot').count() === 0, 'headshot fallback survives refresh');
    await page.locator('.live-indicator').first().waitFor();

    await page.getByRole('tab', { name: 'Games' }).click();
    await page.getByText('COMPLETED REGULAR-SEASON GAMES').waitFor();
    await teamEntry(page, 'Jacksonville Jaguars').locator('.game', { hasText: 'Houston Texans' }).waitFor();
    assert(await page.getByText('ESPN depth chart').count() === 0);
    await jaguarsButton.click();
    assert(await page.getByRole('tab', { name: 'Games' }).count() === 0, 'collapsing hides the tabs');
    await jaguarsButton.click();
    await page.getByRole('tab', { name: 'Games', selected: true }).waitFor();

    const callsBeforeReload = draftCalls.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/Updated/).waitFor();
    await teamEntry(page, 'Jacksonville Jaguars').locator('button.team').click();
    await page.getByRole('tab', { name: 'Roster' }).click();
    await page.locator('.player', { hasText: 'Trevor Lawrence' }).locator('.draft', { hasText: 'Drafted 2021 · Rd 1, Pk 1' }).waitFor();
    assert(draftCalls.length === callsBeforeReload, 'localStorage should satisfy draft lookups after reload');
    await teamEntry(page, 'Jacksonville Jaguars').locator('button.team').click();

    const bills = teamEntry(page, 'Buffalo Bills');
    await bills.locator('button.team').click();
    await bills.getByRole('tab', { name: 'Roster' }).click();
    await bills.getByText('Could not load roster (HTTP 502).').waitFor();
    await bills.getByRole('tab', { name: 'Games' }).click();
    await bills.getByText('Miami Dolphins').waitFor();
    assert((await page.getByRole('status').innerText()).includes('Updated'), 'standings status survives a roster error');
    await bills.getByRole('tab', { name: 'Roster' }).click();
    await bills.getByText('Could not load roster (HTTP 502).').waitFor();
    billsFail = false;
    await bills.getByRole('button', { name: 'Retry' }).click();
    await bills.getByText('Josh Allen').waitFor();
    await bills.locator('.player', { hasText: 'Josh Allen' }).locator('.headshot-fallback', { hasText: 'JA' }).waitFor();

    const ravens = teamEntry(page, 'Baltimore Ravens');
    await ravens.locator('button.team').click();
    await ravens.getByRole('tab', { name: 'Roster' }).click();
    await ravens.getByText('Roster is unavailable for this team right now.').waitFor();
    await ravens.getByRole('tab', { name: 'Games' }).click();
    await ravens.getByText('No completed regular-season games yet.').waitFor();
    assert(await page.locator('.team').count() === 32, 'standings list remains after unavailable roster');

    draftEnabled = false;
    draftCalls.length = 0;
    await page.evaluate(() => localStorage.removeItem('nfl-draft-cache-v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/Updated/).waitFor();
    await teamEntry(page, 'Jacksonville Jaguars').locator('button.team').click();
    await page.getByRole('tab', { name: 'Roster' }).click();
    await page.locator('.draft', { hasText: 'Draft unavailable' }).first().waitFor();
    await page.getByText('Parker Washington').first().waitFor();
    await page.getByRole('tab', { name: 'Games' }).click();
    await teamEntry(page, 'Jacksonville Jaguars').locator('.game', { hasText: 'Houston Texans' }).waitFor();

    assert(pageErrors.length === 0, pageErrors.join('\n'));
    console.log('UI roster checks passed');
    console.log('screenshots: /opt/cursor/artifacts/roster_tab_desktop.png /opt/cursor/artifacts/roster_tab_mobile.png');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
