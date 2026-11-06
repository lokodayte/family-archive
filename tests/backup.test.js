import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, readZip, concat, crc32 } from '../site/assets/js/lib/zip.js';
import { exportGedcom, importGedcom, dateToGedcom, dateFromGedcom, parseGedcomTree } from '../site/assets/js/lib/gedcom.js';
import { buildBackup } from '../site/assets/js/lib/backup.js';
import { buildSampleArchive } from '../tools/buildSample.js';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { samplePeople, sampleRels, samplePlaces, sampleMoves } from '../tools/sampleFamily.js';
import { parseDate, formatDate } from '../site/assets/js/lib/dates.js';
import { buildGraph, siblings } from '../site/assets/js/lib/relations.js';
import { displayName } from '../site/assets/js/lib/model.js';

const d = (s) => parseDate(s).value;

// ---------- ZIP ----------

test('ZIP: files (including Armenian/Cyrillic names) come back exactly', () => {
  const img = new Uint8Array(5000).map((_, i) => i % 256);
  const zip = concat(makeZip([
    { name: 'README.txt', data: 'hello' },
    { name: 'photos/Հովհաննես.jpg', data: img },
    { name: 'photos/Ованес.jpg', data: img },
    { name: 'photos/Ованес.jpg', data: new Uint8Array([1]) }, // duplicate name gets " (2)"
  ]));
  const files = readZip(zip);
  assert.equal(new TextDecoder().decode(files.get('README.txt')), 'hello');
  assert.deepEqual(files.get('photos/Հովհաննես.jpg'), img);
  assert.deepEqual(files.get('photos/Ованес (2).jpg'), new Uint8Array([1]));
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926); // standard check value
});

// ---------- GEDCOM dates ----------

test('GEDCOM dates both ways', () => {
  assert.equal(dateToGedcom(d('3 May 1920')), '3 MAY 1920');
  assert.equal(dateToGedcom(d('about 1920')), 'ABT 1920');
  assert.equal(dateToGedcom(d('between 1918 and 1921')), 'BET 1918 AND 1921');
  assert.equal(dateToGedcom(d('before Aug 1945')), 'BEF AUG 1945');
  assert.equal(dateToGedcom(d('unknown')), null);
  for (const [ged, ours] of [
    ['3 MAY 1920', '3 May 1920'], ['ABT 1920', 'about 1920'], ['EST 1880', 'about 1880'], ['CAL 1880', 'about 1880'],
    ['BEF 1930', 'before 1930'], ['AFT 1945', 'after 1945'], ['BET 1918 AND 1921', 'between 1918 and 1921'],
    ['FROM 1918 TO 1921', 'between 1918 and 1921'], ['1720/21', '1720'], ['INT 1900 (about then)', '1900'], ['jan 1900', 'January 1900'],
  ]) assert.equal(formatDate(dateFromGedcom(ged)), ours, ged);
  assert.equal(dateFromGedcom('sometime'), null);
});

// ---------- GEDCOM round trip ----------

