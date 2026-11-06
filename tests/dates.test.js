import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, formatDate, formatYear, sortKey, estimateYear, compareDates, isValidDate,
} from '../site/assets/js/lib/dates.js';

const parse = (s) => {
  const r = parseDate(s);
  assert.ok(r.ok, `should understand "${s}"`);
  return r.value;
};

test('exact dates in many spellings', () => {
  assert.deepEqual(parse('1920'), { type: 'exact', date: '1920' });
  assert.deepEqual(parse('May 1920'), { type: 'exact', date: '1920-05' });
  assert.deepEqual(parse('3 May 1920'), { type: 'exact', date: '1920-05-03' });
  assert.deepEqual(parse('May 3, 1920'), { type: 'exact', date: '1920-05-03' });
  assert.deepEqual(parse('1920-05-03'), { type: 'exact', date: '1920-05-03' });
  assert.deepEqual(parse('03.05.1920'), { type: 'exact', date: '1920-05-03' });
  assert.deepEqual(parse('sept 1939'), { type: 'exact', date: '1939-09' });
});

test('approximate, before, after, between, unknown', () => {
  assert.deepEqual(parse('about 1920'), { type: 'about', date: '1920' });
  assert.deepEqual(parse('abt. 1920'), { type: 'about', date: '1920' });
  assert.deepEqual(parse('c. 1920'), { type: 'about', date: '1920' });
  assert.deepEqual(parse('approximately 1920'), { type: 'about', date: '1920' });
  assert.deepEqual(parse('~1920'), { type: 'about', date: '1920' });
  assert.deepEqual(parse('before 1930'), { type: 'before', date: '1930' });
  assert.deepEqual(parse('after Aug 1945'), { type: 'after', date: '1945-08' });
  assert.deepEqual(parse('between 1918 and 1921'), { type: 'between', from: '1918', to: '1921' });
  assert.deepEqual(parse('1918-1921'), { type: 'between', from: '1918', to: '1921' });
  assert.deepEqual(parse('1918 – 1921'), { type: 'between', from: '1918', to: '1921' });
  assert.deepEqual(parse('unknown'), { type: 'unknown' });
  assert.deepEqual(parse('?'), { type: 'unknown' });
  assert.equal(parse(''), null);
  assert.equal(parse('   '), null);
});

test('rejects nonsense and impossible dates', () => {
  for (const s of ['yesterday', '31 February 1920', '1920-13', 'between 1930 and 1920', 'about soon', '12']) {
    assert.equal(parseDate(s).ok, false, `should reject "${s}"`);
  }
  assert.equal(parseDate('29 February 1900').ok, false); // 1900 was not a leap year
  assert.equal(parseDate('29 February 2000').ok, true);
});

test('formatting reads naturally and parses back to the same date', () => {
  const samples = ['1920', 'May 1920', '3 May 1920', 'about 1920', 'before 1930',
    'after 1945', 'between 1918 and 1921', 'unknown', 'between March 1918 and 2 June 1921'];
  for (const s of samples) {
    const v = parse(s);
    assert.equal(formatDate(v), s);
    assert.deepEqual(parse(formatDate(v)), v);
    assert.ok(isValidDate(v));
  }
});

test('short year form for lifespans', () => {
  assert.equal(formatYear(parse('3 May 1920')), '1920');
  assert.equal(formatYear(parse('about 1920')), 'c. 1920');
  assert.equal(formatYear(parse('1918-1921')), '1918–1921');
  assert.equal(formatYear(parse('before 1930')), 'bef. 1930');
  assert.equal(formatYear(null), '');
});

test('sorting and estimating years', () => {
  const list = ['after 1945', '1920', 'before 1900', 'unknown', 'between 1918 and 1921', 'about 1880'].map(parse);
  const sorted = [...list].sort(compareDates).map(formatDate);
  assert.deepEqual(sorted, ['about 1880', 'before 1900', 'between 1918 and 1921', '1920', 'after 1945', 'unknown']);
  assert.equal(estimateYear(parse('about 1920')), 1920);
  assert.equal(estimateYear(parse('between 1918 and 1921')), 1920);
  assert.equal(sortKey(parse('unknown')), null);
  assert.ok(sortKey(parse('1 Jan 1920')) < sortKey(parse('31 Dec 1920')));
});

test('isValidDate catches broken stored values', () => {
  assert.equal(isValidDate({ type: 'exact', date: '1920-02-30' }), false);
  assert.equal(isValidDate({ type: 'whenever' }), false);
  assert.equal(isValidDate(null), true);
});
