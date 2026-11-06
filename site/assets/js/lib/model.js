// The data model: people, the small index files, and which file holds what.
//
// Files (inside site/):
//   data/config.json                 public settings + the locked family key
//   data/public/index.json           summaries of PUBLIC people + links between them
//   data/public/people/<id>.json     full record of a public person
//   data/family/index/<00-0f>.enc    encrypted summaries/links involving family-level people (16 parts)
//   data/family/people/<id>.enc      encrypted full record of a family-level person
//   data/family/settings.enc         encrypted family-only settings (e.g. correction email)

export const SCRIPTS = ['latin', 'armenian', 'cyrillic'];
export const SCRIPT_LABELS = { latin: 'Latin (English)', armenian: 'Armenian', cyrillic: 'Cyrillic (Russian)' };
export const NAME_PARTS = ['first', 'patronymic', 'last', 'maiden'];
export const DEFAULT_SHARDS = 16;

export function newId(prefix = 'p') {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

/** Remove empty strings, empty arrays and empty objects (keeps files small and tidy). */
export function compact(value) {
  if (Array.isArray(value)) {
    const arr = value.map(compact).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === '' || value === undefined) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  return value;
}

export function emptyPerson() {
  return {
    id: newId('p'),
    privacy: 'family',
    living: false,
    placeholder: false,
    sex: 'unknown',
    names: {},
    nicknames: [],
    birth: {},
    death: {},
    occupation: '',
    education: '',
    languages: [],
    bio: '',
    stories: [],
    events: [],
    sources: [],
  };
}

/** Living people are always family-only, no matter what was chosen. */
export function effectivePrivacy(p) {
  return p.privacy === 'public' && !p.living ? 'public' : 'family';
}

/** Clean up a person before saving. */
export function normalizePerson(p) {
  const out = compact({ ...p, privacy: effectivePrivacy(p) }) || {};
  out.id = p.id;
  out.privacy = effectivePrivacy(p);
  out.living = !!p.living;
  if (p.placeholder) out.placeholder = true; else delete out.placeholder;
  if (out.living) delete out.death;
  return out;
}

const SUMMARY_FIELDS = ['id', 'privacy', 'living', 'placeholder', 'sex', 'names', 'nicknames', 'birth', 'death', 'photo'];

/** The small version of a person kept in the index (for search and the tree). */
export function summarize(person) {
  const p = normalizePerson(person);
  const s = {};
  for (const f of SUMMARY_FIELDS) if (p[f] !== undefined) s[f] = p[f];
  return s;
}

export function shardOf(id, count = DEFAULT_SHARDS) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % count;
}
export const shardName = (i) => i.toString(16).padStart(2, '0');

export const relPeople = (r) => (r.type === 'parent' ? [r.parent, r.child] : [r.a, r.b]);

/**
 * Split everything into what may be published openly and what must be encrypted.
 * A link is public only if every person in it is public.
 */
export function splitIndex(peopleMap, rels, shardCount = DEFAULT_SHARDS) {
  const pub = { v: 1, people: [], rels: [] };
  const shards = Array.from({ length: shardCount }, () => ({ people: [], rels: [] }));
  const isPub = (id) => peopleMap.get(id)?.privacy === 'public';
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  for (const s of [...peopleMap.values()].sort(byId)) {
    if (s.privacy === 'public') pub.people.push(s);
    else shards[shardOf(s.id, shardCount)].people.push(s);
  }
  for (const r of [...rels].sort(byId)) {
    const ids = relPeople(r);
    if (!ids.every((id) => peopleMap.has(id))) continue; // link to a deleted person
    if (ids.every(isPub)) pub.rels.push(r);
    else shards[shardOf(r.id, shardCount)].rels.push(r);
  }
  return { publicIndex: pub, familyShards: shards };
}

/** Combine the public index and decrypted family parts into one picture. */
export function mergeIndexes(publicIndex, familyShards = []) {
  const people = new Map();
  const rels = [];
  const relIds = new Set();
  for (const part of [publicIndex, ...familyShards]) {
    if (!part) continue;
    for (const s of part.people || []) people.set(s.id, s);
    for (const r of part.rels || []) {
      if (!relIds.has(r.id)) { relIds.add(r.id); rels.push(r); }
    }
  }
  return { people, rels: rels.filter((r) => relPeople(r).every((id) => people.has(id))) };
}

export function personPath(id, privacy) {
  return privacy === 'public' ? `data/public/people/${id}.json` : `data/family/people/${id}.enc`;
}
export const familyShardPath = (i) => `data/family/index/${shardName(i)}.enc`;
export const PUBLIC_INDEX_PATH = 'data/public/index.json';
export const CONFIG_PATH = 'data/config.json';
export const SETTINGS_PATH = 'data/family/settings.enc';

// ---------- names ----------

function fullName(n) {
  if (!n) return '';
  return [n.first, n.last].filter(Boolean).join(' ');
}

/** Main display name, trying Latin first, then Armenian, then Cyrillic. */
export function displayName(s, order = SCRIPTS) {
  for (const script of order) {
    const name = fullName(s?.names?.[script]);
    if (name) return name;
  }
  if (s?.nicknames?.length) return `“${s.nicknames[0]}”`;
  return s?.placeholder ? 'Unknown person' : 'Unnamed person';
}

/** Names in the other scripts, e.g. ["Հովհաննես Սամփլյան", "Ованес Сэмплян"]. */
export function otherNames(s, order = SCRIPTS) {
  const main = displayName(s, order);
  const out = [];
  for (const script of order) {
    const n = s?.names?.[script];
    const name = [n?.first, n?.patronymic, n?.last].filter(Boolean).join(' ');
    if (name && fullName(n) !== main && !out.includes(name)) out.push(name);
  }
  return out;
}

export function maidenName(s, order = SCRIPTS) {
  for (const script of order) {
    const m = s?.names?.[script]?.maiden;
    if (m) return m;
  }
  return '';
}

export function initials(s) {
  const hasName = SCRIPTS.some((sc) => s?.names?.[sc]?.first || s?.names?.[sc]?.last) || s?.nicknames?.length;
  if (!hasName) return '?';
  const n = displayName(s).replace(/[“”]/g, '');
  const parts = n.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

// ---------- search ----------

export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"'`’]/g, '');
}

function searchText(s) {
  const bits = [];
  for (const script of SCRIPTS) {
    const n = s.names?.[script];
    if (n) bits.push(n.first, n.patronymic, n.last, n.maiden);
  }
  bits.push(...(s.nicknames || []));
  return normalizeText(bits.filter(Boolean).join(' '));
}

/** Search-as-you-type over all names in all scripts. */
export function searchPeople(people, query, limit = 20) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  const list = people instanceof Map ? [...people.values()] : people;
  if (!words.length) return [];
  const results = [];
  for (const s of list) {
    const hay = searchText(s);
    const tokens = hay.split(/\s+/);
    let score = 0;
    let all = true;
    for (const w of words) {
      if (tokens.some((t) => t === w)) score += 3;
      else if (tokens.some((t) => t.startsWith(w))) score += 2;
      else if (hay.includes(w)) score += 1;
      else { all = false; break; }
    }
    if (all) results.push({ s, score });
  }
  results.sort((a, b) => b.score - a.score || displayName(a.s).localeCompare(displayName(b.s)));
  return results.slice(0, limit).map((r) => r.s);
}
