// Places and migrations: historical names, who lived where in a given year, family branches.
//
// A place (saved once, reused everywhere):
//   { id, name, lat?, lng?, names: [{ name, from?, to? }], countries: [{ country, from?, to? }], note? }
//   from/to are years; "from" is the first year, "to" the last year the name/country applied.
// A move (migration):
//   { id, people: [personIds], from: placeId, to: placeId, date, reason, story? }
// Anything that has a place stores { place: 'text', placeId?: 'id' }; the text is kept as a fallback.
import { estimateYear } from './dates.js';
import { normalizeText, SCRIPTS } from './model.js';

export const MOVE_REASONS = {
  work: 'Work',
  marriage: 'Marriage',
  study: 'Study',
  family: 'To join family',
  war: 'War',
  displacement: 'Forced displacement / deportation',
  refuge: 'Fled as a refugee',
  economic: 'Better life / economic',
  military: 'Military service',
  other: 'Other',
};

const inRange = (r, year) => (r.from == null || year >= r.from) && (r.to == null || year <= r.to);

/** The name a place had in a given year (falls back to its main name). */
export function placeNameAt(place, year) {
  if (!place) return '';
  if (year != null) {
    const hit = (place.names || []).find((n) => n.name && inRange(n, year));
    if (hit) return hit.name;
  }
  return place.name || '';
}

/** The country a place belonged to in a given year (or its latest known one). */
export function countryAt(place, year) {
  const list = (place?.countries || []).filter((c) => c.country);
  if (!list.length) return '';
  if (year != null) {
    const hit = list.find((c) => inRange(c, year));
    if (hit) return hit.country;
    return '';
  }
  // No year: the current one (open-ended "to"), else the last listed.
  return (list.find((c) => c.to == null) || list[list.length - 1]).country;
}

/** "Tiflis, Russian Empire" for 1910; "Tbilisi, Georgia" today. */
export function placeLabel(place, year) {
  const name = placeNameAt(place, year);
  const country = countryAt(place, year);
  return country && country !== name ? `${name}, ${country}` : name;
}

/** All names a place has had, for search and display. */
export function allPlaceNames(place) {
  return [...new Set([place.name, ...(place.names || []).map((n) => n.name)].filter(Boolean))];
}

/**
 * Text to show for anything with a place: uses the saved place's name for that
 * date when linked, otherwise the plain text.
 */
export function placeText(obj, places, date) {
  if (!obj) return '';
  const p = obj.placeId && places?.get(obj.placeId);
  if (p) return placeLabel(p, estimateYear(date));
  return obj.place || '';
}

