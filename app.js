const BASE = 'https://nfl-live-data.josh-soudah.workers.dev';
const PREFS_KEY = 'nfl-prefs-v1';
const DRAFT_BATCH = 40;
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DRAFT_LS_KEY = 'nfl-draft-cache-v1';

/* Built-in conference, division, and colors for all 32 clubs. ESPN's team
   payload wins for color when it includes one; this map covers filters and
   the accent when the feed omits them. */
const TEAM_INFO = {
  '1': { conference: 'NFC', division: 'South', color: '#a71930', alt: '#000000', city: 'Atlanta' },
  '2': { conference: 'AFC', division: 'East', color: '#00338d', alt: '#c60c30', city: 'Buffalo' },
  '3': { conference: 'NFC', division: 'North', color: '#0b162a', alt: '#c83803', city: 'Chicago' },
  '4': { conference: 'AFC', division: 'North', color: '#fb4f14', alt: '#000000', city: 'Cincinnati' },
  '5': { conference: 'AFC', division: 'North', color: '#ff3c00', alt: '#311d00', city: 'Cleveland' },
  '6': { conference: 'NFC', division: 'East', color: '#041e42', alt: '#869397', city: 'Dallas' },
  '7': { conference: 'AFC', division: 'West', color: '#fb4f14', alt: '#002244', city: 'Denver' },
  '8': { conference: 'NFC', division: 'North', color: '#0076b6', alt: '#b0b7bc', city: 'Detroit' },
  '9': { conference: 'NFC', division: 'North', color: '#203731', alt: '#ffb612', city: 'Green Bay' },
  '10': { conference: 'AFC', division: 'South', color: '#4b92db', alt: '#0c2340', city: 'Tennessee' },
  '11': { conference: 'AFC', division: 'South', color: '#002c5f', alt: '#a2aaad', city: 'Indianapolis' },
  '12': { conference: 'AFC', division: 'West', color: '#e31837', alt: '#ffb81c', city: 'Kansas City' },
  '13': { conference: 'AFC', division: 'West', color: '#a5acaf', alt: '#000000', city: 'Las Vegas' },
  '14': { conference: 'NFC', division: 'West', color: '#003594', alt: '#ffa300', city: 'Los Angeles' },
  '15': { conference: 'AFC', division: 'East', color: '#008e97', alt: '#fc4c02', city: 'Miami' },
  '16': { conference: 'NFC', division: 'North', color: '#4f2683', alt: '#ffc62f', city: 'Minnesota' },
  '17': { conference: 'AFC', division: 'East', color: '#002244', alt: '#c60c30', city: 'New England' },
  '18': { conference: 'NFC', division: 'South', color: '#d3bc8d', alt: '#101820', city: 'New Orleans' },
  '19': { conference: 'NFC', division: 'East', color: '#0b2265', alt: '#a71930', city: 'New York' },
  '20': { conference: 'AFC', division: 'East', color: '#125740', alt: '#000000', city: 'New York' },
  '21': { conference: 'NFC', division: 'East', color: '#004c54', alt: '#a5acaf', city: 'Philadelphia' },
  '22': { conference: 'NFC', division: 'West', color: '#97233f', alt: '#000000', city: 'Arizona' },
  '23': { conference: 'AFC', division: 'North', color: '#ffb612', alt: '#101820', city: 'Pittsburgh' },
  '24': { conference: 'AFC', division: 'West', color: '#0080c6', alt: '#ffc20e', city: 'Los Angeles' },
  '25': { conference: 'NFC', division: 'West', color: '#aa0000', alt: '#b3995d', city: 'San Francisco' },
  '26': { conference: 'NFC', division: 'West', color: '#69be28', alt: '#002244', city: 'Seattle' },
  '27': { conference: 'NFC', division: 'South', color: '#d50a0a', alt: '#ff7900', city: 'Tampa Bay' },
  '28': { conference: 'NFC', division: 'East', color: '#ffb612', alt: '#5a1414', city: 'Washington' },
  '29': { conference: 'NFC', division: 'South', color: '#0085ca', alt: '#101820', city: 'Carolina' },
  '30': { conference: 'AFC', division: 'South', color: '#006778', alt: '#d7a22a', city: 'Jacksonville' },
  '33': { conference: 'AFC', division: 'North', color: '#241773', alt: '#9e7c0c', city: 'Baltimore' },
  '34': { conference: 'AFC', division: 'South', color: '#a71930', alt: '#03202f', city: 'Houston' }
};

const list = document.querySelector('#list');
const statusEl = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
const banner = document.querySelector('#banner');
const empty = document.querySelector('#empty');
const search = document.querySelector('#search');
const conferenceSelect = document.querySelector('#conference');
const divisionSelect = document.querySelector('#division');
const liveOnlyBtn = document.querySelector('#live-only');
const liveStrip = document.querySelector('#live-strip');
const filterStatus = document.querySelector('#filter-status');
const filterLive = document.querySelector('#filter-live');
const scoreLive = document.querySelector('#score-live');
const themeToggle = document.querySelector('#theme-toggle');
const settingsDialog = document.querySelector('#settings');
const liveDot = document.querySelector('#live-dot');
const liveLabel = document.querySelector('#live-label');
const autoRefreshInput = document.querySelector('#auto-refresh');
const themeInputs = [...document.querySelectorAll('input[name="theme"]')];

const prefs = { theme: 'system', autoRefresh: true, favoriteId: null, expanded: [], tabs: {}, otherOpen: {} };
let busy = false;
let timer = 0;
let booted = false;
let lastSuccess = null;
let lastFailures = 0;
let lastGameCount = 0;
let lastHash = '';
let lastPayloadJson = '';
let filterAnnounce = 0;
let currentTeams = [];
const expanded = new Set();
const panelState = new Map();
const rosters = new Map();
const rosterSeq = new Map();
const parked = new Map();
const headshotFailed = new Set();
const logoFailed = new Set();
const draftMem = new Map();
const draftPending = new Set();
const draftFailed = new Set();

function year() {
  const date = new Date();
  const y = date.getFullYear();
  return date.getMonth() < 2 ? y - 1 : y;
}
const season = year();
document.querySelector('#season').textContent = `${season} Regular Season · Central time`;