test('GEDCOM export then import keeps people, names, dates, places and family links', () => {
  const people = new Map(samplePeople().map((p) => [p.id, p]));
  const places = new Map(samplePlaces().map((p) => [p.id, p]));
  const moves = new Map(sampleMoves().map((m) => [m.id, m]));
  const { text, warnings } = exportGedcom({ people, rels: sampleRels(), places, moves });
  assert.match(text, /^0 HEAD/);
  assert.match(text, /1 CHAR UTF-8/);
  assert.match(text, /0 TRLR\n$/);
  assert.match(text, /2 PLAC Kars, Russian Empire/); // historical name for the date
  assert.match(text, /4 LATI N40\.60130/);
  assert.deepEqual(warnings, []);
  assert.ok(text.split('\n').every((l) => l.length < 255), 'no over-long lines');

  const back = importGedcom(text);
  assert.equal(back.people.length, 10);
  const byName = (first) => back.people.find((p) => p.names.latin?.first === first);
  const hov = byName('Hovhannes');
  assert.equal(hov.names.armenian.first, 'Հովհաննես');
  assert.equal(hov.names.cyrillic.patronymic, 'Григорьевич');
  assert.equal(hov.names.latin.patronymic, 'Grigori');
  assert.deepEqual(hov.nicknames, ['Vano']);
  assert.equal(formatDate(hov.birth.date), 'about 1880');
  assert.equal(formatDate(hov.death.date), '12 March 1951');
  assert.equal(hov.occupation, 'Blacksmith');
  assert.deepEqual(hov.languages, ['Armenian', 'Russian', 'Turkish']);
  assert.equal(hov.sex, 'male');
  assert.ok(hov.bio.includes('forge'));
  assert.equal(hov.sources[0].citation, 'Memory of a granddaughter (sample)');
  assert.equal(hov.sources[0].confidence, 'medium');
  assert.ok(hov.events.some((e) => e.type === 'move'), 'migration kept as an event');
  const elena = byName('Elena');
  assert.equal(elena.names.latin.maiden, 'Demova');
  assert.equal(elena.names.cyrillic.maiden, 'Демова');
  assert.equal(byName('Karine').living, true);
  assert.equal(hov.living, false);
  const unknown = back.people.find((p) => p.placeholder);
  assert.ok(unknown, 'placeholder kept');

  // Places are created once, with coordinates.
  const kars = back.places.filter((p) => p.name === 'Kars');
  assert.equal(kars.length, 1);
  assert.ok(Math.abs(kars[0].lat - 40.6013) < 1e-4);
  assert.equal(hov.birth.placeId, kars[0].id);

  // Family links: same structure, half-siblings still worked out.
  const g = buildGraph(back.rels);
  const grigor = byName('Grigor');
  const lusine = byName('Lusine');
  assert.deepEqual(siblings(g, grigor.id).half, [lusine.id]);
  assert.equal(g.spousesOf(hov.id).length, 2);
  const marriage = g.spousesOf(grigor.id)[0].rel;
  assert.equal(formatDate(marriage.start), '1938');
  assert.equal(back.rels.filter((r) => r.type === 'parent').length, 10);
  assert.ok(back.people.every((p) => p.privacy === 'family'), 'imports are family-only');
});

test('GEDCOM from another program: pointers, CONC/CONT, adoption, married names, odd dates', () => {
  const text = `﻿0 HEAD
1 CHAR UTF-8
0 @S1@ SOUR
1 TITL Parish register of St. Gregory
0 @N1@ NOTE A long note that is
1 CONC  continued here
1 CONT and on a new line.
0 @I1@ INDI
1 NAME Anna /Petrosyan/
2 TYPE birth
1 NAME Anna /Melkonyan/
2 TYPE married
1 NAME Анна /Петросян/
1 SEX F
1 BIRT
2 DATE BET 1898 AND 1902
2 PLAC Van, Ottoman Empire
3 MAP
4 LATI N38.5012
4 LONG E43.3729
1 DEAT
2 DATE 1975
1 NOTE @N1@
1 SOUR @S1@
2 PAGE p. 12
2 QUAY 3
1 FAMS @F1@
0 @I2@ INDI
1 NAME Levon /Melkonyan/
1 SEX M
1 BIRT
2 DATE CAL 1895
1 FAMS @F1@
0 @I3@ INDI
1 NAME Sona /Melkonyan/
1 SEX F
1 BIRT
2 DATE 12 FEB 1930
2 PLAC Van, Ottoman Empire
1 FAMC @F1@
2 PEDI adopted
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 CHIL @I3@
1 MARR
2 DATE 1925
0 TRLR
`;
  const tree = parseGedcomTree(text);
  assert.equal(tree.children.find((n) => n.xref === '@N1@').value, 'A long note that is continued here\nand on a new line.');
  const r = importGedcom(text);
  const anna = r.people.find((p) => p.names.latin?.first === 'Anna');
  assert.equal(anna.names.latin.last, 'Melkonyan');
  assert.equal(anna.names.latin.maiden, 'Petrosyan');
  assert.equal(anna.names.cyrillic.first, 'Анна');
  assert.equal(formatDate(anna.birth.date), 'between 1898 and 1902');
  assert.equal(anna.bio, 'A long note that is continued here\nand on a new line.');
  assert.equal(anna.sources[0].citation, 'Parish register of St. Gregory, p. 12');
  assert.equal(anna.sources[0].confidence, 'high');
  assert.equal(r.places.length, 1); // "Van" saved once
  assert.equal(r.places[0].name, 'Van');
  assert.deepEqual(r.places[0].countries, [{ country: 'Ottoman Empire' }]);
  const sona = r.people.find((p) => p.names.latin?.first === 'Sona');
  const parentKinds = r.rels.filter((x) => x.type === 'parent' && x.child === sona.id).map((x) => x.kind);
  assert.deepEqual(parentKinds, ['adoptive', 'adoptive']);
  assert.equal(r.rels.filter((x) => x.type === 'spouse').length, 1);
  assert.equal(displayName(r.people.find((p) => p.names.latin?.first === 'Levon')), 'Levon Melkonyan');
});

