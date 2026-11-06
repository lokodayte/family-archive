// Flexible genealogy dates.
//
// A stored date is one of:
//   { type: 'exact',   date: '1920' | '1920-05' | '1920-05-03' }
//   { type: 'about',   date: ... }
//   { type: 'before',  date: ... }
//   { type: 'after',   date: ... }
//   { type: 'between', from: ..., to: ... }
//   { type: 'unknown' }
// or null when nothing was entered.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const MONTH_LOOKUP = {};
MONTHS.forEach((m, i) => {
  MONTH_LOOKUP[m.toLowerCase()] = i + 1;
  MONTH_LOOKUP[m.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_LOOKUP.sept = 9;

const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

function makePoint(y, m, d) {
  y = Number(y);
  if (!Number.isInteger(y) || y < 100 || y > 2200) return null;
  if (m == null) return pad4(y);
  m = Number(m);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (d == null) return `${pad4(y)}-${pad2(m)}`;
  d = Number(d);
  if (!Number.isInteger(d) || d < 1 || d > daysIn(y, m)) return null;
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

const monthNum = (name) => MONTH_LOOKUP[name.toLowerCase().replace(/\.$/, '')];

/** Parse a single point in time ("1920", "May 1920", "3 May 1920", "1920-05-03", "03.05.1920"). */
export function parsePoint(text) {
  const s = String(text).trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{3,4})$/))) return makePoint(m[1]);
  if ((m = s.match(/^(\d{3,4})-(\d{1,2})$/))) return makePoint(m[1], m[2]);
  if ((m = s.match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/))) return makePoint(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{3,4})$/))) return makePoint(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})[./](\d{3,4})$/))) return makePoint(m[2], m[1]);
  if ((m = s.match(/^(\d{1,2}) ([A-Za-z]+\.?) (\d{3,4})$/))) {
    const mo = monthNum(m[2]); return mo ? makePoint(m[3], mo, m[1]) : null;
  }
  if ((m = s.match(/^([A-Za-z]+\.?) (\d{1,2}) (\d{3,4})$/))) {
    const mo = monthNum(m[1]); return mo ? makePoint(m[3], mo, m[2]) : null;
  }
  if ((m = s.match(/^([A-Za-z]+\.?) (\d{3,4})$/))) {
    const mo = monthNum(m[1]); return mo ? makePoint(m[2], mo) : null;
  }
  return null;
}

/** Start and end of a point, in fractional years. */
export function pointRange(p) {
  const [y, m, d] = p.split('-').map(Number);
  if (m == null) return [y, y + 1];
  if (d == null) return [y + (m - 1) / 12, y + m / 12];
  const start = y + (m - 1) / 12 + (d - 1) / 372;
  return [start, start + 1 / 372];
}

const ok = (value) => ({ ok: true, value });
const fail = (reason) => ({ ok: false, reason });

/**
 * Turn what a person typed into a stored date.
 * Returns { ok: true, value } or { ok: false, reason }.
 */
export function parseDate(text) {
  const s = String(text ?? '').trim();
  if (!s) return ok(null);
  if (/^(unknown|\?+|unk\.?)$/i.test(s)) return ok({ type: 'unknown' });

  let m =
    s.match(/^(?:between|bet\.?|from)\s+(.+?)\s+(?:and|to|-|–|—)\s+(.+)$/i) ||
    s.match(/^(\d{3,4})\s*[-–—]\s*(\d{3,4})$/) ||
    s.match(/^(.+?)\s*(?:–|—|\.\.|\bto\b)\s*(.+)$/i);
  if (m) {
    const from = parsePoint(m[1]);
    const to = parsePoint(m[2]);
    if (!from || !to) return fail('range');
    if (pointRange(from)[0] > pointRange(to)[0]) return fail('order');
    return ok({ type: 'between', from, to });
  }

  const prefixes = [
    ['about', /^(?:about|abt\.?|approximately|approx\.?|around|circa|ca\.?|c\.|~)\s*(.+)$/i],
    ['before', /^(?:before|bef\.?|<)\s*(.+)$/i],
    ['after', /^(?:after|aft\.?|>)\s*(.+)$/i],
  ];
  for (const [type, re] of prefixes) {
    const pm = s.match(re);
    if (pm) {
      const date = parsePoint(pm[1]);
      return date ? ok({ type, date }) : fail('point');
    }
  }
  const date = parsePoint(s);
  return date ? ok({ type: 'exact', date }) : fail('point');
}

function formatPoint(p) {
  const [y, m, d] = p.split('-').map(Number);
  if (m == null) return String(y);
  if (d == null) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Full, readable form. Always parseable again by parseDate. */
export function formatDate(v) {
  if (!v) return '';
  switch (v.type) {
    case 'exact': return formatPoint(v.date);
    case 'about': return `about ${formatPoint(v.date)}`;
    case 'before': return `before ${formatPoint(v.date)}`;
    case 'after': return `after ${formatPoint(v.date)}`;
    case 'between': return `between ${formatPoint(v.from)} and ${formatPoint(v.to)}`;
    case 'unknown': return 'unknown';
    default: return '';
  }
}

const yearOf = (p) => String(Number(p.split('-')[0]));

/** Short form for lifespans, e.g. "c. 1920", "1918–1921". */
export function formatYear(v) {
  if (!v) return '';
  switch (v.type) {
    case 'exact': return yearOf(v.date);
    case 'about': return `c. ${yearOf(v.date)}`;
    case 'before': return `bef. ${yearOf(v.date)}`;
    case 'after': return `aft. ${yearOf(v.date)}`;
    case 'between': {
      const a = yearOf(v.from), b = yearOf(v.to);
      return a === b ? a : `${a}–${b}`;
    }
    case 'unknown': return '?';
    default: return '';
  }
}

/** A number for sorting and estimating (fractional year), or null if unknown. */
export function sortKey(v) {
  if (!v) return null;
  switch (v.type) {
    case 'exact':
    case 'about': { const [a, b] = pointRange(v.date); return (a + b) / 2; }
    case 'before': return pointRange(v.date)[0] - 0.5;
    case 'after': return pointRange(v.date)[1];
    case 'between': return (pointRange(v.from)[0] + pointRange(v.to)[1]) / 2;
    default: return null;
  }
}

/** Best guess of the year, or null. */
export function estimateYear(v) {
  const k = sortKey(v);
  return k == null ? null : Math.floor(k);
}

/** Compare two dates for sorting; unknown dates go last. */
export function compareDates(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  if (ka == null && kb == null) return 0;
  if (ka == null) return 1;
  if (kb == null) return -1;
  return ka - kb;
}

export function isValidDate(v) {
  if (v == null) return true;
  if (typeof v !== 'object') return false;
  if (v.type === 'unknown') return true;
  if (v.type === 'between') {
    return typeof v.from === 'string' && typeof v.to === 'string' &&
      parsePoint(v.from) === v.from && parsePoint(v.to) === v.to;
  }
  return ['exact', 'about', 'before', 'after'].includes(v.type) &&
    typeof v.date === 'string' && parsePoint(v.date) === v.date;
}

export const DATE_HELP = 'Examples: 1920 · May 1920 · 3 May 1920 · about 1920 · between 1918 and 1921 · before 1930 · after 1945 · unknown';