/* Roster markup is the one place we still build HTML strings, so every
   interpolated value goes through safe(). Standings text uses textContent. */
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
const fmt = date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
const kickoff = date => new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });
function nowTime(date = new Date()) {
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });
}
async function json(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from NFL data service');
  return response.json();
}
function isLive(event) {
  const type = event.status?.type || {};
  return !type.completed && (type.state === 'in' || ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_DELAYED'].includes(type.name));
}
function playoffRound(event) {
  const week = Number(event.week?.number || 0);
  return ({ 1: 'Wild Card', 2: 'Divisional', 3: 'Conference Championship', 4: 'Pro Bowl', 5: 'Super Bowl' })[week] || event.week?.text || 'Playoffs';
}
function cssColor(value, fallback) {
  const raw = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? '#' + raw.toLowerCase() : fallback;
}
function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 0;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
function lighten(hex, amount) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const channel = value => Math.max(0, Math.min(255, Math.round(value + (255 - value) * amount)));
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
}
function accentFor(team) {
  const dark = document.documentElement.dataset.theme !== 'light';
  const primary = team.color || '#5b6b82';
  const alt = team.alt || '#8aa0bd';
  if (dark) {
    if (luminance(primary) >= 0.28) return primary;
    if (luminance(alt) >= 0.28) return alt;
    return lighten(primary, 0.55);
  }
  if (luminance(primary) <= 0.72) return primary;
  if (luminance(alt) <= 0.72) return alt;
  return '#1d4e89';
}
function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = String(value);
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children || []) if (child) el.append(child);
  return el;
}
function setAttr(el, name, value) {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}
function setText(node, value, { flash = false } = {}) {
  if (!node) return;
  const next = String(value ?? '');
  if (node.textContent === next) return;
  const had = node.textContent.length > 0;
  node.textContent = next;
  if (flash && had) flashNode(node);
}
function flashNode(node) {
  node.classList.remove('flash');
  requestAnimationFrame(() => {
    node.classList.add('flash');
    node.addEventListener('animationend', () => node.classList.remove('flash'), { once: true });
  });
}
function setLogo(img, src, label) {
  if (!img) return;
  const clean = /^https?:\/\//i.test(String(src || '')) ? String(src) : '';
  if (!clean || logoFailed.has(clean)) {
    img.hidden = true;
    return;
  }
  img.hidden = false;
  if (img.getAttribute('src') !== clean) img.setAttribute('src', clean);
  const alt = String(label || '');
  if (img.getAttribute('alt') !== alt) img.setAttribute('alt', alt);
}
function teamById(id) {
  return currentTeams.find(team => team.id === id);
}
function rankOf(id) {
  const index = currentTeams.findIndex(team => team.id === id);
  return index < 0 ? 0 : index + 1;
}
function gameKey(game) {
  return `${game.type}|${game.week}|${game.date}|${game.opponent}`;
}
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
function payloadJson(teams) {
  return JSON.stringify(teams.map(team => [
    team.id, team.name, team.abbr, team.logo, team.color, team.w, team.l, team.t, team.pf, team.pa,
    team.games.map(game => [
      game.type, game.week, game.date, game.opponent, game.myScore, game.otherScore, game.result,
      game.completed, game.live, game.clock, game.tbd, game.away, game.myAbbr, game.otherAbbr,
      game.myLogo, game.otherLogo, game.round, game.myName
    ])
  ]));
}
function pageHidden() {
  return document.hidden;
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return;
    if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') prefs.theme = raw.theme;
    prefs.autoRefresh = raw.autoRefresh !== false;
    prefs.favoriteId = raw.favoriteId ? String(raw.favoriteId) : null;
    prefs.expanded = Array.isArray(raw.expanded) ? raw.expanded.map(String) : [];
    prefs.tabs = raw.tabs && typeof raw.tabs === 'object' ? raw.tabs : {};
    prefs.otherOpen = raw.otherOpen && typeof raw.otherOpen === 'object' ? raw.otherOpen : {};
  } catch { /* private mode or unreadable storage */ }
}
function hydratePanels() {
  for (const id of prefs.expanded || []) expanded.add(String(id));
  const ids = new Set([...Object.keys(prefs.tabs || {}), ...Object.keys(prefs.otherOpen || {})]);
  for (const id of ids) {
    panelState.set(String(id), {
      tab: prefs.tabs?.[id] === 'roster' ? 'roster' : 'games',
      otherOpen: !!prefs.otherOpen?.[id]
    });
  }
}
function persistPrefs() {
  const tabs = {};
  const otherOpen = {};
  for (const [id, state] of panelState) {
    tabs[id] = state.tab;
    if (state.otherOpen) otherOpen[id] = true;
  }
  prefs.expanded = [...expanded];
  prefs.tabs = tabs;
  prefs.otherOpen = otherOpen;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota or private mode */ }
}
function resolvedTheme() {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function updateThemeButton() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  themeToggle.textContent = theme === 'dark' ? 'Dark' : 'Light';
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e7eef6' : '#101827');
  updateThemeButton();
  for (const section of list.querySelectorAll('.entry')) {
    const team = teamById(section.dataset.teamId);
    if (!team) continue;
    const accent = accentFor(team);
    if (section.style.getPropertyValue('--team') !== accent) section.style.setProperty('--team', accent);
  }
}
function syncSettingsForm() {
  autoRefreshInput.checked = prefs.autoRefresh !== false;
  for (const input of themeInputs) input.checked = input.value === prefs.theme;
}
function updateLiveState() {
  const on = prefs.autoRefresh && !pageHidden();
  liveDot.classList.toggle('on', on);
  liveLabel.textContent = on ? 'Live' : 'Paused';
  document.getElementById('live-state').setAttribute('aria-label', on ? 'Automatic refresh is on' : 'Automatic refresh is paused');
}
function armTimer() {
  if (timer) clearInterval(timer);
  timer = 0;
  if (!prefs.autoRefresh || pageHidden()) return;
  timer = setInterval(() => {
    if (!pageHidden() && prefs.autoRefresh) load();
  }, 15000);
}
function currentFilters() {
  return {
    query: search.value.trim().toLowerCase(),
    conference: conferenceSelect.value,
    division: divisionSelect.value,
    liveOnly: liveOnlyBtn.getAttribute('aria-pressed') === 'true'
  };
}
function syncDivisionOptions() {
  const conference = conferenceSelect.value;
  for (const option of divisionSelect.options) {
    if (option.value === 'all') continue;
    const ok = conference === 'all' || option.value.startsWith(conference + ' ');
    option.disabled = !ok;
    option.hidden = !ok;
  }
  if (divisionSelect.selectedOptions[0]?.disabled) divisionSelect.value = 'all';
}
function viewTeams() {
  const filters = currentFilters();
  let rows = currentTeams.filter(team => {
    if (filters.liveOnly && !team.games.some(game => game.live)) return false;
    if (filters.conference !== 'all' && team.conference !== filters.conference) return false;
    if (filters.division !== 'all' && `${team.conference} ${team.division}` !== filters.division) return false;
    if (filters.query) {
      const blob = `${team.city} ${team.name} ${team.abbr} ${team.conference} ${team.division}`.toLowerCase();
      if (!blob.includes(filters.query)) return false;
    }
    return true;
  });
  if (prefs.favoriteId) {
    rows = [...rows.filter(team => team.id === prefs.favoriteId), ...rows.filter(team => team.id !== prefs.favoriteId)];
  }
  return rows;
}
function announceFilters() {
  const shown = [...list.querySelectorAll('.entry')].filter(el => !el.hidden).length;
  filterStatus.textContent = currentTeams.length ? `Showing ${shown} of ${currentTeams.length} teams` : '';
  empty.hidden = shown !== 0 || !currentTeams.length;
  if (!empty.hidden && currentTeams.length) empty.textContent = 'No teams match those filters.';
  clearTimeout(filterAnnounce);
  filterAnnounce = setTimeout(() => { filterLive.textContent = filterStatus.textContent; }, 250);
}
function onFilterChange() {
  syncDivisionOptions();
  syncList();
  announceFilters();
}

