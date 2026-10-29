import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });

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

const state = {
  phase: 'normal',
  jax: 24,
  reorder: false,
  xss: false
};

function teamsPayload() {
  return {
    sports: [{ leagues: [{ teams: TEAMS.map(([id, name, abbr, slug]) => ({
      team: {
        id: String(id),
        displayName: state.xss && id === 1 ? '<img src=x onerror="window.__xss=1">' : name,
        abbreviation: abbr,
        logos: [{ href: `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png` }]
      }
    })) }] }]
  };
}

function competitor(id, name, abbr, homeAway, score) {
  return { id: String(id), homeAway, score: String(score), team: { displayName: name, abbreviation: abbr } };
}

function scoreboardFor(url, snapshot) {
  const params = new URL(url).searchParams;
  const type = params.get('seasontype');
  const week = params.get('week');
  if (snapshot.phase === 'badWeek' && type === '2' && week === '2') return { events: 'nope' };
  if (type === '2' && week === '1') {
    return { events: [{
      id: 'jax-hou',
      date: '2026-09-13T17:00:00Z',
      week: { number: 1 },
      season: { type: 2 },
      status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
      competitions: [{ competitors: [
        competitor(30, 'Jacksonville Jaguars', 'JAX', 'home', snapshot.jax),
        competitor(34, 'Houston Texans', 'HOU', 'away', 17)
      ] }]
    }] };
  }
  if (type === '2' && week === '2') {
    return { events: [{
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
    }] };
  }
  if (type === '2' && week === '3' && snapshot.reorder) {
    return { events: [{
      id: 'buf-nyj',
      date: '2026-09-27T17:00:00Z',
      week: { number: 3 },
      season: { type: 2 },
      status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
      competitions: [{ competitors: [
        competitor(2, 'Buffalo Bills', 'BUF', 'home', 40),
        competitor(20, 'New York Jets', 'NYJ', 'away', 0)
      ] }]
    }] };
  }
  if (type === '3' && week === '1') {
    return { events: [{
      id: 'jax-buf-wc',
      date: '2027-01-10T18:00:00Z',
      week: { number: 1 },
      season: { type: 3 },
      status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
      competitions: [{ competitors: [
        competitor(30, 'Jacksonville Jaguars', 'JAX', 'home', 27),
        competitor(2, 'Buffalo Bills', 'BUF', 'away', 20)
      ] }]
    }] };
  }
  return { events: [] };
}

const roster = {
  team: { id: '30', name: 'Jacksonville Jaguars', abbreviation: 'JAX' },
  source: 'ESPN depth chart',
  sections: [{
    name: 'Offense',
    positions: [{
      pos: 'QB',
      players: [{
        id: '4360310',
        name: 'Trevor <b>Lawrence</b>',
        jersey: '16',
        position: 'QB',
        height: '6\' 6"',
        weight: '220 lbs',
        age: 27,
        experience: 6,
        college: 'Clemson <img src=x>',
        headshot: null,
        injury: null,
        starter: true,
        draft: null
      }]
    }]
  }],
  other: []
};

const held = [];
let releaseHold = () => {};
function armHold() {
  held.length = 0;
  releaseHold = () => {
    const waiting = held.splice(0);
    for (const resolve of waiting) resolve();
  };
}

