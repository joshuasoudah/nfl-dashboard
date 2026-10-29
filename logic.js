/* Pure standings, preference, and draft-cache rules. No DOM, so node tests
   and the page share one implementation. */

export const TEAM_INFO = {
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

export function seasonYear(date = new Date()) {
  const y = date.getFullYear();
  return date.getMonth() < 2 ? y - 1 : y;
}

export function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

export function isLive(event) {
  const type = event?.status?.type || {};
  return !type.completed && (type.state === 'in' || ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_DELAYED'].includes(type.name));
}

export function playoffRound(event) {
  const week = Number(event?.week?.number || 0);
  return ({ 1: 'Wild Card', 2: 'Divisional', 3: 'Conference Championship', 4: 'Pro Bowl', 5: 'Super Bowl' })[week] || event?.week?.text || 'Playoffs';
}

export function cssColor(value, fallback) {
  const raw = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? '#' + raw.toLowerCase() : fallback;
}

export function winningPercentage(wins, losses, ties) {
  const played = wins + losses + ties;
  return played ? (wins + ties / 2) / played : 0;
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

export function accentFor(team, dark) {
  const primary = team?.color || '#5b6b82';
  const alt = team?.alt || '#8aa0bd';
  if (dark) {
    if (luminance(primary) >= 0.28) return primary;
    if (luminance(alt) >= 0.28) return alt;
    return lighten(primary, 0.55);
  }
  if (luminance(primary) <= 0.72) return primary;
  if (luminance(alt) <= 0.72) return alt;
  return '#1d4e89';
}

function httpUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
}

function cleanTeamId(value) {
  const id = String(value ?? '').trim();
  if (!/^[1-9]\d{0,2}$/.test(id)) return null;
  if (Number(id) > 99) return null;
  return id;
}

export function normalizeDraft(draft) {
  if (draft == null || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const draftYear = Number(draft.year);
  if (!Number.isInteger(draftYear) || draftYear < 1920 || draftYear > 2100) return null;
  const round = Number(draft.round);
  const pick = Number(draft.pick);
  return {
    year: draftYear,
    round: Number.isInteger(round) && round > 0 && round < 100 ? round : null,
    pick: Number.isInteger(pick) && pick > 0 && pick < 1000 ? pick : null
  };
}

export function sanitizePrefs(raw) {
  const prefs = { theme: 'system', autoRefresh: true, expanded: [], tabs: {}, otherOpen: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prefs;
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') prefs.theme = raw.theme;
  if (typeof raw.autoRefresh === 'boolean') prefs.autoRefresh = raw.autoRefresh;
  if (Array.isArray(raw.expanded)) {
    for (const value of raw.expanded) {
      const id = cleanTeamId(value);
      if (!id || prefs.expanded.includes(id)) continue;
      prefs.expanded.push(id);
      if (prefs.expanded.length >= 32) break;
    }
  }
  if (raw.tabs && typeof raw.tabs === 'object' && !Array.isArray(raw.tabs)) {
    for (const [key, value] of Object.entries(raw.tabs)) {
      const id = cleanTeamId(key);
      if (!id || (value !== 'games' && value !== 'roster' && value !== 'stats')) continue;
      prefs.tabs[id] = value;
      if (Object.keys(prefs.tabs).length >= 32) break;
    }
  }
  if (raw.otherOpen && typeof raw.otherOpen === 'object' && !Array.isArray(raw.otherOpen)) {
    for (const [key, value] of Object.entries(raw.otherOpen)) {
      const id = cleanTeamId(key);
      if (!id || value !== true) continue;
      prefs.otherOpen[id] = true;
      if (Object.keys(prefs.otherOpen).length >= 32) break;
    }
  }
  return prefs;
}

export function sanitizeDraftCache(raw, now = Date.now()) {
  const entries = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return entries;
  const maxExp = now + 400 * 24 * 60 * 60 * 1000;
  let seen = 0;
  for (const [key, rec] of Object.entries(raw)) {
    seen += 1;
    if (seen > 2000 || entries.length >= 800) break;
    if (!/^[1-9]\d{0,11}$/.test(key)) continue;
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !('draft' in rec)) continue;
    const exp = Number(rec.exp);
    if (!Number.isFinite(exp) || exp <= now || exp > maxExp) continue;
    if (rec.draft == null) {
      entries.push({ id: key, draft: null, exp });
      continue;
    }
    const draft = normalizeDraft(rec.draft);
    if (!draft) continue;
    entries.push({ id: key, draft, exp });
  }
  return entries;
}

function clockLabel(event) {
  const status = event?.status || {};
  if (status.displayClock && status.period) return `Q${status.period} ${status.displayClock}`;
  return status.type?.shortDetail || 'In progress';
}

function ingestEvent(event, expectedType, weekNumber, teams, events) {
  if (!event || typeof event !== 'object') return;
  if (expectedType === 2) {
    const reported = Number(event.week?.number || event.weekNumber || weekNumber);
    if (reported !== weekNumber) return;
  }
  const actualType = Number(event.season?.type || expectedType);
  if (actualType !== expectedType) return;
  const competitors = event.competitions?.[0]?.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2) return;
  const [a, b] = competitors;
  if (!a || !b || !teams.has(String(a.id)) || !teams.has(String(b.id))) return;
  const eventId = `${actualType}:${event.id != null ? event.id : `${weekNumber}:${a.id}:${b.id}:${event.date || ''}`}`;
  if (events.has(eventId)) return;
  const completed = !!event.status?.type?.completed;
  const live = isLive(event);
  const scoreA = Number(a.score);
  const scoreB = Number(b.score);
  if (completed && (!Number.isFinite(scoreA) || !Number.isFinite(scoreB))) return;
  events.set(eventId, true);
  for (const [me, other, myScore, otherScore] of [[a, b, scoreA, scoreB], [b, a, scoreB, scoreA]]) {
    const team = teams.get(String(me.id));
    const opp = teams.get(String(other.id));
    const result = completed ? (myScore > otherScore ? 'W' : myScore < otherScore ? 'L' : 'T') : null;
    if (completed && actualType === 2 && result) {
      team[result.toLowerCase()] += 1;
      team.pf += myScore;
      team.pa += otherScore;
    }
    const opponentName = typeof other.team?.displayName === 'string' && other.team.displayName
      ? other.team.displayName
      : (opp.name || 'Opponent');
    team.games.push({
      id: `${eventId}:${team.id}`,
      type: actualType,
      date: event.date,
      opponent: opponentName,
      myName: typeof me.team?.displayName === 'string' && me.team.displayName ? me.team.displayName : team.name,
      myAbbr: me.team?.abbreviation || team.abbr || '',
      otherAbbr: other.team?.abbreviation || opp.abbr || '',
      myLogo: team.logo || httpUrl(me.team?.logo),
      otherLogo: opp.logo || httpUrl(other.team?.logo),
      away: me.homeAway === 'away',
      myScore: Number.isFinite(myScore) ? myScore : 0,
      otherScore: Number.isFinite(otherScore) ? otherScore : 0,
      result,
      completed,
      live,
      clock: clockLabel(event),
      round: playoffRound(event),
      week: weekNumber,
      tbd: actualType === 2 && !completed && weekNumber >= 17
    });
  }
}

export function computeStandings(teamsPayload, weekPayloads) {
  const rawTeams = teamsPayload?.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(rawTeams)) return { ok: false, error: 'Could not retrieve all 32 teams' };
  const teams = new Map();
  for (const item of rawTeams) {
    try {
      const raw = item && item.team;
      if (!raw) continue;
      const id = cleanTeamId(raw.id);
      if (!id || teams.has(id)) continue;
      const info = TEAM_INFO[id] || { conference: 'NFL', division: '', color: '#5b6b82', alt: '#8aa0bd', city: '' };
      const name = typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : 'Team';
      teams.set(id, {
        id,
        name,
        abbr: typeof raw.abbreviation === 'string' ? raw.abbreviation : '',
        logo: httpUrl(raw.logos?.[0]?.href || raw.logo || ''),
        color: cssColor(raw.color, info.color),
        alt: cssColor(raw.alternateColor, info.alt),
        conference: info.conference,
        division: info.division,
        city: info.city || '',
        w: 0, l: 0, t: 0, pf: 0, pa: 0,
        games: []
      });
    } catch { /* skip a bad team record */ }
  }
  if (teams.size < 32) return { ok: false, error: 'Could not retrieve all 32 teams' };

  const seen = new Map();
  let failures = 0;
  const weeks = Array.isArray(weekPayloads) ? weekPayloads : [];
  for (let index = 0; index < 23; index++) {
    const slot = weeks[index];
    const expectedType = index < 18 ? 2 : 3;
    const weekNumber = index < 18 ? index + 1 : index - 17;
    if (!slot || slot.ok === false) { failures += 1; continue; }
    const body = slot.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) { failures += 1; continue; }
    const list = body.events == null ? [] : body.events;
    if (!Array.isArray(list)) { failures += 1; continue; }
    for (const event of list) {
      try { ingestEvent(event, expectedType, weekNumber, teams, seen); }
      catch { /* one bad event does not drop the week */ }
    }
  }
  if (seen.size === 0) {
    return {
      ok: false,
      error: failures ? 'Could not load the weekly schedule' : 'No NFL schedule data available'
    };
  }
  const sorted = [...teams.values()].map(team => ({
    ...team,
    pct: winningPercentage(team.w, team.l, team.t)
  })).sort((a, b) => b.pct - a.pct || b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || a.name.localeCompare(b.name));
  return { ok: true, teams: sorted, failures, gameCount: seen.size };
}