function createScorebox(className) {
  const box = h('span', { class: className || 'scorebox' });
  const piece = (cls, tag) => h(tag || 'span', { class: cls });
  box.append(
    h('span', { class: 'logo-slot' }, [h('img', { class: 'score-logo my-logo', alt: '', width: '15', height: '15', decoding: 'async' })]),
    piece('abbr my-abbr'),
    piece('pts my-pts'),
    piece('result'),
    h('span', { class: 'logo-slot' }, [h('img', { class: 'score-logo opp-logo', alt: '', width: '15', height: '15', decoding: 'async' })]),
    piece('abbr opp-abbr'),
    piece('pts opp-pts'),
    piece('result-pad')
  );
  box.querySelector('.result').hidden = true;
  box.querySelector('.result-pad').hidden = true;
  return box;
}
function patchScore(box, game) {
  if (!box) return;
  box.classList.toggle('live-score', !!game.live);
  const showResult = !!(game.completed && game.result);
  box.classList.toggle('has-result', showResult);
  setLogo(box.querySelector('.my-logo'), game.myLogo, '');
  setText(box.querySelector('.my-abbr'), game.myAbbr);
  setText(box.querySelector('.my-pts'), game.myScore, { flash: true });
  const result = box.querySelector('.result');
  const pad = box.querySelector('.result-pad');
  if (showResult) {
    result.hidden = false;
    pad.hidden = false;
    const cls = `result ${game.result}`;
    if (result.className !== cls) result.className = cls;
    setText(result, game.result);
  } else {
    result.hidden = true;
    pad.hidden = true;
    if (result.className !== 'result') result.className = 'result';
    setText(result, '');
  }
  setLogo(box.querySelector('.opp-logo'), game.otherLogo, '');
  setText(box.querySelector('.opp-abbr'), game.otherAbbr);
  setText(box.querySelector('.opp-pts'), game.otherScore, { flash: true });
}
function buildGameRow() {
  return h('div', { class: 'game' }, [
    h('div', { class: 'game-info' }, [
      h('div', { class: 'game-line' }, [
        h('span', { class: 'when' }),
        document.createTextNode(' · '),
        h('strong', { class: 'loc' }),
        document.createTextNode(' · '),
        h('span', { class: 'opp' })
      ]),
      h('div', { class: 'game-meta round' })
    ]),
    h('div', { class: 'game-score' }, [
      h('span', { class: 'badge' }),
      createScorebox('scorebox'),
      h('div', { class: 'game-meta clock' })
    ])
  ]);
}
function patchGame(row, game, kind) {
  const kindClass = kind === 'playoff' ? 'playoff' : kind === 'upcoming' ? 'upcoming' : '';
  const cls = `game${kindClass ? ' ' + kindClass : ''}${game.live ? ' is-live' : ''}`;
  if (row.className !== cls) row.className = cls;
  setText(row.querySelector('.when'), game.tbd ? 'TBD' : fmt(game.date));
  setText(row.querySelector('.loc'), game.away ? 'AWAY' : 'HOME');
  setText(row.querySelector('.opp'), `${game.away ? '@' : 'vs'} ${game.opponent}`);
  const round = row.querySelector('.round');
  if (kind === 'playoff') {
    round.hidden = false;
    setText(round, game.round || 'Playoffs');
  } else round.hidden = true;
  const badge = row.querySelector('.badge');
  const clock = row.querySelector('.clock');
  const box = row.querySelector('.scorebox');
  if (game.completed) {
    badge.hidden = true;
    clock.hidden = true;
    box.hidden = false;
    patchScore(box, game);
  } else if (game.live) {
    badge.hidden = false;
    setText(badge, '● LIVE');
    box.hidden = false;
    patchScore(box, game);
    clock.hidden = false;
    setText(clock, game.clock || '');
  } else {
    badge.hidden = false;
    setText(badge, 'SCHEDULED');
    box.hidden = true;
    clock.hidden = false;
    setText(clock, game.tbd ? 'Kickoff TBD' : kickoff(game.date));
  }
}
function gameSection(className, title, titleClass) {
  return h('div', { class: `game-section ${className}` }, [
    h('div', { class: `section-title${titleClass ? ' ' + titleClass : ''}`, text: title }),
    h('div', { class: 'section-body' })
  ]);
}
/* Move existing nodes instead of rebuilding them. dataset.key is the identity. */
function reconcile(parent, items, keyFn, create, update) {
  const leftover = new Map();
  for (const child of [...parent.children]) {
    if (child.dataset && child.dataset.key) leftover.set(child.dataset.key, child);
  }
  const next = [];
  for (const item of items) {
    const key = keyFn(item);
    let el = leftover.get(key);
    if (el) leftover.delete(key);
    else {
      el = create(item);
      el.dataset.key = key;
    }
    update(el, item);
    next.push(el);
  }
  for (const el of leftover.values()) el.remove();
  for (let i = 0; i < next.length; i++) {
    if (parent.children[i] !== next[i]) parent.insertBefore(next[i], parent.children[i] || null);
  }
}
function splitGames(team) {
  const byDate = (a, b) => Date.parse(a.date) - Date.parse(b.date);
  return {
    live: team.games.filter(game => game.live).sort(byDate),
    playoff: team.games.filter(game => game.type === 3 && !game.live).sort(byDate),
    upcoming: team.games.filter(game => game.type === 2 && !game.completed && !game.live).sort((a, b) => (a.tbd - b.tbd) || Date.parse(a.date) - Date.parse(b.date) || a.week - b.week),
    completed: team.games.filter(game => game.type === 2 && game.completed && !game.live).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  };
}
function fillGameGroup(sectionEl, games, kind) {
  const body = sectionEl.querySelector('.section-body');
  sectionEl.hidden = kind !== 'completed' && games.length === 0;
  if (kind === 'completed' && games.length === 0) {
    body.querySelectorAll('.game').forEach(node => node.remove());
    if (!body.querySelector('.empty')) {
      body.append(h('div', { class: 'empty', text: 'No completed regular-season games yet.' }));
    }
    return;
  }
  body.querySelectorAll('.empty').forEach(node => node.remove());
  reconcile(body, games, gameKey, () => buildGameRow(), (row, game) => patchGame(row, game, kind));
}
function syncGames(section, team) {
  const mount = section.querySelector('.games-mount');
  const open = section.querySelector('.panel').classList.contains('open');
  // Schedules stay unbuilt until a team is opened so collapsed rows do not
  // carry a copy of every section title, and logos are not fetched up front.
  if (!open && !mount.dataset.built) return;
  const sig = JSON.stringify(team.games.map(game => [
    game.type, game.week, game.date, game.opponent, game.myScore, game.otherScore, game.result,
    game.completed, game.live, game.clock, game.tbd, game.away, game.myAbbr, game.otherAbbr,
    game.myLogo, game.otherLogo, game.round
  ]));
  if (mount.dataset.sig === sig) return;
  const groups = splitGames(team);
  fillGameGroup(mount.querySelector('.live-sec'), groups.live, 'live');
  fillGameGroup(mount.querySelector('.playoff-sec'), groups.playoff, 'playoff');
  fillGameGroup(mount.querySelector('.upcoming-sec'), groups.upcoming, 'upcoming');
  fillGameGroup(mount.querySelector('.completed-sec'), groups.completed, 'completed');
  mount.dataset.sig = sig;
  mount.dataset.built = '1';
}
function makeTab(id, name, label) {
  return h('button', {
    type: 'button',
    class: 'tab',
    role: 'tab',
    id: `tab-${name}-${id}`,
    'data-tab': name,
    'data-team': id,
    'aria-selected': name === 'games' ? 'true' : 'false',
    'aria-controls': `tabpanel-${id}`,
    tabindex: name === 'games' ? '0' : '-1',
    text: label
  });
}
function buildSection(id) {
  const logo = h('img', { class: 'team-logo', alt: '', width: '36', height: '36', decoding: 'async' });
  const teamBtn = h('button', {
    type: 'button',
    class: 'team',
    'data-id': id,
    'aria-expanded': 'false',
    'aria-controls': `panel-${id}`
  }, [
    h('span', { class: 'rank' }),
    h('span', { class: 'identity' }, [
      h('span', { class: 'logo-frame' }, [logo]),
      h('span', { class: 'id-text' }, [
        h('span', { class: 'name-line' }, [
          h('span', { class: 'name' }),
          h('span', { class: 'live-pill', text: 'Live', hidden: true }),
          h('span', { class: 'mine', text: 'My team', hidden: true })
        ]),
        h('span', { class: 'sub' }),
        createScorebox('scorebox row-score')
      ])
    ]),
    h('span', { class: 'record' }),
    h('span', { class: 'arrow', 'aria-hidden': 'true' })
  ]);
  const gamesMount = h('div', { class: 'games-mount' }, [
    gameSection('live-sec', 'IN PROGRESS', 'live-title'),
    gameSection('playoff-sec', 'PLAYOFF GAMES', 'playoff-title'),
    gameSection('upcoming-sec', 'UPCOMING REGULAR-SEASON GAMES', 'upcoming-title'),
    gameSection('completed-sec', 'COMPLETED REGULAR-SEASON GAMES', '')
  ]);
  const slot = h('div', { class: 'roster-slot', id: `roster-slot-${id}` });
  const tabpanel = h('div', { class: 'tabpanels', id: `tabpanel-${id}`, role: 'tabpanel' }, [gamesMount, slot]);
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Team details' }, [
    makeTab(id, 'games', 'Games'),
    makeTab(id, 'roster', 'Roster')
  ]);
  const panel = h('div', { class: 'panel', id: `panel-${id}`, 'aria-hidden': 'true', inert: '' }, [
    h('div', { class: 'panel-clip' }, [tabs, tabpanel])
  ]);
  const fav = h('button', { type: 'button', class: 'fav', 'data-id': id, 'aria-pressed': 'false', text: '★' });
  const section = h('section', { class: 'entry', id: `team-${id}`, 'data-team-id': id, role: 'listitem' }, [teamBtn, fav, panel]);
  section.querySelector('.row-score').hidden = true;
  return section;
}
function ensureSection(team) {
  let section = document.getElementById('team-' + team.id);
  if (section) return section;
  section = buildSection(team.id);
  list.append(section);
  return section;
}
function syncTabState(section, team) {
  const tab = panelFor(team.id).tab;
  for (const button of section.querySelectorAll('button.tab')) {
    const on = button.dataset.tab === tab;
    setAttr(button, 'aria-selected', on ? 'true' : 'false');
    setAttr(button, 'tabindex', on ? '0' : '-1');
  }
  const gamesMount = section.querySelector('.games-mount');
  const slot = section.querySelector('.roster-slot');
  const selected = section.querySelector('button.tab[aria-selected="true"]');
  const panelNode = section.querySelector('[role="tabpanel"]');
  if (selected && panelNode) setAttr(panelNode, 'aria-labelledby', selected.id);
  if (tab === 'roster') {
    gamesMount.hidden = true;
    slot.hidden = false;
    const node = parked.get(team.id);
    if (node && node.parentNode !== slot) slot.append(node);
  } else {
    /* Detach the roster so its text is not in the document on the Games tab,
       but keep the same nodes (and any loaded headshots) for the way back. */
    const node = slot.querySelector(':scope > .roster-root');
    if (node) {
      parked.set(team.id, node);
      node.remove();
    }
    slot.hidden = true;
    gamesMount.hidden = false;
  }
}
function patchSection(section, team, rank) {
  const open = expanded.has(team.id);
  const live = team.games.find(game => game.live);
  const fav = prefs.favoriteId === team.id;
  section.classList.toggle('live-team', !!live);
  section.classList.toggle('is-fav', fav);
  const accent = accentFor(team);
  if (section.style.getPropertyValue('--team') !== accent) section.style.setProperty('--team', accent);
  setText(section.querySelector('.rank'), String(rank), { flash: true });
  const logo = section.querySelector('.team-logo');
  setLogo(logo, team.logo, '');
  if (logo && !logo.hasAttribute('loading')) logo.loading = rank <= 12 ? 'eager' : 'lazy';
  setText(section.querySelector('.name'), team.name);
  section.querySelector('.live-pill').hidden = !live;
  section.querySelector('.mine').hidden = !fav;
  const diff = team.pf - team.pa;
  const place = team.conference && team.conference !== 'NFL' ? `${team.conference} ${team.division} · ` : '';
  setText(section.querySelector('.sub'), `${place}${(team.pct * 100).toFixed(1)}% · PD ${diff > 0 ? '+' : ''}${diff}`, { flash: true });
  const rowScore = section.querySelector('.row-score');
  let liveEl = section.querySelector('.live-indicator');
  if (live) {
    if (!liveEl) {
      liveEl = h('span', { class: 'live-indicator' });
      section.querySelector('.sub').after(liveEl);
    }
    setText(liveEl, `● LIVE · ${live.clock}`);
    rowScore.hidden = false;
    patchScore(rowScore, live);
  } else {
    if (liveEl) liveEl.remove();
    rowScore.hidden = true;
  }
  setText(section.querySelector('.record'), `${team.w}-${team.l}-${team.t}`, { flash: true });
  const teamBtn = section.querySelector('button.team');
  setAttr(teamBtn, 'aria-expanded', open ? 'true' : 'false');
  section.querySelector('.arrow').classList.toggle('open', open);
  const favBtn = section.querySelector('button.fav');
  setAttr(favBtn, 'aria-pressed', fav ? 'true' : 'false');
  setAttr(favBtn, 'aria-label', `${fav ? 'Remove' : 'Pin'} ${team.name} as my team`);
  favBtn.classList.toggle('on', fav);
  const panel = section.querySelector('.panel');
  panel.classList.toggle('open', open);
  if (open) {
    panel.removeAttribute('aria-hidden');
    panel.removeAttribute('inert');
  } else {
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('inert', '');
    if (panel.contains(document.activeElement)) teamBtn.focus({ preventScroll: true });
  }
  syncGames(section, team);
  syncTabState(section, team);
  if (open && panelFor(team.id).tab === 'roster') ensureRoster(team.id);
}
/* Reorder with insertBefore so existing team nodes stay the same objects.
   Scroll and focus are put back because moving a node can nudge both. */