test('impossible links in a GEDCOM file are left out with a warning', () => {
  const text = `0 @I1@ INDI\n1 NAME A /X/\n1 FAMS @F1@\n1 FAMC @F2@\n0 @I2@ INDI\n1 NAME B /X/\n1 FAMC @F1@\n1 FAMS @F2@\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 @F2@ FAM\n1 HUSB @I2@\n1 CHIL @I1@\n0 TRLR\n`;
  const r = importGedcom(text);
  assert.equal(r.rels.length, 1);
  assert.match(r.warnings.join(' '), /impossible/);
});

// ---------- importing into the archive ----------

const FAST = 1000;
const PW = 'backup-test-pw';
async function fresh() {
  const { repo } = await buildSampleArchive(PW, { iterations: FAST });
  const store = new AdminStore(repo, { iterations: FAST });
  await store.load();
  await store.unlock(PW);
  return { repo, store };
}

test('a GEDCOM import is added as one change, family-only, and spots likely duplicates', async () => {
  const { repo, store } = await fresh();
  const { text } = exportGedcom({ people: new Map(samplePeople().map((p) => [p.id, p])), rels: sampleRels() });
  const imp = importGedcom(text);
  assert.equal(store.likelyDuplicates(imp.people).length, 9); // the placeholder has no name to compare
  const before = repo.commits.length;
  store.importBatch(imp);
  await store.save();
  assert.equal(repo.commits.length, before + 1);
  assert.equal(store.people.size, 20);
  assert.ok(!JSON.parse(repo.snapshot()['data/public/index.json']).people.some((p) => !p.id.startsWith('psample')));
});

// ---------- full backup ----------

test('backup ZIP has readable data, GEDCOM and the photos', async () => {
  const { store } = await fresh();
  const img = new Uint8Array(3000).map((_, i) => (i * 3) % 256);
  store.addPhoto({ title: 'Family table', choice: 'family', tags: [{ person: 'psample0006', x: 0.5, y: 0.5 }], date: d('1950') }, { image: img, thumb: img.subarray(0, 100), w: 10, h: 10 });
  await store.save();
  const { parts, filename, counts } = await buildBackup(store, { withPhotos: true });
  assert.match(filename, /^family-archive-backup-\d{4}-\d\d-\d\d\.zip$/);
  assert.deepEqual(counts, { people: 10, photos: 1, images: 1 });
  const files = readZip(concat(parts));
  const archive = JSON.parse(new TextDecoder().decode(files.get('archive.json')));
  assert.equal(archive.people.length, 10);
  assert.equal(archive.people.find((p) => p.id === 'psample0006').names.cyrillic.maiden, 'Демова'); // decrypted
  assert.equal(archive.moves.length, 3);
  assert.match(new TextDecoder().decode(files.get('family.ged')), /0 TRLR/);
  assert.match(new TextDecoder().decode(files.get('people.txt')), /Elena Sampleyan — born 1915, died 1999 {2}\[family only\]/);
  const photoName = [...files.keys()].find((k) => k.startsWith('photos/'));
  assert.equal(photoName, 'photos/1950 - Family table - (Elena Sampleyan).jpg');
  assert.deepEqual(files.get(photoName), img);
  assert.match(new TextDecoder().decode(files.get('README.txt')), /NOT encrypted/);
});

test('backup without photos is small, and refuses while changes are unsaved', async () => {
  const { store } = await fresh();
  const { counts } = await buildBackup(store, { withPhotos: false });
  assert.equal(counts.images, 0);
  store.deletePerson('psample0009');
  await assert.rejects(buildBackup(store), /Save & publish/);
});
