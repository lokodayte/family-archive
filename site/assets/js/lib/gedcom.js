// GEDCOM 5.5.1: the standard file format genealogy programs use to exchange family trees
// (Ancestry, MyHeritage, FamilySearch, Gramps, RootsMagic...).
import { parseDate, MONTHS, estimateYear } from './dates.js';
import { SCRIPTS, newId, displayName } from './model.js';
import { placeLabel, hasCoords } from './places.js';
import { findProblems } from './relations.js';

const GED_MONTHS = MONTHS.map((m) => m.slice(0, 3).toUpperCase());

// ---------- dates ----------

function pointToGed(p) {
  const [y, m, d] = p.split('-').map(Number);
  if (m == null) return String(y);
  if (d == null) return `${GED_MONTHS[m - 1]} ${y}`;
  return `${d} ${GED_MONTHS[m - 1]} ${y}`;
}

export function dateToGedcom(v) {
  if (!v) return null;
  switch (v.type) {
    case 'exact': return pointToGed(v.date);
    case 'about': return `ABT ${pointToGed(v.date)}`;
    case 'before': return `BEF ${pointToGed(v.date)}`;
    case 'after': return `AFT ${pointToGed(v.date)}`;
    case 'between': return `BET ${pointToGed(v.from)} AND ${pointToGed(v.to)}`;
    default: return null;
  }
}