function syncList() {
  const y = window.scrollY;
  const active = document.activeElement;
  if (!booted) document.documentElement.classList.add('booting');
  list.querySelectorAll('.skeleton').forEach(node => node.remove());
  list.setAttribute('aria-busy', 'false');
  const ranks = new Map(currentTeams.map((team, index) => [team.id, index + 1]));
  const view = viewTeams();
  const visible = new Set(view.map(team => team.id));
  const alive = new Set(currentTeams.map(team => team.id));
  for (const team of currentTeams) ensureSection(team);
  for (const section of [...list.children]) {
    const id = section.dataset.teamId;
    if (!id || !alive.has(id)) {
      section.remove();
      continue;
    }
    patchSection(section, teamById(id), ranks.get(id));
    section.hidden = !visible.has(id);
  }
  const ordered = view.map(team => document.getElementById('team-' + team.id)).filter(Boolean);
  for (const section of [...list.children]) if (section.hidden) ordered.push(section);
  for (let i = 0; i < ordered.length; i++) {
    if (list.children[i] !== ordered[i]) list.insertBefore(ordered[i], list.children[i] || null);
  }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  if (active instanceof HTMLElement && document.contains(active) && document.activeElement !== active) {
    active.focus({ preventScroll: true });
  }
  if (!booted) {
    booted = true;
    requestAnimationFrame(() => document.documentElement.classList.remove('booting'));
  }
}
function syncLiveStrip() {
  const games = [];
  const seen = new Set();
  for (const team of currentTeams) {
    for (const game of team.games) {
      if (!game.live) continue;
      const key = [team.abbr, game.otherAbbr].sort().join('|') + '|' + game.date;
      if (seen.has(key)) continue;
      seen.add(key);
      games.push({ key, team, game });
    }
  }
  liveStrip.hidden = games.length === 0;
  reconcile(liveStrip, games, item => item.key, () => {
    return h('button', { type: 'button', class: 'live-chip' }, [
      h('span', { class: 'logo-slot' }, [h('img', { class: 'score-logo chip-logo', alt: '', width: '15', height: '15', decoding: 'async' })]),
      h('span', { class: 'chip-text' })
    ]);
  }, (button, item) => {
    button.dataset.teamId = item.team.id;
    setLogo(button.querySelector('img'), item.game.myLogo || item.team.logo, '');
    setText(button.querySelector('.chip-text'), `${item.game.myAbbr} ${item.game.myScore}–${item.game.otherAbbr} ${item.game.otherScore} · ${item.game.clock}`);
    setAttr(button, 'aria-label', `Live now, ${item.team.name} ${item.game.myScore}, ${item.game.opponent} ${item.game.otherScore}, ${item.game.clock}. Show ${item.team.name}`);
  });
}
function showTeam(id) {
  if (!viewTeams().some(team => team.id === id)) {
    search.value = '';
    conferenceSelect.value = 'all';
    divisionSelect.value = 'all';
    liveOnlyBtn.setAttribute('aria-pressed', 'false');
    syncDivisionOptions();
  }
  expanded.add(id);
  savePanel(id, {});
  persistPrefs();
  syncList();
  const section = document.getElementById('team-' + id);
  if (!section) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}
