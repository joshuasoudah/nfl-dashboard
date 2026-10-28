import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('standings updates patch nodes instead of replacing the list', () => {
  assert.equal(app.includes('list.innerHTML'), false);
  assert.match(app, /lastPayloadJson/);
  assert.match(app, /function safe\(/);
  assert.match(app, /textContent/);
});

test('service worker is network-first and never touches the data API', () => {
  assert.match(sw, /network-first/i);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.equal(sw.includes('workers.dev'), false);
  assert.equal(sw.includes('/scoreboard'), false);
  assert.equal(sw.includes('/roster'), false);
});

test('page keeps the manifest, favicon, and saved preferences', () => {
  assert.match(html, /rel="manifest"/);
  assert.match(html, /data:image\/svg\+xml/);
  assert.match(html, /styles\.css/);
  assert.match(html, /app\.js/);
  assert.match(app, /nfl-prefs-v1/);
  assert.match(app, /prefers-color-scheme/);
  assert.match(app, /prefers-reduced-motion/);
});

test('palette covers all 32 team ids', () => {
  const ids = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','33','34'];
  for (const id of ids) assert.match(app, new RegExp(`['"]${id}['"]:\\s*\\{`));
});
