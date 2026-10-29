import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHandler } from '../../worker/worker.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const rawStats = JSON.parse(readFileSync(join(root, 'test/fixtures/stats30.json'), 'utf8'));
const statsHandler = createHandler({
  fetch: async () => Response.json(rawStats),
  cache: { async match() { return undefined; }, async put() {} }
});

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

async function tabMetrics(page, teamId) {
  return page.evaluate(id => {
    const list = document.querySelector(`#team-${id} .tabs`);
    const tabs = [...list.querySelectorAll('.tab')];
    const listBox = list.getBoundingClientRect();
    const boxes = tabs.map(tab => tab.getBoundingClientRect());
    const center = (boxes[0].left + boxes[boxes.length - 1].right) / 2;
    const listCenter = (listBox.left + listBox.right) / 2;
    return {
      labels: tabs.map(tab => tab.textContent),
      delta: Math.abs(center - listCenter),
      widths: boxes.map(box => Math.round(box.width * 10) / 10),
      heights: boxes.map(box => Math.round(box.height)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, teamId);
}

function assertTabsCentered(metrics, label) {
  assert(metrics.labels.join('|') === 'Games|Roster|Stats', `${label} labels ${metrics.labels.join('|')}`);
  assert(metrics.delta < 2, `${label} tabs off center by ${metrics.delta}`);
  const widthGap = Math.max(...metrics.widths) - Math.min(...metrics.widths);
  assert(widthGap <= 1, `${label} tab widths ${metrics.widths.join(',')}`);
  assert(metrics.heights.every(height => height >= 44), `${label} tab heights ${metrics.heights.join(',')}`);
  assert(metrics.overflow <= 1, `${label} horizontal overflow ${metrics.overflow}`);
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
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  const statsCalls = [];
  let houFail = true;

  await page.route('**/nfl-live-data.josh-soudah.workers.dev/**', async route => {
    const url = route.request().url();
    if (url.includes('/teams')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(teamsPayload) });
      return;
    }
    if (url.includes('/scoreboard')) {
      const params = new URL(url).searchParams;
      const body = params.get('seasontype') === '2' && params.get('week') === '1' ? weekOne : { events: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    if (url.includes('/roster')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ unavailable: true }) });
      return;
    }
    if (url.includes('/draft')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.includes('/stats')) {
      const team = new URL(url).searchParams.get('team');
      statsCalls.push(team);
      if (team === '30') {
        const response = await statsHandler(new Request(url));
        await route.fulfill({
          status: response.status,
          contentType: 'application/json',
          body: await response.text()
        });
        return;
      }
      if (team === '2') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'NFL Data API is running', endpoints: ['/teams', '/scoreboard', '/standings', '/roster', '/draft'] })
        });
        return;
      }
      if (team === '33') {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'not-json' });
        return;
      }
      if (team === '34') {
        if (houFail) {
          await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to retrieve ESPN data' }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            team: { id: '34', name: 'Houston Texans', abbreviation: 'HOU' },
            gamesPlayed: 4,
            offense: [{ key: 'pointsPerGame', label: 'Points per game', display: null }],
            defense: [{ key: 'sacks', label: 'Sacks', display: '9', rank: 4 }]
          })
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ unavailable: true }) });
      return;
    }
    await route.abort('failed');
  });
  await page.route('**/a.espncdn.com/**', async route => {
    const slug = (route.request().url().match(/\/([a-z0-9]+)\.png/i) || [])[1] || 'nfl';
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="12" fill="#013369"/><text x="40" y="48" text-anchor="middle" fill="#fff" font-size="18" font-family="sans-serif">${slug.slice(0, 3).toUpperCase()}</text></svg>`;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert(await page.locator('#search').count() === 0, 'search box still exists');
    assert(await page.locator('button.fav, .mine').count() === 0, 'favorite control still exists');
    assert((await page.locator('h1').innerText()) === 'STANDINGS');
    assert((await page.locator('footer').innerText()).includes('not affiliated with the NFL'));

    const jag = teamEntry(page, 'Jacksonville Jaguars');
    await jag.locator('button.team').click();
    await jag.getByRole('tab', { name: 'Games', selected: true }).waitFor();
    await jag.getByRole('tab', { name: 'Roster' }).click();
    await jag.getByText('Roster is unavailable').waitFor();
    assert(statsCalls.length === 0, `stats loaded before the Stats tab (${statsCalls.join(',')})`);
    assert(await page.locator('.stats-root').count() === 0, 'stats markup is in the document on the Roster tab');

    await jag.getByRole('tab', { name: 'Stats' }).click();
    await jag.getByText('Points per game').waitFor();
    assert(statsCalls.length === 1 && statsCalls[0] === '30', `expected one lazy stats fetch, got ${statsCalls.join(',')}`);
    const callsAfter = statsCalls.length;
    await jag.getByRole('tab', { name: 'Games' }).click();
    await jag.getByText('Houston Texans').waitFor();
    assert(await page.locator('.stats-root').count() === 0, 'stats markup stays in the document on the Games tab');
    await jag.getByRole('tab', { name: 'Stats' }).click();
    await jag.getByText('25.7').waitFor();
    assert(statsCalls.length === callsAfter, 'returning to Stats fetched again');

    const tile = label => jag.locator('.stat-tile', { has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) });
    assert((await tile('Points per game').locator('.stat-value').innerText()) === '25.7');
    assert(await tile('Points per game').locator('.stat-note').isHidden(), 'ESPN per-game value was labeled as computed');
    assert(await tile('Points per game').locator('.rank-badge').isHidden(), 'offense tile showed a rank ESPN did not send');
    assert((await tile('Passing yards per game').locator('.stat-value').innerText()) === '246.7');
    assert((await tile('Completion %').locator('.stat-value').innerText()) === '65.2');
    assert((await tile('Third down %').locator('.stat-value').innerText()) === '47.95');
    assert((await tile('Sacks taken').locator('.stat-value').innerText()) === '10');
    assert((await tile('Points allowed per game').locator('.stat-value').innerText()) === '17.3');
    assert((await tile('Points allowed per game').locator('.rank-badge').innerText()) === '#3');
    assert((await tile('Yards allowed per game').locator('.rank-badge').innerText()) === '#18');
    assert((await tile('Sacks').locator('.stat-value').innerText()) === '11');
    assert(await tile('Sacks').locator('.rank-badge').isHidden(), 'sacks showed a rank ESPN did not send');
    const metaText = (await jag.locator('.stats-meta').innerText()).toLowerCase();
    assert(metaText.includes('6 games played'), `meta text: ${JSON.stringify(metaText)}`);
    assertTabsCentered(await tabMetrics(page, '30'), '1280 dark');

    const listBox = await page.locator('#list').boundingBox();
    await page.evaluate(() => {
      window.__entries = [...document.querySelectorAll('.entry')];
      window.__tiles = [...document.querySelectorAll('#team-30 .stat-tile')];
      window.__value = document.querySelector('#team-30 .stat-value');
      window.__cls = 0;
      window.__clsSupported = PerformanceObserver.supportedEntryTypes.includes('layout-shift');
      if (!window.__clsSupported) return;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: false });
    });
    await page.evaluate(() => document.getElementById('refresh').click());
    await page.getByRole('status').getByText(/^Updated/).waitFor();
    const same = await page.evaluate(() => {
      const entries = [...document.querySelectorAll('.entry')];
      const tiles = [...document.querySelectorAll('#team-30 .stat-tile')];
      return {
        entries: entries.length === window.__entries.length && entries.every((el, index) => el === window.__entries[index]),
        tiles: tiles.length > 0 && tiles.every((el, index) => el === window.__tiles[index]),
        value: document.querySelector('#team-30 .stat-value') === window.__value,
        cls: window.__cls,
        clsSupported: window.__clsSupported
      };
    });
    assert(same.entries, 'unchanged refresh replaced team nodes');
    assert(same.tiles, 'unchanged refresh replaced stat tiles');
    assert(same.value, 'unchanged refresh replaced a stat value node');
    const listBoxAfter = await page.locator('#list').boundingBox();
    assert(Math.abs(listBox.y - listBoxAfter.y) <= 1, `list shifted from ${listBox.y} to ${listBoxAfter.y}`);
    assert(Math.abs(listBox.height - listBoxAfter.height) <= 1, `list height changed by ${listBoxAfter.height - listBox.height}`);
    if (same.clsSupported) assert(same.cls < 0.02, `layout shift ${same.cls}`);

    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#live-label', { hasText: 'Live' }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${shots}/stats-1280-dark.png` });

    await page.setViewportSize({ width: 360, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assertTabsCentered(await tabMetrics(page, '30'), '360 dark');
    await page.screenshot({ path: `${shots}/stats-360-dark.png` });

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    assertTabsCentered(await tabMetrics(page, '30'), '360 light');
    await page.screenshot({ path: `${shots}/stats-360-light.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assertTabsCentered(await tabMetrics(page, '30'), '1280 light');
    await page.screenshot({ path: `${shots}/stats-1280-light.png` });
    await page.evaluate(() => {
      const box = document.getElementById('auto-refresh');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const bills = teamEntry(page, 'Buffalo Bills');
    await bills.locator('button.team').click();
    await bills.getByRole('tab', { name: 'Stats' }).click();
    await bills.getByText('Stats are not available yet.').waitFor();
    assert(await bills.locator('.stat-tile').count() === 0, 'old JSON rendered stat tiles');

    const ravens = teamEntry(page, 'Baltimore Ravens');
    await ravens.locator('button.team').click();
    await ravens.getByRole('tab', { name: 'Stats' }).click();
    await ravens.getByText('Stats are not available yet.').waitFor();

    const texans = teamEntry(page, 'Houston Texans');
    await texans.locator('button.team').click();
    await texans.getByRole('tab', { name: 'Stats' }).click();
    await texans.getByText('Could not load stats (HTTP 502).').waitFor();
    houFail = false;
    await texans.getByRole('button', { name: 'Retry' }).click();
    await texans.getByText('n/a').waitFor();
    assert((await texans.locator('.stat-tile', { hasText: 'Sacks' }).locator('.rank-badge').innerText()) === '#4');
    assert((await page.locator('#status').innerText()).includes('Updated'), 'a stats error cleared the standings');

    assert(pageErrors.length === 0, pageErrors.join('\n'));
    console.log('UI stats checks passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