function toggleTeam(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  persistPrefs();
  const section = document.getElementById('team-' + id);
  const team = teamById(id);
  if (section && team) patchSection(section, team, rankOf(id));
}
function announceScores(previous, next) {
  if (!previous.length) return;
  const prevById = new Map(previous.map(team => [team.id, team]));
  const messages = [];
  for (const team of next) {
    const old = prevById.get(team.id);
    if (!old) continue;
    if (old.w !== team.w || old.l !== team.l || old.t !== team.t) {
      messages.push(`${team.abbr || team.name} record ${team.w}-${team.l}-${team.t}`);
    }
    const oldGames = new Map(old.games.map(game => [gameKey(game), game]));
    for (const game of team.games) {
      if (!game.live && !game.completed) continue;
      const prior = oldGames.get(gameKey(game));
      if (!prior) continue;
      if (prior.myScore !== game.myScore || prior.otherScore !== game.otherScore || prior.clock !== game.clock) {
        messages.push(`${game.myAbbr} ${game.myScore}, ${game.otherAbbr} ${game.otherScore}${game.live ? ', ' + game.clock : ''}`);
      }
    }
  }
  if (!messages.length) return;
  const text = messages.slice(0, 3).join('. ');
  if (scoreLive.textContent !== text) scoreLive.textContent = text;
}
function noteSuccess(failures, gameCount) {
  lastSuccess = new Date();
  lastFailures = failures;
  lastGameCount = gameCount;
  banner.hidden = true;
  banner.textContent = '';
  const auto = prefs.autoRefresh ? 'refreshes every 15s' : 'auto-refresh off';
  const miss = failures ? ` · ${failures} weeks unavailable` : '';
  statusEl.textContent = `Updated ${nowTime()} · ${gameCount} games checked · Central time${miss} · ${auto}`;
  const shown = [...list.querySelectorAll('.entry')].filter(el => !el.hidden).length;
  filterStatus.textContent = `Showing ${shown} of ${currentTeams.length} teams`;
  if (shown === 0) {
    empty.hidden = false;
    empty.textContent = 'No teams match those filters.';
  } else empty.hidden = true;
}
function failLoad(err) {
  const message = err && err.message ? String(err.message) : 'Something went wrong';
  banner.hidden = false;
  banner.textContent = lastSuccess
    ? `Unable to refresh: ${message}. Showing the last good update.`
    : `Unable to refresh: ${message}. Check your connection and try again.`;
  statusEl.textContent = lastSuccess ? `Last good update ${nowTime(lastSuccess)}` : 'Update failed';
  if (!list.querySelector('.entry')) {
    list.querySelectorAll('.skeleton').forEach(node => node.remove());
    list.setAttribute('aria-busy', 'false');
    empty.hidden = false;
    empty.textContent = 'Standings could not be loaded.';
  }
}

