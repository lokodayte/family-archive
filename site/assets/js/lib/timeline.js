// A person's life timeline, built from their own events plus family links.
import { sortKey, formatYear } from './dates.js';

export const EVENT_TYPES = {
  residence: 'Lived in',
  move: 'Moved',
  military: 'Military service',
  education: 'Education',
  work: 'Work',
  religious: 'Baptism / religious event',
  award: 'Award / honour',
  other: 'Other event',
};

/** "1880 – 1951", "b. 1945", "c. 1885 – 1915" */
export function lifespan(s) {
  const b = formatYear(s?.birth?.date);
  const d = formatYear(s?.death?.date);
  if (s?.living) return b ? `b. ${b}` : '';
  if (b && d) return `${b} – ${d}`;
  if (b) return `${b} – ?`;
  if (d) return `? – ${d}`;
  return '';
}

/**
 * Build the timeline: birth, marriages, divorces, children, own events, death.
 * Undated events keep their natural place: birth first, death last, others in between.
 */
export function buildTimeline(person, { graph, people, moves = [] }) {
  const items = [];
  const add = (item, fallback) => items.push({ ...item, _k: sortKey(item.date), _f: fallback, _i: items.length });

  if (person.birth?.date || person.birth?.place) add({ type: 'birth', date: person.birth.date, place: person.birth.place, placeId: person.birth.placeId }, -1);

  for (const sp of graph.spousesOf(person.id)) {
    const r = sp.rel;
    add({ type: 'marriage', date: r.start, place: r.place, placeId: r.placeId, personId: sp.id }, 0);
    if (r.end && r.endReason === 'divorce') add({ type: 'divorce', date: r.end, personId: sp.id }, 0);
  }
  for (const c of graph.childrenOf(person.id)) {
    const child = people.get(c.id);
    if (!child) continue;
    add({ type: 'child', date: child.birth?.date, place: child.birth?.place, placeId: child.birth?.placeId, personId: c.id, kind: c.kind }, 0);
  }
  for (const m of moves instanceof Map ? moves.values() : moves) {
    if (!m.people?.includes(person.id)) continue;
    add({
      type: 'migration', date: m.date, from: m.from, to: m.to, reason: m.reason, text: m.story, moveId: m.id,
      with: m.people.filter((id) => id !== person.id),
    }, 0);
  }
  for (const e of person.events || []) {
    add({ type: e.type || 'other', date: e.date, place: e.place, placeId: e.placeId, text: e.description, own: true }, 0);
  }
  if (!person.living && (person.death?.date || person.death?.place)) {
    add({ type: 'death', date: person.death.date, place: person.death.place, placeId: person.death.placeId }, 1);
  }

  // Groups: undated birth (-1), dated events in date order (0),
  // other undated events (0.5), undated death (1).
  const group = (it) => (it._k != null ? 0 : it._f === 0 ? 0.5 : it._f);
  items.sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0 && a._k !== b._k) return a._k - b._k;
    return a._i - b._i;
  });
  return items.map(({ _k, _f, _i, ...rest }) => rest);
}
