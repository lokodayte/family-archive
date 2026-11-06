// Gallery logic: sorting and filtering photos by person, place, decade and kind.
import { estimateYear, compareDates } from './dates.js';

export function decadeOf(date) {
  const y = estimateYear(date);
  return y == null ? null : Math.floor(y / 10) * 10;
}

const placeKey = (p) => String(p || '').trim().toLowerCase();

/** Oldest first; undated photos at the end. */
export function sortPhotos(photos) {
  return [...photos].sort((a, b) => compareDates(a.date, b.date) || String(a.id).localeCompare(String(b.id)));
}

/**
 * filters: { person?: id, place?: text, decade?: number | 'undated', kind?: 'photo' | 'document' }
 */
export function filterPhotos(photos, filters = {}) {
  const { person, place, decade, kind } = filters;
  return sortPhotos([...photos].filter((p) => {
    if (person && !p.tags?.some((t) => t.person === person)) return false;
    if (place && placeKey(p.place) !== placeKey(place)) return false;
    if (kind && (p.kind || 'photo') !== kind) return false;
    if (decade === 'undated') return decadeOf(p.date) == null;
    if (decade != null && decade !== '' && decadeOf(p.date) !== Number(decade)) return false;
    return true;
  }));
}

/** The choices to show in the filter menus, with counts. */
export function galleryFacets(photos) {
  const places = new Map();
  const decades = new Map();
  const people = new Map();
  let undated = 0;
  for (const p of photos) {
    if (p.place) {
      const k = placeKey(p.place);
      const cur = places.get(k) || { label: p.place.trim(), count: 0 };
      cur.count++;
      places.set(k, cur);
    }
    const d = decadeOf(p.date);
    if (d == null) undated++;
    else decades.set(d, (decades.get(d) || 0) + 1);
    for (const t of p.tags || []) people.set(t.person, (people.get(t.person) || 0) + 1);
  }
  return {
    places: [...places.values()].sort((a, b) => a.label.localeCompare(b.label)),
    decades: [...decades].sort((a, b) => a[0] - b[0]).map(([decade, count]) => ({ decade, count })),
    undated,
    people,
  };
}