/** GEDCOM date text -> stored date (or null if it can't be read). */
export function dateFromGedcom(text) {
  if (!text) return null;
  let s = String(text).trim().toUpperCase()
    .replace(/^INT\s+/, '')
    .replace(/\(.*\)/g, '')
    .replace(/(\d{3,4})\/\d{1,2}\b/g, '$1') // dual dating 1720/21
    .replace(/@#DGREGORIAN@\s*/g, '')
    .trim();
  if (!s) return null;
  s = s
    .replace(/^(ABT|ABOUT|CAL|EST|CIRCA|C\.)\s+/, 'about ')
    .replace(/^BEF\s+/, 'before ')
    .replace(/^AFT\s+/, 'after ')
    .replace(/^BET\s+(.+)\s+AND\s+(.+)$/, 'between $1 and $2')
    .replace(/^FROM\s+(.+)\s+TO\s+(.+)$/, 'between $1 and $2')
    .replace(/^FROM\s+/, 'after ')
    .replace(/^TO\s+/, 'before ');
  const r = parseDate(s.toLowerCase());
  return r.ok ? r.value : null;
}

// ---------- writing ----------

const MAX_LINE = 200;

function lines(level, tag, value, out) {
  if (value == null || value === '') { out.push(`${level} ${tag}`); return; }
  const text = String(value).replace(/\r/g, '');
  text.split('\n').forEach((para, i) => {
    let rest = para;
    let first = true;
    do {
      const chunk = rest.slice(0, MAX_LINE);
      rest = rest.slice(MAX_LINE);
      if (i === 0 && first) out.push(`${level} ${tag} ${chunk}`.trimEnd());
      else out.push(`${level + 1} ${first ? 'CONT' : 'CONC'} ${chunk}`.trimEnd());
      first = false;
    } while (rest.length);
  });
}

const coord = (v, pos, neg) => `${v >= 0 ? pos : neg}${Math.abs(v).toFixed(5)}`;

const EVENT_EXPORT = {
  residence: ['RESI'],
  religious: ['BAPM'],
  military: ['EVEN', 'Military service'],
  education: ['EVEN', 'Education'],
  work: ['EVEN', 'Work'],
  award: ['EVEN', 'Award'],
  move: ['EVEN', 'Moved'],
  other: ['EVEN', 'Event'],
};

/**
 * people: Map id -> full person record; rels, places (Map), moves (Map).
 * Returns { text, warnings }.
 */
export function exportGedcom({ people, rels, places = new Map(), moves = new Map(), title = 'Family archive' }) {
  const out = [];
  const warnings = [];
  const ids = [...people.keys()].sort();
  const xref = new Map(ids.map((id, i) => [id, `@I${i + 1}@`]));
  const now = new Date();
  out.push('0 HEAD', '1 SOUR FAMILY_ARCHIVE', `2 NAME ${title}`, '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
    `1 DATE ${now.getDate()} ${GED_MONTHS[now.getMonth()]} ${now.getFullYear()}`);

  // Families: one per couple (married or not), plus single-parent families.
  const fams = [];
  const famByKey = new Map();
  const famOf = (a, b) => {
    const key = [a, b].filter(Boolean).sort().join('+');
    if (!famByKey.has(key)) {
      const f = { xref: `@F${fams.length + 1}@`, parents: [a, b].filter(Boolean), children: [], marriage: null };
      fams.push(f);
      famByKey.set(key, f);
    }
    return famByKey.get(key);
  };
  for (const r of rels) if (r.type === 'spouse' && people.has(r.a) && people.has(r.b)) famOf(r.a, r.b).marriage = r;
  const parentLinks = new Map();
  for (const r of rels) {
    if (r.type !== 'parent' || !people.has(r.parent) || !people.has(r.child)) continue;
    if (r.kind === 'step') { warnings.push(`Step-parent link of ${displayName(people.get(r.child))} is not part of the GEDCOM standard and was left out.`); continue; }
    if (!parentLinks.has(r.child)) parentLinks.set(r.child, []);
    parentLinks.get(r.child).push(r);
  }
  const famc = new Map(); // child -> [{fam, kind}]
  for (const [child, links] of parentLinks) {
    const byKind = new Map();
    for (const l of links) { if (!byKind.has(l.kind || 'birth')) byKind.set(l.kind || 'birth', []); byKind.get(l.kind || 'birth').push(l.parent); }
    for (const [kind, parents] of byKind) {
      const f = famOf(parents[0], parents[1]);
      f.children.push(child);
      if (!famc.has(child)) famc.set(child, []);
      famc.get(child).push({ fam: f, kind });
    }
  }

  const placeLines = (level, obj, date) => {
    const pl = obj?.placeId && places.get(obj.placeId);
    const text = pl ? placeLabel(pl, estimateYear(date)) : obj?.place;
    if (!text) return [];
    const res = [];
    lines(level, 'PLAC', text, res);
    if (pl && hasCoords(pl)) res.push(`${level + 1} MAP`, `${level + 2} LATI ${coord(pl.lat, 'N', 'S')}`, `${level + 2} LONG ${coord(pl.lng, 'E', 'W')}`);
    return res;
  };
  const event = (tag, obj, type) => {
    const date = dateToGedcom(obj?.date);
    const res = [`1 ${tag}`];
    if (type) res.push(`2 TYPE ${type}`);
    if (date) res.push(`2 DATE ${date}`);
    res.push(...placeLines(2, obj, obj?.date));
    return res;
  };

  for (const id of ids) {
    const p = people.get(id);
    out.push(`0 ${xref.get(id)} INDI`);
    const names = SCRIPTS.filter((sc) => p.names?.[sc] && (p.names[sc].first || p.names[sc].last || p.names[sc].patronymic));
    names.forEach((sc, i) => {
      const n = p.names[sc];
      const given = [n.first, n.patronymic].filter(Boolean).join(' ');
      out.push(`1 NAME ${given} /${n.last || ''}/`.replace(/\s+/g, ' ').trim());
      if (i > 0) out.push('2 TYPE aka');
      if (n.first) out.push(`2 GIVN ${n.first}`);
      if (n.last) out.push(`2 SURN ${n.last}`);
      if (n.patronymic) out.push(`2 _PATRONYMIC ${n.patronymic}`);
      out.push(`2 _SCRIPT ${sc}`);
      if (i === 0) for (const nick of p.nicknames || []) out.push(`2 NICK ${nick}`);
      if (n.maiden) out.push(`1 NAME ${n.first || ''} /${n.maiden}/`.replace(/\s+/g, ' '), '2 TYPE maiden', `2 _SCRIPT ${sc}`);
    });
    if (!names.length) out.push('1 NAME /Unknown/');
    out.push(`1 SEX ${{ male: 'M', female: 'F' }[p.sex] || 'U'}`);
    if (p.placeholder) out.push('1 _PLACEHOLDER Y');
    if (p.birth?.date || p.birth?.place || p.birth?.placeId) out.push(...event('BIRT', p.birth));
    if (!p.living) {
      if (p.death?.date || p.death?.place || p.death?.placeId) out.push(...event('DEAT', p.death));
      else out.push('1 DEAT Y');
    }
    if (p.occupation) lines(1, 'OCCU', p.occupation, out);
    if (p.education) lines(1, 'EDUC', p.education, out);
    if (p.languages?.length) out.push(`1 _LANGUAGES ${p.languages.join(', ')}`);
    for (const e of p.events || []) {
      const [tag, type] = EVENT_EXPORT[e.type] || EVENT_EXPORT.other;
      out.push(...event(tag, e, type));
      if (e.description) lines(2, 'NOTE', e.description, out);
    }
    for (const m of moves.values()) {
      if (!m.people?.includes(id)) continue;
      out.push(...event('EVEN', { date: m.date, placeId: m.to }, 'Migration'));
      const from = places.get(m.from);
      const note = [from ? `From ${placeLabel(from, estimateYear(m.date))}.` : '', m.reason ? `Reason: ${m.reason}.` : '', m.story || ''].filter(Boolean).join(' ');
      if (note) lines(2, 'NOTE', note, out);
    }
    if (p.bio) lines(1, 'NOTE', p.bio, out);
    for (const st of p.stories || []) lines(1, 'NOTE', [st.title, st.text].filter(Boolean).join('\n'), out);
    for (const src of p.sources || []) {
      lines(1, 'SOUR', src.citation || src.fact || 'Source', out);
      if (src.fact) lines(2, 'NOTE', `Fact: ${src.fact}`, out);
      if (src.confidence) out.push(`2 QUAY ${{ low: 1, medium: 2, high: 3 }[src.confidence] ?? 2}`);
    }
    for (const { fam, kind } of famc.get(id) || []) {
      out.push(`1 FAMC ${fam.xref}`);
      out.push(`2 PEDI ${{ adoptive: 'adopted', foster: 'foster' }[kind] || 'birth'}`);
    }
    for (const f of fams) if (f.parents.includes(id)) out.push(`1 FAMS ${f.xref}`);
  }

  for (const f of fams) {
    out.push(`0 ${f.xref} FAM`);
    const [a, b] = f.parents;
    const sexOf = (pid) => people.get(pid)?.sex;
    let husb = a;
    let wife = b;
    if (sexOf(a) === 'female' || sexOf(b) === 'male') { husb = b; wife = a; }
    if (husb) out.push(`1 HUSB ${xref.get(husb)}`);
    if (wife) out.push(`1 WIFE ${xref.get(wife)}`);
    for (const c of f.children) out.push(`1 CHIL ${xref.get(c)}`);
    if (f.marriage) {
      out.push(...event('MARR', { date: f.marriage.start, place: f.marriage.place, placeId: f.marriage.placeId }));
      if (f.marriage.endReason === 'divorce') {
        out.push('1 DIV');
        const d = dateToGedcom(f.marriage.end);
        if (d) out.push(`2 DATE ${d}`);
      }
    }
  }
  out.push('0 TRLR');
  return { text: `${out.join('\n')}\n`, warnings: [...new Set(warnings)] };
}

// ---------- reading ----------

/** Parse GEDCOM text into a tree of { tag, value, xref, children }. */
export function parseGedcomTree(text) {
  const root = { tag: 'ROOT', children: [] };
  const stack = [root];
  const src = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (const raw of src) {
    const line = raw.replace(/^\s+/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = Number(m[1]);
    const node = { tag: m[3].toUpperCase(), value: m[4] ?? '', xref: m[2] || null, children: [] };
    const parent = stack[Math.min(level, stack.length - 1)];
    if (node.tag === 'CONC') { parent.value += node.value; continue; }
    if (node.tag === 'CONT') { parent.value += `\n${node.value}`; continue; }
    parent.children.push(node);
    stack.length = level + 1;
    stack[level + 1] = node;
  }
  return root;
}

const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
const kid = (n, tag) => n.children.find((c) => c.tag === tag);
const val = (n, tag) => kid(n, tag)?.value?.trim() || '';

function scriptOf(text) {
  if (/[԰-֏ﬓ-ﬗ]/.test(text)) return 'armenian';
  if (/[Ѐ-ӿ]/.test(text)) return 'cyrillic';
  return 'latin';
}

const EVENT_IMPORT = [
  [/migrat|emigrat|immigrat|moved|move/i, 'move'],
  [/milit|army|war|service/i, 'military'],
  [/educ|school|universit|graduat/i, 'education'],
  [/work|job|employ|occupation/i, 'work'],
  [/award|medal|honou?r/i, 'award'],
];

/**
 * Turn a GEDCOM file into people, relationships and places ready to add.
 * Everyone comes in as family-only. Returns { people, rels, places, warnings, stats }.
 */
export function importGedcom(text) {
  const tree = parseGedcomTree(text);
  const warnings = [];
  const records = new Map();
  for (const r of tree.children) if (r.xref) records.set(r.xref, r);
  const resolveNote = (n) => (n.value?.startsWith('@') ? records.get(n.value.trim())?.value || '' : n.value || '');

  // Places, saved once each.
  const places = new Map();
  const placeByText = new Map();
  const placeFor = (node) => {
    const plac = kid(node, 'PLAC');
    const textValue = plac?.value?.trim();
    if (!textValue) return {};
    let pl = placeByText.get(textValue.toLowerCase());
    if (!pl) {
      const parts = textValue.split(',').map((x) => x.trim()).filter(Boolean);
      pl = { id: newId('l'), name: parts[0] || textValue };
      if (parts.length > 1) pl.countries = [{ country: parts[parts.length - 1] }];
      placeByText.set(textValue.toLowerCase(), pl);
      places.set(pl.id, pl);
    }
    const map = kid(plac, 'MAP');
    if (map && !hasCoords(pl)) {
      const num = (s) => { const m2 = String(s || '').match(/^([NSEW])?\s*(-?[\d.]+)/i); if (!m2) return NaN; const v = Number(m2[2]); return /[SW]/i.test(m2[1] || '') ? -v : v; };
      const lat = num(val(map, 'LATI'));
      const lng = num(val(map, 'LONG'));
      if (Number.isFinite(lat) && Number.isFinite(lng)) { pl.lat = lat; pl.lng = lng; }
    }
    return { place: textValue, placeId: pl.id };
  };
  const dateOf = (node) => {
    const raw = val(node, 'DATE');
    if (!raw) return undefined;
    const d = dateFromGedcom(raw);
    if (!d) warnings.push(`Could not read the date “${raw}”; it was left out.`);
    return d || undefined;
  };

  const people = [];
  const idOf = new Map();
  const famcKind = new Map(); // `${indiXref}|${famXref}` -> kind
  const thisYear = new Date().getFullYear();

  for (const rec of tree.children.filter((r) => r.tag === 'INDI')) {
    const p = {
      id: newId('p'), privacy: 'family', living: false, sex: 'unknown', names: {}, nicknames: [],
      birth: {}, death: {}, languages: [], events: [], sources: [], stories: [],
    };
    idOf.set(rec.xref, p.id);
    for (const n of kids(rec, 'NAME')) {
      const m = n.value.match(/^(.*?)\/(.*?)\/(.*)$/);
      let given = (m ? `${m[1]} ${m[3]}` : n.value).replace(/\s+/g, ' ').trim();
      let surname = (m ? m[2] : '').trim();
      if (val(n, 'GIVN')) given = val(n, 'GIVN');
      if (val(n, 'SURN')) surname = val(n, 'SURN');
      const patronymic = val(n, '_PATRONYMIC');
      if (patronymic && given.endsWith(patronymic)) given = given.slice(0, -patronymic.length).trim();
      const type = val(n, 'TYPE').toLowerCase();
      const sc = SCRIPTS.includes(val(n, '_SCRIPT')) ? val(n, '_SCRIPT') : scriptOf(`${given}${surname}`);
      const slot = p.names[sc] || (p.names[sc] = {});
      for (const nick of kids(n, 'NICK')) if (nick.value) p.nicknames.push(nick.value.trim());
      if (surname.toLowerCase() === 'unknown' && !given) continue;
      if (type === 'maiden' || type === 'birth') {
        if (slot.last || slot.first) { if (surname && surname !== slot.last) slot.maiden = surname; } else { slot.first = given; slot.last = surname; }
      } else if (type === 'married') {
        if (slot.last && slot.last !== surname) slot.maiden ||= slot.last;
        slot.last = surname;
        slot.first ||= given;
      } else if (!slot.first && !slot.last) {
        slot.first = given; slot.last = surname;
        if (patronymic) slot.patronymic = patronymic;
      }
    }
    for (const sc of Object.keys(p.names)) {
      for (const k of Object.keys(p.names[sc])) if (!p.names[sc][k]) delete p.names[sc][k];
      if (!Object.keys(p.names[sc]).length) delete p.names[sc];
    }
    p.sex = { M: 'male', F: 'female' }[val(rec, 'SEX').toUpperCase()] || 'unknown';
    if (val(rec, '_PLACEHOLDER')) p.placeholder = true;
    const birth = kid(rec, 'BIRT') || kid(rec, 'CHR') || kid(rec, 'BAPM');
    if (birth) p.birth = { date: dateOf(birth), ...placeFor(birth) };
    const death = kid(rec, 'DEAT') || kid(rec, 'BURI');
    if (death) p.death = { date: dateOf(death), ...placeFor(death) };
    const by = estimateYear(p.birth.date);
    p.living = !death && by != null && by > thisYear - 100;
    p.occupation = kids(rec, 'OCCU').map((o) => o.value.trim()).filter(Boolean).join('; ');
    p.education = kids(rec, 'EDUC').map((o) => o.value.trim()).filter(Boolean).join('; ');
    if (val(rec, '_LANGUAGES')) p.languages = val(rec, '_LANGUAGES').split(',').map((x) => x.trim()).filter(Boolean);
    for (const e of [...kids(rec, 'RESI'), ...kids(rec, 'EVEN'), ...(kid(rec, 'BIRT') ? kids(rec, 'BAPM').concat(kids(rec, 'CHR')) : [])]) {
      const typeText = val(e, 'TYPE');
      let type = e.tag === 'RESI' ? 'residence' : e.tag === 'EVEN' ? 'other' : 'religious';
      if (e.tag === 'EVEN') for (const [re, t2] of EVENT_IMPORT) if (re.test(typeText)) { type = t2; break; }
      const notes = kids(e, 'NOTE').map(resolveNote).filter(Boolean);
      const description = [type === 'other' && typeText ? typeText : '', e.value, ...notes].filter(Boolean).join(' — ');
      p.events.push({ id: newId('e'), type, date: dateOf(e), ...placeFor(e), description });
    }
    const notes = kids(rec, 'NOTE').map(resolveNote).map((x) => x.trim()).filter(Boolean);
    if (notes.length) p.bio = notes.join('\n\n');
    for (const s of kids(rec, 'SOUR')) {
      const ref = s.value?.startsWith('@') ? records.get(s.value.trim()) : null;
      const citation = [ref ? (val(ref, 'TITL') || val(ref, 'ABBR') || ref.value) : s.value, val(s, 'PAGE')].filter(Boolean).join(', ');
      const factNote = kids(s, 'NOTE').map(resolveNote).join(' ').replace(/^Fact:\s*/, '');
      const q = Number(val(s, 'QUAY'));
      p.sources.push({ id: newId('s'), citation, fact: factNote || undefined, type: 'record', confidence: q >= 3 ? 'high' : q === 2 ? 'medium' : Number.isFinite(q) && val(s, 'QUAY') ? 'low' : 'medium' });
    }
    for (const fc of kids(rec, 'FAMC')) {
      const pedi = val(fc, 'PEDI').toLowerCase();
      famcKind.set(`${rec.xref}|${fc.value.trim()}`, pedi === 'adopted' ? 'adoptive' : pedi === 'foster' ? 'foster' : 'birth');
    }
    people.push(p);
  }

  // Families -> marriages and parent links.
  const rels = [];
  for (const fam of tree.children.filter((r) => r.tag === 'FAM')) {
    const parents = [val(fam, 'HUSB'), val(fam, 'WIFE')].map((x) => idOf.get(x)).filter(Boolean);
    if (parents.length === 2) {
      const marr = kid(fam, 'MARR');
      const div = kid(fam, 'DIV');
      const r = { id: newId('r'), type: 'spouse', a: parents[0], b: parents[1] };
      if (marr) { const d = dateOf(marr); if (d) r.start = d; Object.assign(r, placeFor(marr)); }
      if (div) { r.endReason = 'divorce'; const d = dateOf(div); if (d) r.end = d; }
      rels.push(r);
    }
    for (const c of kids(fam, 'CHIL')) {
      const child = idOf.get(c.value.trim());
      if (!child) continue;
      const kind = famcKind.get(`${c.value.trim()}|${fam.xref}`) || 'birth';
      for (const parent of parents) rels.push({ id: newId('r'), type: 'parent', parent, child, kind });
    }
  }
  // Leave out anything impossible (e.g. someone their own ancestor) instead of failing.
  const bad = new Set(findProblems(rels).map((x) => x.rel));
  if (bad.size) warnings.push(`${bad.size} impossible family link(s) were left out.`);
  const cleanRels = rels.filter((r) => !bad.has(r));
  for (const p of people) {
    if (p.birth && !p.birth.date) delete p.birth.date;
    if (p.death && !p.death.date) delete p.death.date;
    for (const e of p.events) if (!e.date) delete e.date;
  }
  return {
    people, rels: cleanRels, places: [...places.values()], warnings: [...new Set(warnings)],
    stats: { people: people.length, families: tree.children.filter((r) => r.tag === 'FAM').length, places: places.size },
  };
}
