import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = '/opt/cursor/artifacts';

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

let jaxScore = 24;
const weekOne = () => ({
  events: [{
    id: 'jax-hou',
    date: '2026-09-13T17:00:00Z',
    week: { number: 1 },
    season: { type: 2 },
    status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitions: [{ competitors: [
      competitor(30, 'Jacksonville Jaguars', 'JAX', 'home', jaxScore),
      competitor(34, 'Houston Texans', 'HOU', 'away', 17)
    ] }]
  }]
});

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
  if (params.get('seasontype') === '2' && params.get('week') === '1') return weekOne();
  if (params.get('seasontype') === '2' && params.get('week') === '2') return weekTwo;
  return { events: [] };
}

const jaguarsRoster = {
  team: { id: '30', name: 'Jacksonville Jaguars', abbreviation: 'JAX' },
  source: 'ESPN depth chart',
  sections: [{
    name: 'Offense',
    positions: [{
      pos: 'QB',
      players: [{
        id: '4360310',
        name: 'Trevor Lawrence',
        jersey: '16',
        position: 'QB',
        height: '6\' 6"',
        weight: '220 lbs',
        age: 27,
        experience: 6,
        college: 'Clemson',
        headshot: null,
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

async function refresh(page, { quiet = false } = {}) {
  if (quiet) {
    await page.evaluate(() => {
      document.getElementById('refresh').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  } else {
    await page.getByRole('button', { name: 'Refresh now' }).click();
  }
  await page.getByRole('status').getByText(/^Updated/).waitFor();
}

async function visibleTeams(page) {
  return page.evaluate(() => [...document.querySelectorAll('.entry')].filter(el => !el.hidden).map(el => el.querySelector('.name').textContent));
}

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png` });
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
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jaguarsRoster) });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ unavailable: true }) });
      return;
    }
    if (url.includes('/draft')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ '4360310': { year: 2021, round: 1, pick: 1 } })
      });
      return;
    }
    await route.abort('failed');
  });
  await page.route('**/a.espncdn.com/**', async route => {
    const slug = (route.request().url().match(/\/([a-z0-9]+)\.png/i) || [])[1] || 'nfl';
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="16" fill="#16324f"/><text x="40" y="48" text-anchor="middle" fill="#fff" font-size="22" font-family="sans-serif">${slug.slice(0, 3).toUpperCase()}</text></svg>`;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    assert(await page.locator('.team').count() === 32, 'expected 32 teams');
    assert((await page.locator('.entry').first().innerText()).includes('Jacksonville Jaguars'), 'win percentage still ranks Jacksonville first');
    await teamEntry(page, 'Buffalo Bills').locator('.live-indicator').waitFor();
    await page.locator('.live-chip').first().waitFor();
    await page.locator('.skeleton').waitFor({ state: 'detached' });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `desktop overflow ${overflow}`);
    await shot(page, 'standings-desktop-dark');

    const before = await page.evaluate(() => {
      const entries = [...document.querySelectorAll('.entry')];
      const jag = entries.find(el => el.querySelector('.name').textContent === 'Jacksonville Jaguars');
      const atl = entries.find(el => el.querySelector('.name').textContent === 'Atlanta Falcons');
      window.__nodes = entries;
      window.__logos = entries.map(el => el.querySelector('.team-logo'));
      window.__atlRecord = atl.querySelector('.record');
      window.__jagLogo = jag.querySelector('.team-logo');
      window.__jagSub = jag.querySelector('.sub');
      return {
        count: entries.length,
        atl: window.__atlRecord.textContent,
        sub: window.__jagSub.textContent
      };
    });
    assert(before.sub.includes('PD +7'), before.sub);
    await page.evaluate(() => document.querySelector('#list .entry:last-child').scrollIntoView());
    await page.evaluate(() => {
      window.__focus = document.querySelector('#team-9 button.team');
      window.__focus.focus({ preventScroll: true });
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    assert(scrollBefore > 80, `expected to be scrolled, y=${scrollBefore}`);
    const listBox = await page.locator('#list').boundingBox();

    await page.evaluate(() => {
      window.__cls = 0;
      window.__clsSupported = PerformanceObserver.supportedEntryTypes.includes('layout-shift');
      if (!window.__clsSupported) return;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: false });
    });
    await refresh(page, { quiet: true });
    const same = await page.evaluate(() => {
      const entries = [...document.querySelectorAll('.entry')];
      return {
        nodes: entries.every((el, i) => el === window.__nodes[i]),
        logos: entries.every((el, i) => el.querySelector('.team-logo') === window.__logos[i]),
        focus: document.activeElement === window.__focus,
        scroll: window.scrollY,
        cls: window.__cls,
        clsSupported: window.__clsSupported,
        atl: window.__atlRecord.textContent,
        atlNode: document.querySelector('#team-1 .record') === window.__atlRecord
      };
    });
    assert(same.nodes, 'unchanged refresh replaced team nodes');
    assert(same.logos, 'unchanged refresh replaced team logos');
    assert(same.focus, 'unchanged refresh moved focus');
    assert(Math.abs(same.scroll - scrollBefore) <= 2, `scroll moved from ${scrollBefore} to ${same.scroll}`);
    assert(same.atlNode && same.atl === before.atl, 'untouched record node changed');
    const listBoxAfter = await page.locator('#list').boundingBox();
    assert(Math.abs(listBox.y - listBoxAfter.y) <= 1, `list shifted from ${listBox.y} to ${listBoxAfter.y}`);
    assert(Math.abs(listBox.height - listBoxAfter.height) <= 1, `list height changed by ${listBoxAfter.height - listBox.height}`);
    if (same.clsSupported) assert(same.cls < 0.02, `layout shift ${same.cls}`);

    await page.evaluate(() => window.scrollTo(0, 0));
    const jag = teamEntry(page, 'Jacksonville Jaguars');
    await jag.locator('button.team').click();
    await jag.getByRole('tab', { name: 'Games', selected: true }).waitFor();
    await jag.locator('.game', { hasText: 'Houston Texans' }).waitFor();
    await jag.locator('.result.W').waitFor();
    const openState = await page.evaluate(() => {
      const section = document.getElementById('team-30');
      const pts = section.querySelector('.game .my-pts');
      window.__section = section;
      window.__pts = pts;
      window.__logo = section.querySelector('.team-logo');
      return { expanded: section.querySelector('button.team').getAttribute('aria-expanded'), pts: pts.textContent };
    });
    assert(openState.expanded === 'true', 'team should expand');
    assert(openState.pts === '24', openState.pts);

    await jag.getByRole('tab', { name: 'Roster' }).click();
    await jag.getByText('Trevor Lawrence').waitFor();
    await jag.locator('.badge-starter', { hasText: 'Starter' }).waitFor();
    await jag.getByText('Clemson').waitFor();
    await jag.locator('.draft', { hasText: 'Drafted 2021 · Rd 1, Pk 1' }).waitFor();
    await jag.locator('.headshot-fallback', { hasText: 'TL' }).waitFor();
    await shot(page, 'standings-desktop-dark-roster');
    await jag.getByRole('tab', { name: 'Games' }).click();
    assert(await page.getByText('ESPN depth chart').count() === 0, 'roster markup leaves the document on the Games tab');

    jaxScore = 31;
    await refresh(page);
    const changed = await page.evaluate(() => {
      const section = document.getElementById('team-30');
      return {
        section: section === window.__section,
        logo: section.querySelector('.team-logo') === window.__logo,
        ptsNode: section.querySelector('.game .my-pts') === window.__pts,
        pts: window.__pts.textContent,
        expanded: section.querySelector('button.team').getAttribute('aria-expanded'),
        sub: section.querySelector('.sub').textContent,
        atl: document.querySelector('#team-1 .record') === window.__atlRecord,
        atlText: window.__atlRecord.textContent
      };
    });
    assert(changed.section, 'changed refresh replaced the team section');
    assert(changed.logo, 'changed refresh replaced the team logo');
    assert(changed.ptsNode, 'changed refresh replaced the score node');
    assert(changed.pts === '31', changed.pts);
    assert(changed.expanded === 'true', 'refresh closed the open team');
    assert(changed.sub.includes('PD +14'), changed.sub);
    assert(changed.atl && changed.atlText === before.atl, 'unchanged team record was rewritten');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'standings-desktop-dark-expanded');

    await page.locator('#conference').selectOption('NFC');
    await page.locator('#filter-status', { hasText: 'Showing 16 of 32' }).waitFor();
    await page.locator('#conference').selectOption('all');
    await page.locator('#division').selectOption('AFC East');
    const east = await visibleTeams(page);
    assert(east.length === 4, `AFC East showed ${east.join(', ')}`);
    for (const name of ['Buffalo Bills', 'Miami Dolphins', 'New England Patriots', 'New York Jets']) {
      assert(east.includes(name), name);
    }
    await page.locator('#division').selectOption('all');
    await page.locator('#live-only').click();
    const live = await visibleTeams(page);
    assert(live.length === 2 && live.includes('Buffalo Bills') && live.includes('Miami Dolphins'), `live filter ${live.join(', ')}`);
    await page.locator('#live-only').click();
    assert((await visibleTeams(page)).length === 32, 'clearing live filter restores every team');
    assert(await page.locator('#search').count() === 0, 'team search should be gone');
    assert(await page.locator('button.fav').count() === 0, 'favorite pin should be gone');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nfl-prefs-v1') || '{}'));
    assert(stored.favoriteId == null, 'favorite id should not be stored');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#team-30 button.team').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#team-30 button.team').getAttribute('aria-expanded') === 'false', 'Enter should collapse');
    await page.keyboard.press('Space');
    assert(await page.locator('#team-30 button.team').getAttribute('aria-expanded') === 'true', 'Space should expand');
    const focusRing = await page.evaluate(() => {
      const css = [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
      }).join('\n');
      return css.includes(':focus-visible') && css.includes('outline');
    });
    assert(focusRing, 'keyboard focus ring is missing');

    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('#auto-refresh').uncheck();
    await page.getByRole('button', { name: 'Close' }).click();
    const paused = await page.evaluate(() => ({
      auto: JSON.parse(localStorage.getItem('nfl-prefs-v1')).autoRefresh,
      label: document.querySelector('#live-label').textContent
    }));
    assert(paused.auto === false, 'auto-refresh should persist off');
    assert(paused.label === 'Paused', paused.label);
    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
    await shot(page, 'standings-desktop-light');

    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(mobileOverflow <= 1, `light mobile overflow ${mobileOverflow}`);
    await shot(page, 'standings-mobile-light');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const darkMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(darkMobileOverflow <= 1, `dark mobile overflow ${darkMobileOverflow}`);
    await shot(page, 'standings-mobile-dark');

    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('nfl-prefs-v1')));
    assert(prefs.theme === 'dark', prefs.theme);
    assert(prefs.expanded.includes('30'), 'expanded team should be remembered');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    assert(await page.locator('#team-30 button.team').getAttribute('aria-expanded') === 'true', 'expanded team should survive reload');
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');

    assert(pageErrors.length === 0, pageErrors.join('\n'));
    console.log('UI polish checks passed');
    console.log(`layout-shift supported: ${same.clsSupported} value: ${same.cls}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