async function load(manual = false) {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  refresh.setAttribute('aria-busy', 'true');
  // Automatic refreshes keep the current status line so the page does not
  // announce "checking" every 15 seconds. A manual refresh still swaps it,
  // which is also how the UI test waits for the round trip to finish.
  if (manual || !list.querySelector('.entry')) statusEl.textContent = 'Checking ESPN for the latest results…';
  try {
    const requests = [json(`${BASE}/teams?limit=40`)];
    for (let week = 1; week <= 18; week++) requests.push(json(`${BASE}/scoreboard?season=${season}&seasontype=2&week=${week}&limit=30`));
    for (let week = 1; week <= 5; week++) requests.push(json(`${BASE}/scoreboard?season=${season}&seasontype=3&week=${week}&limit=30`));
    const responses = await Promise.allSettled(requests);
    if (responses[0].status !== 'fulfilled') throw responses[0].reason;
    const rawTeams = responses[0].value.sports?.[0]?.leagues?.[0]?.teams || [];
    if (rawTeams.length < 32) throw new Error('Could not retrieve all 32 teams');
    const teams = new Map(rawTeams.map(item => {
      const raw = item.team;
      const info = TEAM_INFO[String(raw.id)] || { conference: 'NFL', division: '', color: '#5b6b82', alt: '#8aa0bd', city: '' };
      return [String(raw.id), {
        id: String(raw.id),
        name: raw.displayName,
        abbr: raw.abbreviation || '',
        logo: raw.logos?.[0]?.href || raw.logo || '',
        color: cssColor(raw.color, info.color),
        alt: cssColor(raw.alternateColor, info.alt),
        conference: info.conference,
        division: info.division,
        city: info.city,
        w: 0, l: 0, t: 0, pf: 0, pa: 0,
        games: []
      }];
    }));
    const events = new Map();
    let failures = 0;
    for (let i = 1; i < responses.length; i++) {
      const response = responses[i];
      if (response.status !== 'fulfilled') { failures++; continue; }
      const expectedType = i <= 18 ? 2 : 3;
      for (const event of response.value.events || []) {
        if (expectedType === 2 && Number(event.week?.number || event.weekNumber || i) !== i) continue;
        const actualType = Number(event.season?.type || expectedType);
        if (actualType !== expectedType) continue;
        events.set(`${actualType}:${event.id}`, { ...event, _type: actualType, _week: expectedType === 2 ? i : i - 18 });
      }
    }
    if (!events.size) throw new Error('No NFL schedule data available');
    for (const event of events.values()) {
      const competitors = event.competitions?.[0]?.competitors || [];
      if (competitors.length !== 2) continue;
      const [a, b] = competitors;
      if (!teams.has(String(a.id)) || !teams.has(String(b.id))) continue;
      const completed = !!event.status?.type?.completed;
      const live = isLive(event);
      const scoreA = Number(a.score);
      const scoreB = Number(b.score);
      if (completed && (!Number.isFinite(scoreA) || !Number.isFinite(scoreB))) continue;
      for (const [me, other, myScore, otherScore] of [[a, b, scoreA, scoreB], [b, a, scoreB, scoreA]]) {
        const team = teams.get(String(me.id));
        const opp = teams.get(String(other.id));
        const result = completed ? (myScore > otherScore ? 'W' : myScore < otherScore ? 'L' : 'T') : null;
        if (completed && event._type === 2) {
          team[result.toLowerCase()]++;
          team.pf += myScore;
          team.pa += otherScore;
        }
        team.games.push({
          type: event._type,
          date: event.date,
          opponent: other.team?.displayName || opp.name || 'Opponent',
          myName: me.team?.displayName || team.name,
          myAbbr: me.team?.abbreviation || team.abbr || '',
          otherAbbr: other.team?.abbreviation || opp.abbr || '',
          myLogo: team.logo || me.team?.logo || '',
          otherLogo: opp.logo || other.team?.logo || '',
          away: me.homeAway === 'away',
          myScore: Number.isFinite(myScore) ? myScore : 0,
          otherScore: Number.isFinite(otherScore) ? otherScore : 0,
          result,
          completed,
          live,
          clock: event.status?.displayClock && event.status?.period ? `Q${event.status.period} ${event.status.displayClock}` : event.status?.type?.shortDetail || 'In progress',
          round: playoffRound(event),
          week: event._week,
          tbd: event._type === 2 && !completed && event._week >= 17
        });
      }
    }
    const next = [...teams.values()].map(team => {
      const played = team.w + team.l + team.t;
      return { ...team, pct: played ? (team.w + team.t / 2) / played : 0 };
    }).sort((a, b) => b.pct - a.pct || b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || a.name.localeCompare(b.name));
    const jsonText = payloadJson(next);
    const hash = fnv1a(jsonText);
    const previous = currentTeams;
    currentTeams = next;
    /* Same payload as last time: leave every DOM node, image, and scroll position alone. */
    if (hash === lastHash && jsonText === lastPayloadJson && list.querySelector('.entry')) {
      noteSuccess(failures, events.size);
      return;
    }
    lastHash = hash;
    lastPayloadJson = jsonText;
    announceScores(previous, next);
    syncLiveStrip();
    syncList();
    noteSuccess(failures, events.size);
  } catch (err) {
    failLoad(err);
  } finally {
    busy = false;
    refresh.disabled = false;
    refresh.removeAttribute('aria-busy');
    updateLiveState();
  }
}

