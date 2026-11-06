import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeNameAt, countryAt, placeLabel, placeText, searchPlaces, whereIn, whoWhereIn, aliveIn,
  placeConnections, branchOf, branchColors, yearRange, lifePlaces, movesByPerson,
} from '../site/assets/js/lib/places.js';
import { samplePeople, samplePlaces, sampleMoves, sampleRels } from '../tools/sampleFamily.js';
import { summarize, mergeIndexes, familyShardPath } from '../site/assets/js/lib/model.js';
import { parseDate } from '../site/assets/js/lib/dates.js';
import { buildSampleArchive } from '../tools/buildSample.js';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { unlockKeyring, decryptJSON } from '../site/assets/js/lib/crypto.js';

const d = (s) => parseDate(s).value;
const places = new Map(samplePlaces().map((p) => [p.id, p]));
const people = new Map(samplePeople().map((p) => [p.id, summarize(p)]));
const moves = sampleMoves();
const yerevan = places.get('lsampleyerevan');
const kars = places.get('lsamplekars');

test('historical names and countries depend on the year', () => {
  assert.equal(placeNameAt(yerevan, 1910), 'Erivan');
  assert.equal(placeNameAt(yerevan, 1950), 'Yerevan');
  assert.equal(placeNameAt(yerevan), 'Yerevan');
  assert.equal(countryAt(kars, 1900), 'Russian Empire');
  assert.equal(countryAt(kars, 1919), 'First Republic of Armenia');
  assert.equal(countryAt(kars, 2000), 'Turkey');
  assert.equal(countryAt(kars), 'Turkey'); // today
  assert.equal(countryAt(kars, 1700), ''); // unknown back then
  assert.equal(placeLabel(yerevan, 1925), 'Erivan, Soviet Union (Armenian SSR)');
  assert.equal(placeLabel(yerevan, 1950), 'Yerevan, Soviet Union (Armenian SSR)');
  assert.equal(placeLabel(places.get('lsampletbilisi'), 1915), 'Tiflis, Russian Empire');
});

test('placeText uses the saved place when linked, the plain text otherwise', () => {
  assert.equal(placeText({ place: 'Kars', placeId: 'lsamplekars' }, places, d('about 1880')), 'Kars, Russian Empire');
  assert.equal(placeText({ place: 'Somewhere' }, places, d('1900')), 'Somewhere');
  assert.equal(placeText({ place: 'Old text', placeId: 'deleted' }, places, d('1900')), 'Old text');
});

test('place search finds historical names and countries', () => {
  assert.deepEqual(searchPlaces(places, 'tifl').map((p) => p.id), ['lsampletbilisi']);
  assert.deepEqual(searchPlaces(places, 'erivan').map((p) => p.id), ['lsampleyerevan']);
  assert.ok(searchPlaces(places, 'turkey').some((p) => p.id === 'lsamplekars'));
  assert.deepEqual(searchPlaces(places, ''), []);
});

test('alive in a year', () => {
  const g = people.get('psample0004'); // 1910–1988
  assert.equal(aliveIn(g, 1900), false);
  assert.equal(aliveIn(g, 1950), true);
  assert.equal(aliveIn(g, 1990), false);
  assert.equal(aliveIn(people.get('psample0008'), 2020), true); // living
  assert.equal(aliveIn(people.get('psample0010'), 1950), null); // placeholder, no dates
});

test('where did people live in a given year', () => {
  const by = movesByPerson(moves);
  const hov = people.get('psample0001');
  assert.equal(whereIn(hov, 1900, by.get('psample0001')), 'lsamplekars'); // born there
  assert.equal(whereIn(hov, 1930, by.get('psample0001')), 'lsampleyerevan'); // after moving
  assert.equal(whereIn(hov, 1960, by.get('psample0001')), null); // died 1951
  // Anahit has no birth place, but we know she left Kars in the move.
  assert.equal(whereIn(people.get('psample0003'), 1910, by.get('psample0003')), 'lsamplekars');
  assert.equal(whereIn(people.get('psample0003'), 1925, by.get('psample0003')), 'lsampleyerevan');
  // Davit moved to Moscow about 1995.
  assert.equal(whereIn(people.get('psample0009'), 1990, by.get('psample0009')), 'lsampleyerevan');
  assert.equal(whereIn(people.get('psample0009'), 2000, by.get('psample0009')), 'lsamplemoscow');
  const map1925 = whoWhereIn(people, moves, 1925);
  assert.deepEqual(map1925.get('lsampleyerevan').sort(), ['psample0001', 'psample0003', 'psample0004', 'psample0005']);
  assert.deepEqual(map1925.get('lsampletbilisi'), ['psample0006']);
  assert.equal(map1925.has('lsamplekars'), false);
  const order = lifePlaces(hov, by.get('psample0001')).map((e) => e.kind);
  assert.deepEqual(order, ['birth', 'left', 'move', 'death']);
});