export function searchPlaces(places, query, limit = 8) {
  const q = normalizeText(query).trim();
  if (!q) return [];
  const list = places instanceof Map ? [...places.values()] : places;
  const scored = [];
  for (const p of list) {
    const names = allPlaceNames(p).map(normalizeText);
    const countries = (p.countries || []).map((c) => normalizeText(c.country));
    let score = 0;
    if (names.some((n) => n === q)) score = 4;
    else if (names.some((n) => n.startsWith(q))) score = 3;
    else if (names.some((n) => n.includes(q))) score = 2;
    else if (countries.some((c) => c.includes(q))) score = 1;
    if (score) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((x) => x.p);
}

export const hasCoords = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

// ---------- where people lived ----------

/** Place ids a person record refers to anywhere (birth, death, events). */
export function personPlaceRefs(person) {
  const ids = new Set();
  for (const x of [person.birth, person.death, ...(person.events || [])]) if (x?.placeId) ids.add(x.placeId);
  return [...ids];
}

/** Residence facts from a person's own events ("Lived in" / "Moved" with a saved place). */
export function personLived(person) {
  return (person.events || [])
    .filter((e) => e.placeId && (e.type === 'residence' || e.type === 'move'))
    .map((e) => ({ placeId: e.placeId, date: e.date }));
}

/** Moves grouped by person id. */
export function movesByPerson(moves) {
  const map = new Map();
  for (const m of moves instanceof Map ? moves.values() : moves) {
    for (const pid of m.people || []) {
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(m);
    }
  }
  return map;
}

/**
 * Known locations of a person over time, oldest first:
 * [{ year, placeId, kind: 'birth' | 'lived' | 'move' | 'death', move? }]
 */
export function lifePlaces(s, moves = []) {
  const out = [];
  const by = estimateYear;
  if (s.birth?.placeId) out.push({ year: by(s.birth.date), placeId: s.birth.placeId, kind: 'birth' });
  for (const l of s.lived || []) out.push({ year: by(l.date), placeId: l.placeId, kind: 'lived' });
  for (const m of moves) {
    const y = by(m.date);
    if (m.from) out.push({ year: y, placeId: m.from, kind: 'left', move: m, before: true });
    if (m.to) out.push({ year: y, placeId: m.to, kind: 'move', move: m });
  }
  if (!s.living && s.death?.placeId) out.push({ year: by(s.death.date), placeId: s.death.placeId, kind: 'death' });
  const order = { birth: 0, left: 1, lived: 2, move: 3, death: 4 };
  return out.sort((a, b) => {
    if (a.year == null && b.year == null) return order[a.kind] - order[b.kind];
    if (a.year == null) return a.kind === 'birth' ? -1 : 1;
    if (b.year == null) return b.kind === 'birth' ? 1 : -1;
    return a.year - b.year || order[a.kind] - order[b.kind];
  });
}

/** Was this person alive in that year? true / false, or null when we can't tell. */
export function aliveIn(s, year) {
  const b = estimateYear(s.birth?.date);
  const d = estimateYear(s.death?.date);
  if (b != null && year < b) return false;
  if (s.living) return b != null ? true : year >= new Date().getFullYear() - 100;
  if (d != null) return year <= d;
  if (b != null) return year <= b + 100; // death not recorded: assume at most 100 years
  return null;
}

/** Where was this person in that year? Returns a place id or null. */
export function whereIn(s, year, moves = []) {
  if (aliveIn(s, year) === false) return null;
  const events = lifePlaces(s, moves).filter((e) => e.year != null);
  let here = null;
  for (const e of events) {
    if (e.year > year) {
      // Before their first recorded move we know where they came from.
      if (here == null && e.kind === 'left') here = e.placeId;
      break;
    }
    here = e.placeId;
  }
  if (here == null) {
    // Undated birth place still tells us something for early years.
    const birth = lifePlaces(s, moves).find((e) => e.kind === 'birth');
    if (birth && events.every((e) => e.year > year)) here = birth.placeId;
  }
  return here;
}

/** Everyone's location in a year: Map placeId -> [personId]. */
export function whoWhereIn(people, moves, year) {
  const byPerson = movesByPerson(moves);
  const out = new Map();
  for (const s of people.values()) {
    if (s.placeholder) continue;
    const pid = whereIn(s, year, byPerson.get(s.id) || []);
    if (!pid) continue;
    if (!out.has(pid)) out.set(pid, []);
    out.get(pid).push(s.id);
  }
  return out;
}

/** Earliest and latest years worth showing on the slider. */
export function yearRange(people, moves) {
  const years = [];
  for (const s of people.values()) {
    for (const d of [s.birth?.date, s.death?.date]) { const y = estimateYear(d); if (y != null) years.push(y); }
  }
  for (const m of moves instanceof Map ? moves.values() : moves) { const y = estimateYear(m.date); if (y != null) years.push(y); }
  if (!years.length) return null;
  const now = new Date().getFullYear();
  const anyLiving = [...people.values()].some((s) => s.living);
  return { min: Math.min(...years), max: anyLiving ? now : Math.min(now, Math.max(...years)) };
}

/**
 * Everyone and everything connected to a place:
 * [{ personId?, photoId?, moveId?, role, date }]
 */
export function placeConnections(placeId, { people, rels = [], photos = new Map(), moves = [] }) {
  const out = [];
  for (const s of people.values()) {
    if (s.birth?.placeId === placeId) out.push({ personId: s.id, role: 'born', date: s.birth.date });
    if (!s.living && s.death?.placeId === placeId) out.push({ personId: s.id, role: 'died', date: s.death.date });
    for (const l of s.lived || []) if (l.placeId === placeId) out.push({ personId: s.id, role: 'lived', date: l.date });
    const known = new Set(out.filter((c) => c.personId === s.id).map((c) => c.role));
    if (!known.size && (s.placeRefs || []).includes(placeId)) out.push({ personId: s.id, role: 'mentioned' });
  }
  for (const m of moves instanceof Map ? moves.values() : moves) {
    for (const pid of m.people || []) {
      if (m.to === placeId) out.push({ personId: pid, role: 'arrived', date: m.date, moveId: m.id });
      if (m.from === placeId) out.push({ personId: pid, role: 'left', date: m.date, moveId: m.id });
    }
  }
  for (const r of rels) {
    if (r.type === 'spouse' && r.placeId === placeId) {
      out.push({ personId: r.a, role: 'married', date: r.start }, { personId: r.b, role: 'married', date: r.start });
    }
  }
  for (const ph of photos.values()) if (ph.placeId === placeId) out.push({ photoId: ph.id, role: 'photo', date: ph.date });
  return out.filter((c) => !c.personId || people.has(c.personId));
}

// ---------- family branches (for colours on the map) ----------

export const BRANCH_COLORS = ['#2f5d50', '#b5643c', '#4a6fa5', '#8e5a9b', '#c08a3e', '#3d8b8b', '#a63d40', '#6b7a3a', '#5c6b73', '#b07aa1'];

/** A person's family branch = their birth surname (maiden name if known). */
export function branchOf(s) {
  for (const script of SCRIPTS) {
    const n = s?.names?.[script];
    if (n?.maiden) return n.maiden.trim();
    if (n?.last) return n.last.trim();
  }
  return '';
}

/** Give each branch a colour; the biggest branches get the first colours. */
export function branchColors(people) {
  const counts = new Map();
  for (const s of people.values()) {
    const b = branchOf(s);
    if (b) counts.set(b, (counts.get(b) || 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const colors = new Map();
  sorted.forEach(([b], i) => colors.set(b, BRANCH_COLORS[i % BRANCH_COLORS.length]));
  return { colors, order: sorted.map(([b, n]) => ({ branch: b, count: n, color: colors.get(b) })) };
}