function panelFor(id) {
  return panelState.get(id) || { tab: 'games', otherOpen: false };
}
function savePanel(id, patch) {
  const next = { ...panelFor(id), ...patch };
  panelState.set(id, next);
  return next;
}
function safeUrl(url) {
  const value = String(url || '');
  return /^https?:\/\//i.test(value) ? safe(value) : '';
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  return (letters || '?').toUpperCase();
}
function expLabel(years) {
  if (years == null || years === '') return '';
  const n = Number(years);
  if (!Number.isFinite(n)) return String(years);
  if (n <= 0) return 'Rookie';
  return n === 1 ? '1 yr' : n + ' yrs';
}
function normalizeDraft(draft) {
  if (draft == null || typeof draft !== 'object') return null;
  const draftYear = Number(draft.year);
  if (!Number.isFinite(draftYear)) return null;
  const round = Number(draft.round);
  const pick = Number(draft.pick);
  return { year: draftYear, round: Number.isFinite(round) ? round : null, pick: Number.isFinite(pick) ? pick : null };
}
function loadDraftCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_LS_KEY) || '{}');
    const now = Date.now();
    let changed = false;
    for (const [id, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== 'object' || !(rec.exp > now) || !('draft' in rec)) { changed = true; continue; }
      draftMem.set(id, { draft: normalizeDraft(rec.draft), exp: rec.exp });
    }
    if (changed) persistDrafts();
  } catch { /* private mode or unreadable storage */ }
}
function persistDrafts() {
  try {
    const now = Date.now();
    const out = {};
    for (const [id, rec] of draftMem) if (rec && rec.exp > now) out[id] = { draft: rec.draft, exp: rec.exp };
    localStorage.setItem(DRAFT_LS_KEY, JSON.stringify(out));
  } catch { /* quota or private mode */ }
}
function draftText(id) {
  const key = String(id ?? '');
  if (draftFailed.has(key)) return 'Draft unavailable';
  if (!draftMem.has(key)) return '...';
  const draft = draftMem.get(key).draft;
  if (draft == null) return 'Undrafted';
  const parts = [];
  if (draft.round != null) parts.push('Rd ' + draft.round);
  if (draft.pick != null) parts.push('Pk ' + draft.pick);
  return parts.length ? `Drafted ${draft.year} · ${parts.join(', ')}` : `Drafted ${draft.year}`;
}
function applyDraftDom() {
  const roots = [document, ...parked.values()];
  for (const root of roots) {
    root.querySelectorAll('[data-draft-id]').forEach(el => {
      const text = draftText(el.dataset.draftId);
      if (el.textContent !== text) el.textContent = text;
    });
  }
}
function collectIds(data) {
  const ids = [];
  const seen = new Set();
  const add = player => {
    if (!player || player.id == null) return;
    const id = String(player.id);
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const section of data.sections || []) {
    for (const pos of section.positions || []) for (const player of pos.players || []) add(player);
  }
  for (const player of data.other || []) add(player);
  return ids;
}
async function fetchDraftBatch(ids) {
  for (const id of ids) draftPending.add(id);
  try {
    const response = await fetch(`${BASE}/draft?ids=${ids.map(encodeURIComponent).join(',')}`, { cache: 'no-store' });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    const usable = response.ok && data && typeof data === 'object' && !Array.isArray(data) && !(data.message && data.endpoints);
    const now = Date.now();
    for (const id of ids) {
      draftPending.delete(id);
      if (!usable || !Object.prototype.hasOwnProperty.call(data, id)) { draftFailed.add(id); continue; }
      const value = data[id];
      if (value == null) draftMem.set(id, { draft: null, exp: now + DRAFT_TTL_MS });
      else if (typeof value === 'object' && Number.isFinite(Number(value.year))) draftMem.set(id, { draft: normalizeDraft(value), exp: now + DRAFT_TTL_MS });
      else draftFailed.add(id);
    }
    if (usable) persistDrafts();
  } catch {
    for (const id of ids) { draftPending.delete(id); draftFailed.add(id); }
  }
  applyDraftDom();
}
async function fillDrafts(ids) {
  const need = ids.filter(id => id && !draftMem.has(id) && !draftPending.has(id) && !draftFailed.has(id));
  if (!need.length) { applyDraftDom(); return; }
  const batches = [];
  for (let i = 0; i < need.length; i += DRAFT_BATCH) batches.push(need.slice(i, i + DRAFT_BATCH));
  await Promise.all(batches.map(fetchDraftBatch));
}
function clearDraftFailures(ids) {
  for (const id of ids) draftFailed.delete(id);
}
function rosterSignature(id) {
  const record = rosters.get(id);
  if (!record) return 'none';
  if (record.state !== 'ready') return record.state + '|' + (record.error || '');
  return 'ready|' + JSON.stringify(record.data);
}
function headshotHtml(player) {
  const letters = initials(player.name);
  if (!player.headshot || headshotFailed.has(String(player.id))) {
    return `<span class="headshot-fallback" aria-hidden="true">${safe(letters)}</span>`;
  }
  return `<img class="headshot" data-pid="${safe(player.id)}" data-initials="${safe(letters)}" src="${safeUrl(player.headshot)}" alt="" width="36" height="36" decoding="async" loading="lazy">`;
}
function playerRow(player) {
  const chips = [];
  if (player.jersey) chips.push(`<span class="meta-chip">#${safe(player.jersey)}</span>`);
  if (player.position) chips.push(`<span class="meta-chip">${safe(player.position)}</span>`);
  const badges = [];
  if (player.starter) badges.push('<span class="badge-starter">Starter</span>');
  if (player.injury) badges.push(`<span class="badge-injury">${safe(player.injury)}</span>`);
  const meta = [];
  const size = [player.height, player.weight].filter(Boolean).map(value => safe(value)).join(' · ');
  if (size) meta.push(size);
  if (player.age != null && player.age !== '') meta.push('Age ' + safe(player.age));
  const experience = expLabel(player.experience);
  if (experience) meta.push(safe(experience));
  if (player.college) meta.push(safe(player.college));
  const draft = `<span class="draft" data-draft-id="${safe(player.id)}">${safe(draftText(player.id))}</span>`;
  return `<div class="player">${headshotHtml(player)}<div><div class="player-name"><span>${safe(player.name)}</span>${chips.join('')}${badges.join('')}</div><div class="player-meta">${meta.join(' · ')}${meta.length ? ' · ' : ''}${draft}</div></div></div>`;
}
function rosterHtml(team) {
  const record = rosters.get(team.id);
  const retry = `<div class="roster-actions"><button type="button" class="retry" data-roster-retry="${safe(team.id)}">Retry</button></div>`;
  if (!record || record.state === 'loading') return '<div class="empty">Loading roster…</div>';
  if (record.state === 'unavailable') return `<div class="empty">Roster is unavailable for this team right now. Standings and games are unaffected.${retry}</div>`;
  if (record.state === 'error') return `<div class="empty error">${safe(record.error || 'Could not load roster.')}${retry}</div>`;
  const data = record.data;
  let html = `<div class="roster-source">${safe(data.source || 'ESPN depth chart')}</div>`;
  if (!data.sections.length) html += '<div class="empty">No depth chart published.</div>';
  for (const section of data.sections) {
    html += `<div class="section-title">${safe(section.name)}</div>`;
    for (const position of section.positions || []) {
      html += `<div class="pos-block"><div class="pos-label">${safe(position.pos)}</div>${(position.players || []).map(playerRow).join('')}</div>`;
    }
  }
  const other = data.other || [];
  if (other.length) {
    const open = panelFor(team.id).otherOpen;
    html += `<details class="other-roster" data-team="${safe(team.id)}"${open ? ' open' : ''}><summary>Other roster (${other.length})</summary>${other.map(playerRow).join('')}</details>`;
  }
  return html;
}
function bindHeadshots(root) {
  root.querySelectorAll('img.headshot').forEach(img => {
    img.addEventListener('error', () => onHeadshotError(img));
  });
}
function paintRoster(id) {
  const team = teamById(id);
  if (!team) return;
  const sig = rosterSignature(id);
  let root = parked.get(id);
  if (!root || root.dataset.sig !== sig) {
    const previous = root;
    root = document.createElement('div');
    root.className = 'roster-root';
    root.dataset.sig = sig;
    try { root.innerHTML = rosterHtml(team); }
    catch { root.innerHTML = '<div class="empty error">Could not show this roster.</div>'; }
    bindHeadshots(root);
    parked.set(id, root);
    if (previous && previous.isConnected) previous.replaceWith(root);
  }
  const slot = document.getElementById('roster-slot-' + id);
  const show = expanded.has(id) && panelFor(id).tab === 'roster';
  if (show && slot && root.parentNode !== slot) slot.append(root);
}
async function ensureRoster(id, { force = false } = {}) {
  const current = rosters.get(id);
  if (!force && current && current.state !== 'idle') return;
  const seq = (rosterSeq.get(id) || 0) + 1;
  rosterSeq.set(id, seq);
  if (force && current?.data) clearDraftFailures(collectIds(current.data));
  rosters.set(id, { state: 'loading', data: null, error: null });
  paintRoster(id);
  try {
    const response = await fetch(`${BASE}/roster?team=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (rosterSeq.get(id) !== seq) return;
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (rosterSeq.get(id) !== seq) return;
    if (response.status === 404 || data?.unavailable) rosters.set(id, { state: 'unavailable', data: null, error: null });
    else if (!response.ok) rosters.set(id, { state: 'error', data: null, error: `Could not load roster (HTTP ${response.status}).` });
    else if (!data || !Array.isArray(data.sections) || !Array.isArray(data.other)) rosters.set(id, { state: 'unavailable', data: null, error: null });
    else rosters.set(id, { state: 'ready', data, error: null });
  } catch {
    if (rosterSeq.get(id) !== seq) return;
    rosters.set(id, { state: 'error', data: null, error: 'Could not load roster. Check your connection and try again.' });
  }
  if (rosterSeq.get(id) !== seq) return;
  paintRoster(id);
  const ready = rosters.get(id);
  if (ready?.state === 'ready') void fillDrafts(collectIds(ready.data));
}
function onHeadshotError(img) {
  if (!img || !img.classList || !img.classList.contains('headshot') || img.dataset.replaced) return;
  img.dataset.replaced = '1';
  const pid = img.dataset.pid;
  if (pid) headshotFailed.add(pid);
  const fallback = document.createElement('span');
  fallback.className = 'headshot-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.textContent = img.dataset.initials || '?';
  img.replaceWith(fallback);
}
function onTabClick(tab) {
  const id = tab.dataset.team;
  const name = tab.dataset.tab === 'roster' ? 'roster' : 'games';
  savePanel(id, { tab: name });
  persistPrefs();
  const section = document.getElementById('team-' + id);
  const team = teamById(id);
  if (!section || !team) return;
  syncTabState(section, team);
  if (name === 'roster') ensureRoster(id);
}

list.addEventListener('click', event => {
  const tab = event.target.closest('button.tab');
  if (tab) { onTabClick(tab); return; }
  const retry = event.target.closest('button.retry');
  if (retry) { ensureRoster(retry.dataset.rosterRetry, { force: true }); return; }
  const fav = event.target.closest('button.fav');
  if (fav) { prefs.favoriteId = prefs.favoriteId === fav.dataset.id ? null : fav.dataset.id; persistPrefs(); syncList(); return; }
  const teamBtn = event.target.closest('button.team');
  if (teamBtn) toggleTeam(teamBtn.dataset.id);
});
list.addEventListener('keydown', event => {
  const tab = event.target.closest?.('button.tab');
  if (!tab || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
  const tabs = [...tab.parentElement.querySelectorAll('button.tab')];
  const index = tabs.indexOf(tab);
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  event.preventDefault();
  next.focus();
  next.click();
});
document.addEventListener('toggle', event => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('other-roster')) return;
  const id = details.dataset.team;
  if (!id) return;
  savePanel(id, { otherOpen: details.open });
  persistPrefs();
}, true);
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('score-logo') || img.classList.contains('team-logo')) {
    const src = img.getAttribute('src');
    if (src) logoFailed.add(src);
    img.hidden = true;
    return;
  }
  if (img.classList.contains('headshot')) onHeadshotError(img);
}, true);
liveStrip.addEventListener('click', event => {
  const chip = event.target.closest('.live-chip');
  if (chip?.dataset.teamId) showTeam(chip.dataset.teamId);
});
search.addEventListener('input', onFilterChange);
conferenceSelect.addEventListener('change', onFilterChange);
divisionSelect.addEventListener('change', onFilterChange);
liveOnlyBtn.addEventListener('click', () => {
  const on = liveOnlyBtn.getAttribute('aria-pressed') !== 'true';
  liveOnlyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  onFilterChange();
});
refresh.addEventListener('click', () => load(true));
themeToggle.addEventListener('click', () => {
  prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
  persistPrefs();
  applyTheme();
  syncSettingsForm();
});
document.querySelector('#settings-open').addEventListener('click', () => {
  syncSettingsForm();
  settingsDialog.showModal();
});
document.querySelector('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', event => {
  if (event.target === settingsDialog) settingsDialog.close();
});
autoRefreshInput.addEventListener('change', () => {
  prefs.autoRefresh = autoRefreshInput.checked;
  persistPrefs();
  armTimer();
  updateLiveState();
  if (lastSuccess) noteSuccess(lastFailures, lastGameCount);
});
for (const input of themeInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    prefs.theme = input.value;
    persistPrefs();
    applyTheme();
  });
}
document.addEventListener('visibilitychange', () => {
  updateLiveState();
  if (pageHidden()) {
    if (timer) clearInterval(timer);
    timer = 0;
    return;
  }
  armTimer();
  if (prefs.autoRefresh) load();
});
window.addEventListener('offline', () => {
  banner.hidden = false;
  banner.textContent = lastSuccess
    ? 'You are offline. Showing the last good update.'
    : 'You are offline. Standings will load when you reconnect.';
});
window.addEventListener('online', () => {
  if (prefs.autoRefresh) load();
  else if (lastSuccess) { banner.hidden = true; banner.textContent = ''; }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.theme === 'system') applyTheme();
});

function registerShellWorker() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

loadPrefs();
hydratePanels();
applyTheme();
syncSettingsForm();
updateLiveState();
loadDraftCache();
armTimer();
if (!navigator.onLine) {
  banner.hidden = false;
  banner.textContent = 'You are offline. Standings will load when you reconnect.';
}
registerShellWorker();
load();
