import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const prefix = '/nfl-dashboard';
let build = '1';
let apiHits = 0;

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
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404);
        res.end('outside project path');
        return;
      }
      let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || '/';
      if (rel === '/') rel = '/index.html';
      if (rel.includes('..')) { res.writeHead(400); res.end(); return; }
      try {
        let body = readFileSync(join(root, rel));
        if (rel === '/index.html') {
          body = Buffer.from(body.toString('utf8').replace('<body>', `<body data-build="${build}">`));
        }
        res.writeHead(200, {
          'Content-Type': contentType(rel),
          'Cache-Control': 'public, max-age=86400'
        });
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

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('pageerror', error));
  await page.route('**/nfl-live-data.josh-soudah.workers.dev/**', async route => {
    apiHits += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' });
  });
  try {
    await page.goto(`http://127.0.0.1:${port}${prefix}/`, { waitUntil: 'domcontentloaded' });
    assert((await page.locator('body').getAttribute('data-build')) === '1', 'first html');
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/nfl-dashboard/sw.js', { updateViaCache: 'none' });
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
      return registration.scope;
    });
    assert(scope.endsWith('/nfl-dashboard/'), scope);
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const data = await (await fetch(href)).json();
      const icon = new URL(data.icons[0].src, href);
      const iconStatus = (await fetch(icon)).status;
      return {
        start: new URL(data.start_url, href).pathname,
        scope: new URL(data.scope, href).pathname,
        icon: icon.pathname,
        iconStatus
      };
    });
    assert(manifest.start === '/nfl-dashboard/' || manifest.start === '/nfl-dashboard/index.html', manifest.start);
    assert(manifest.scope === '/nfl-dashboard/', manifest.scope);
    assert(manifest.icon === '/nfl-dashboard/icon.svg', manifest.icon);
    assert(manifest.iconStatus === 200, 'icon path failed');

    await page.reload({ waitUntil: 'domcontentloaded' });
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker is not controlling the page');
    build = '2';
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert((await page.locator('body').getAttribute('data-build')) === '2', 'reload still showed the cached index.html');

    const cached = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    assert(cached.some(url => url.includes('/nfl-dashboard/')), `shell was not cached: ${cached.join(', ')}`);
    assert(!cached.some(url => url.includes('workers.dev')), `API response was cached: ${cached.join(', ')}`);
    assert(apiHits > 0, 'cross-origin API was swallowed by the service worker');

    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert((await page.locator('body').getAttribute('data-build')) === '2', 'offline fallback missed the last good shell');
    await page.context().setOffline(false);
    build = '3';
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert((await page.locator('body').getAttribute('data-build')) === '3', 'coming back online kept the offline copy');
    console.log('service worker checks passed');
    console.log(`api hits while controlled: ${apiHits}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