test('slider range covers everyone', () => {
  const r = yearRange(people, moves);
  assert.equal(r.min, 1880);
  assert.equal(r.max, new Date().getFullYear()); // living people
});

test('everything connected to a place', () => {
  const c = placeConnections('lsampleyerevan', { people, rels: sampleRels(), moves });
  const roles = (pid) => c.filter((x) => x.personId === pid).map((x) => x.role).sort();
  assert.deepEqual(roles('psample0001'), ['arrived', 'died']);
  assert.deepEqual(roles('psample0004'), ['arrived', 'died', 'married']);
  assert.deepEqual(roles('psample0009'), ['born', 'left']);
  assert.ok(placeConnections('lsamplekars', { people, moves }).some((x) => x.personId === 'psample0003' && x.role === 'left'));
});

test('family branches by birth surname', () => {
  assert.equal(branchOf(people.get('psample0004')), 'Sampleyan');
  assert.equal(branchOf(people.get('psample0006')), 'Demova'); // maiden name
  assert.equal(branchOf(people.get('psample0002')), 'Exampleyan');
  const { colors, order } = branchColors(people);
  assert.equal(order[0].branch, 'Sampleyan'); // biggest branch first
  assert.notEqual(colors.get('Sampleyan'), colors.get('Demova'));
});

// ---------- saving and privacy ----------

const FAST = 1000;
const PW = 'pw-for-places';

async function fresh() {
  const { repo } = await buildSampleArchive(PW, { iterations: FAST });
  const store = new AdminStore(repo, { iterations: FAST });
  await store.load();
  await store.unlock(PW);
  return { repo, store };
}

async function readAll(repo) {
  const files = repo.snapshot();
  const config = JSON.parse(files['data/config.json']);
  const key = await unlockKeyring(config.crypto, PW);
  const shards = [];
  for (let i = 0; i < config.familyShards; i++) if (files[familyShardPath(i)]) shards.push(await decryptJSON(key, files[familyShardPath(i)]));
  const pub = JSON.parse(files['data/public/index.json']);
  return { pub, all: mergeIndexes(pub, shards), stranger: mergeIndexes(pub, []) };
}

test('PRIVACY: places and moves are public only when something public needs them', async () => {
  const { repo } = await fresh();
  const { pub, all, stranger } = await readAll(repo);
  assert.deepEqual(pub.places.map((p) => p.id).sort(), ['lsamplekars', 'lsampleyerevan']);
  assert.deepEqual(pub.moves.map((m) => m.id), ['msample01']);
  assert.equal(all.places.size, 4);
  assert.equal(all.moves.size, 3);
  assert.equal(stranger.moves.size, 1);
  // The public move only lists public people.
  assert.ok(pub.moves[0].people.every((id) => stranger.people.has(id)));
});

test('a move with a family-only person is never public', async () => {
  const { repo, store } = await fresh();
  store.saveMove({ people: ['psample0001', 'psample0008'], from: 'lsamplekars', to: 'lsampleyerevan', date: d('1950'), reason: 'family' });
  await store.save();
  const { pub, all } = await readAll(repo);
  assert.equal(pub.moves.length, 1);
  assert.equal(all.moves.size, 4);
  assert.match(repo.commits.at(-1).message, /1 move change/);
});

test('places: add, edit, delete (blocked while a move uses it)', async () => {
  const { repo, store } = await fresh();
  const id = store.savePlace({ name: 'Gyumri', lat: 40.7929, lng: 43.8465, names: [{ name: 'Leninakan', from: 1924, to: 1990 }, { name: 'Alexandropol', to: 1923 }] });
  await store.save();
  let { all } = await readAll(repo);
  assert.equal(placeNameAt(all.places.get(id), 1950), 'Leninakan');
  // Only used by nothing public yet → family-only.
  assert.ok(!repo.snapshot()['data/public/index.json'].includes('Gyumri'));

  assert.throws(() => store.deletePlace('lsamplekars'), /used by 1 move/);
  store.deletePlace(id);
  await store.save();
  ({ all } = await readAll(repo));
  assert.equal(all.places.has(id), false);
});

test('deleting a person removes them from moves (and empty moves disappear)', async () => {
  const { repo, store } = await fresh();
  store.deletePerson('psample0009');
  store.deletePerson('psample0003');
  await store.save();
  const { all } = await readAll(repo);
  assert.equal(all.moves.has('msample03'), false);
  assert.deepEqual(all.moves.get('msample01').people, ['psample0001', 'psample0004']);
});

test('a move needs people and at least one place', async () => {
  const { store } = await fresh();
  assert.throws(() => store.saveMove({ people: [], from: 'lsamplekars' }), /at least one person/);
  assert.throws(() => store.saveMove({ people: ['psample0001'] }), /moved from or to/);
});