function contentType(path) {
  const ext = extname(path);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webmanifest') return 'application/manifest+json';
  return 'text/plain; charset=utf-8';
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      if (path.includes('..')) { res.writeHead(400); res.end(); return; }
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

async function refresh(page) {
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.getByRole('status').getByText(/^Updated/).waitFor();
}

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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
  await page.emulateMedia({ colorScheme: 'dark' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    window.__listeners = 0;
    window.__timers = 0;
    window.__delays = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
      window.__listeners += 1;
      return add.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (...args) {
      window.__listeners -= 1;
      return remove.apply(this, args);
    };
    const si = window.setInterval;
    const ci = window.clearInterval;
    window.setInterval = function (fn, delay, ...rest) {
      window.__timers += 1;
      window.__delays.push(delay);
      return si.call(this, fn, delay, ...rest);
    };
    window.clearInterval = function (id) {
      window.__timers -= 1;
      return ci.call(this, id);
    };
    const later = Date.now() + 86400000;
    localStorage.setItem('nfl-prefs-v1', JSON.stringify({
      theme: 'dark',
      autoRefresh: true,
      expanded: ['<svg/onload=alert(1)>'],
      tabs: { '<x>': 'roster' },
      otherOpen: { '<x>': true }
    }));
    localStorage.setItem('nfl-draft-cache-v1', JSON.stringify({
      '<img>': { draft: { year: 2020, round: 1, pick: 1 }, exp: later },
      '12': { draft: { year: '<img src=x>', round: 1, pick: 1 }, exp: later }
    }));
  });

  await page.route('**/nfl-live-data.josh-soudah.workers.dev/**', async route => {
    const url = route.request().url();
    const snapshot = { phase: state.phase, jax: state.phase === 'fresh' ? 41 : state.phase === 'hold' ? 10 : state.jax, reorder: state.reorder };
    try {
      if (snapshot.phase === 'hold') await new Promise(resolve => held.push(resolve));
      if (url.includes('/teams')) {
        if (snapshot.phase === 'hangTeams') await new Promise(resolve => setTimeout(resolve, 4000));
        if (snapshot.phase === 'teams500') {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
          return;
        }
        if (snapshot.phase === 'emptyTeams') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(teamsPayload()) });
        return;
      }
      if (url.includes('/scoreboard')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scoreboardFor(url, snapshot)) });
        return;
      }
      if (url.includes('/roster')) {
        const team = new URL(url).searchParams.get('team');
        if (team === '30') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roster) });
          return;
        }
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ unavailable: true }) });
        return;
      }
      if (url.includes('/draft')) {
        if (snapshot.phase === 'draftHold') await new Promise(resolve => held.push(resolve));
        const year = state.phase === 'draftStale' ? 1999 : 2021;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ '4360310': { year, round: year === 1999 ? 9 : 1, pick: year === 1999 ? 9 : 1 } })
        });
        return;
      }
      await route.abort('failed');
    } catch { /* request aborted by a newer refresh */ }
  });
  await page.route('**/a.espncdn.com/**', async route => {
    const slug = (route.request().url().match(/\/([a-z0-9]+)\.png/i) || [])[1] || 'nfl';
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="16" fill="#16324f"/><text x="40" y="48" text-anchor="middle" fill="#fff" font-size="22" font-family="sans-serif">${slug.slice(0, 3).toUpperCase()}</text></svg>`;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
  });

  const perf = {};
  try {
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${port}/?timeout=800`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    perf.loadMs = Date.now() - started;
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return {
        dcl: Math.round(entry.domContentLoadedEventEnd),
        load: Math.round(entry.loadEventEnd)
      };
    });
    perf.dcl = nav.dcl;
    perf.navLoad = nav.load;
    assert(await page.locator('.team').count() === 32, '32 teams');
    const clocks = await page.evaluate(() => window.__delays.filter(delay => delay === 15000).length);
    assert(clocks >= 1, 'auto-refresh is not every 15 seconds');
    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const atlanta = await page.locator('#team-1 .record').innerText();
    assert(atlanta === '0-0-0', atlanta);
    assert((await page.locator('#team-1 .sub').innerText()).includes('0.0%'), 'zero games percentage');
    const jag = page.locator('#team-30');
    assert((await jag.locator('.sub').innerText()).includes('PD +7'));
    await jag.locator('button.team').click();
    await jag.locator('.game', { hasText: 'Houston Texans' }).waitFor();
    assert(await jag.locator('.game .score-logo:not([hidden])').count() >= 2, 'score row is missing team icons');
    assert(await jag.locator('.completed-sec .result.W').count() === 1, 'regular-season result');
    await jag.getByText('PLAYOFF GAMES').waitFor();
    await jag.getByText('Wild Card').waitFor();
    assert(await jag.locator('.game', { hasText: 'Week' }).count() === 0);
    const completed = await jag.locator('.completed-sec .game').count();
    assert(completed === 1, `bye week invented a game, completed=${completed}`);
    await page.locator('#team-2 .live-indicator').waitFor();
    await jag.locator('button.team').click();

    const listenerBase = await page.evaluate(() => window.__listeners);
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => document.getElementById('refresh').click());
      await page.getByRole('status').getByText(/^Updated/).waitFor();
    }
    const listenerDelta = await page.evaluate(() => window.__listeners) - listenerBase;
    assert(listenerDelta < 8, `listeners grew by ${listenerDelta} across unchanged refreshes`);
    const timerNow = await page.evaluate(() => window.__timers);
    assert(timerNow === 0, `auto-refresh timers still running: ${timerNow}`);

    await page.evaluate(() => {
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      window.__setHidden = value => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
      };
      const box = document.getElementById('auto-refresh');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert(await page.evaluate(() => window.__timers) === 1, 'one refresh timer while visible');
    await page.evaluate(() => window.__setHidden(true));
    assert(await page.evaluate(() => window.__timers) === 0, 'timer keeps running while hidden');
    const liveLabel = await page.locator('#live-label').evaluate(el => el.textContent);
    assert(liveLabel === 'Paused', liveLabel);
    await page.evaluate(() => window.__setHidden(false));
    await page.getByRole('status').getByText(/^Updated|^Checking/).waitFor();
    assert(await page.evaluate(() => window.__timers) === 1, 'timer did not restart when shown');
    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    state.phase = 'hold';
    armHold();
    await page.evaluate(() => document.getElementById('refresh').click());
    await page.waitForTimeout(100);
    state.phase = 'fresh';
    const freshStarted = Date.now();
    await page.evaluate(() => document.getElementById('refresh').click());
    await page.locator('#team-30 .sub', { hasText: 'PD +24' }).waitFor();
    perf.refreshMs = Date.now() - freshStarted;
    releaseHold();
    await page.waitForTimeout(350);
    assert((await page.locator('#team-30 .sub').innerText()).includes('PD +24'), 'stale response overwrote the newer score');
    state.phase = 'normal';
    state.jax = 41;

    await page.locator('#team-30 button.team').click();
    const beforeMove = await page.evaluate(() => {
      const section = document.getElementById('team-30');
      const bills = document.getElementById('team-2');
      window.__jag = section;
      window.__jagLogo = section.querySelector('.team-logo');
      window.__billsLogo = bills.querySelector('.team-logo');
      return section.querySelector('button.team').getAttribute('aria-expanded');
    });
    assert(beforeMove === 'true');
    state.reorder = true;
    await refresh(page);
    const moved = await page.evaluate(() => {
      const section = document.getElementById('team-30');
      const bills = document.getElementById('team-2');
      return {
        section: section === window.__jag,
        jagLogo: section.querySelector('.team-logo') === window.__jagLogo,
        billsLogo: bills.querySelector('.team-logo') === window.__billsLogo,
        expanded: section.querySelector('button.team').getAttribute('aria-expanded'),
        jagRank: section.querySelector('.rank').textContent,
        first: document.querySelector('.entry').querySelector('.name').textContent
      };
    });
    assert(moved.section && moved.jagLogo && moved.billsLogo, 'rank change remounted a team or logo');
    assert(moved.expanded === 'true', 'expanded team closed when the order changed');
    assert(moved.first === 'Buffalo Bills', moved.first);
    assert(moved.jagRank === '2', moved.jagRank);
    state.reorder = false;

    state.phase = 'badWeek';
    await refresh(page);
    assert(await page.locator('#banner').isHidden(), 'a bad week hid the standings');
    assert((await page.locator('#status').innerText()).includes('1 week unavailable'));
    assert((await page.locator('#team-30 .sub').innerText()).includes('PD +24'));
    state.phase = 'normal';

    state.phase = 'teams500';
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.locator('#banner', { hasText: 'HTTP 500' }).waitFor();
    assert(await page.locator('.team').count() === 32, '500 cleared the board');
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, 'harden-desktop-dark-error');
    state.phase = 'normal';
    await refresh(page);
    assert(await page.locator('#banner').isHidden(), 'banner stuck after recovery');

    state.phase = 'emptyTeams';
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.locator('#banner', { hasText: '32' }).waitFor();
    assert(await page.locator('#team-30').count() === 1, 'empty payload removed the last good list');
    state.phase = 'normal';
    await refresh(page);

    state.phase = 'hangTeams';
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.locator('#banner', { hasText: /timed out/i }).waitFor({ timeout: 4000 });
    assert(await page.locator('#refresh').getAttribute('aria-busy') === null, 'refresh stayed busy after timeout');
    state.phase = 'normal';
    await refresh(page);

    state.xss = true;
    await refresh(page);
    const hostile = await page.locator('#team-1 .name').innerText();
    assert(hostile.includes('<img'), hostile);
    assert(await page.locator('img[src="x"]').count() === 0, 'API name was injected as HTML');
    assert(await page.evaluate(() => window.__xss) === undefined, 'name payload ran');
    state.xss = false;
    await refresh(page);

    await page.getByRole('button', { name: 'Refresh now' }).dblclick();
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    assert(await page.locator('.team').count() === 32, 'double-click duplicated or dropped teams');
    await page.waitForTimeout(200);
    assert(await page.locator('#refresh').getAttribute('aria-busy') === null, 'double-click left refresh busy');

    state.phase = 'draftHold';
    armHold();
    await page.locator('#team-30 button.team').click();
    if ((await page.locator('#team-30 button.team').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('#team-30 button.team').click();
    }
    await page.locator('#team-30').getByRole('tab', { name: 'Roster' }).click();
    await page.locator('#team-30 .draft', { hasText: '...' }).waitFor();
    state.phase = 'draftFresh';
    await page.evaluate(() => window.__nflTest.ensureRoster('30', { force: true }));
    await page.locator('#team-30 .draft', { hasText: 'Drafted 2021 · Rd 1, Pk 1' }).waitFor();
    assert(await page.locator('#team-30 .badge-starter').innerText() === 'Starter');
    assert((await page.locator('#team-30').innerText()).includes('Clemson <img src=x>'));
    assert(await page.locator('#team-30 img[src="x"]').count() === 0, 'roster text was injected');
    state.phase = 'draftStale';
    releaseHold();
    await page.waitForTimeout(300);
    assert((await page.locator('#team-30 .draft').innerText()).includes('2021'), 'stale draft overwrote the newer draft');
    state.phase = 'normal';

    await page.keyboard.press('Escape');
    await page.locator('#conference').focus();
    let sawOutline = false;
    let opened = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return {
          cls: String(el.className || ''),
          id: el.id || '',
          outline: style.outlineStyle,
          width: parseFloat(style.outlineWidth) || 0
        };
      });
      if (info.outline !== 'none' && info.width >= 1) sawOutline = true;
      if (info.cls.includes('team') && info.cls.includes('team')) {
        await page.keyboard.press('Enter');
        opened = true;
        break;
      }
    }
    assert(sawOutline, 'keyboard focus never showed an outline');
    assert(opened, 'could not reach a team button by keyboard');
    await page.locator('#team-30 button.team').focus();
    if ((await page.locator('#team-30 button.team').getAttribute('aria-expanded')) !== 'true') {
      await page.keyboard.press('Enter');
    }
    await page.locator('#team-30').getByRole('tab', { name: 'Games' }).focus();
    await page.keyboard.press('ArrowRight');
    assert((await page.locator('#team-30').getByRole('tab', { name: 'Roster' }).getAttribute('aria-selected')) === 'true', 'arrow key did not move to Roster');
    const tabbed = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
      const missing = [...document.querySelectorAll('[aria-controls]')].filter(el => !document.getElementById(el.getAttribute('aria-controls'))).map(el => el.id);
      return { dupes, missing };
    });
    assert(tabbed.dupes.length === 0, `duplicate ids ${tabbed.dupes.join(',')}`);
    assert(tabbed.missing.length === 0, `aria-controls missing ${tabbed.missing.join(',')}`);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('#settings').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert(await page.locator('#settings').isHidden());

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await page.evaluate(() => getComputedStyle(document.querySelector('.live-dot')).animationDuration);
    const motionSeconds = motion.endsWith('ms') ? parseFloat(motion) / 1000 : parseFloat(motion);
    assert(motionSeconds < 0.05, `reduced motion not applied (${motion})`);

    const contrast = await page.evaluate(() => {
      const rel = rgb => {
        const lin = value => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      };
      const parse = color => {
        const match = String(color).match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(',').map(part => parseFloat(part));
        return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
      };
      const surface = el => {
        let node = el;
        while (node) {
          const parsed = parse(getComputedStyle(node).backgroundColor);
          if (parsed && parsed.alpha >= 0.85) return parsed.rgb;
          node = node.parentElement;
        }
        return [7, 16, 28];
      };
      const failures = [];
      for (const selector of ['.name', '.sub', '#status', '#refresh', 'h1', '.section-title.playoff-title']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const fg = parse(getComputedStyle(el).color);
        if (!fg) continue;
        const ratio = (Math.max(rel(fg.rgb), rel(surface(el))) + 0.05) / (Math.min(rel(fg.rgb), rel(surface(el))) + 0.05);
        if (ratio < 4.5) failures.push(`${selector} ${ratio.toFixed(2)}`);
      }
      return failures;
    });
    assert(contrast.length === 0, `contrast below AA: ${contrast.join('; ')}`);

    const tiny = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a, input, select, summary')) {
        if (el.closest('[hidden], [inert]')) continue;
        const target = el.matches('input[type="checkbox"], input[type="radio"]') ? (el.closest('label') || el) : el;
        const box = target.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        if (box.width < 44 && box.height < 44) bad.push(`${el.id || el.className || el.tagName} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      return bad;
    });
    assert(tiny.length === 0, `tap targets under 44px: ${tiny.join('; ')}`);

    async function prepare(theme, width, mode) {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
      if (theme === 'light') await page.evaluate(() => { if (document.documentElement.dataset.theme !== 'light') document.getElementById('theme-toggle').click(); });
      if (theme === 'dark') await page.evaluate(() => { if (document.documentElement.dataset.theme !== 'dark') document.getElementById('theme-toggle').click(); });
      await page.setViewportSize({ width, height: width < 400 ? 780 : 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('#conference').selectOption('all');
      await page.locator('#division').selectOption('all');
      if ((await page.locator('#live-only').getAttribute('aria-pressed')) === 'true') {
        await page.locator('#live-only').click();
      }
      const jagButton = page.locator('#team-30 button.team');
      const expanded = await jagButton.getAttribute('aria-expanded');
      if (mode === 'collapsed' && expanded === 'true') await jagButton.click();
      if (mode !== 'collapsed' && expanded !== 'true') await jagButton.click();
      if (mode === 'roster') await page.locator('#team-30').getByRole('tab', { name: 'Roster' }).click();
      if (mode === 'games') await page.locator('#team-30').getByRole('tab', { name: 'Games' }).click();
      if (mode === 'empty') {
        await page.locator('#conference').selectOption('NFC');
        await page.locator('#live-only').click();
        await page.locator('#empty', { hasText: 'No teams match those filters.' }).waitFor();
      }
      if (mode === 'error') {
        state.phase = 'teams500';
        await page.getByRole('button', { name: 'Refresh now' }).click();
        await page.locator('#banner').waitFor();
        state.phase = 'normal';
      } else if (await page.locator('#banner').isVisible()) {
        await refresh(page);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const extra = await overflow(page);
      assert(extra <= 1, `${theme} ${width} ${mode} overflow ${extra}`);
      await shot(page, `harden-${width}-${theme}-${mode}`);
    }

    for (const theme of ['dark', 'light']) {
      for (const width of [1280, 360]) {
        for (const mode of ['collapsed', 'expanded', 'roster', 'empty', 'error']) {
          const label = mode === 'expanded' ? 'games' : mode;
          await prepare(theme, width, label === 'games' ? 'games' : mode);
        }
      }
    }

    assert(pageErrors.length === 0, pageErrors.join('\n'));
    console.log('UI harden checks passed');
    console.log(JSON.stringify(perf));
    await import('node:fs').then(fs => fs.writeFileSync(`${shots}/perf.json`, JSON.stringify(perf, null, 2)));
  } finally {
    releaseHold();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
