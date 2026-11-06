import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleArchive } from '../tools/buildSample.js';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { mediaPath } from '../site/assets/js/lib/model.js';
import { gitBlobSha } from '../site/assets/js/lib/hash.js';

const FAST = 1000;
const PW = 'history-test-password';
const img = (seed, n = 1500) => new Uint8Array(n).map((_, i) => (i * 7 + seed) % 256);
const upload = (seed) => ({ image: img(seed), thumb: img(seed + 1, 200), w: 1000, h: 800 });

async function fresh() {
  const { repo } = await buildSampleArchive(PW, { iterations: FAST });
  return { repo, store: await reopen(repo) };
}
async function reopen(repo) {
  const s = new AdminStore(repo, { iterations: FAST });
  await s.load();
  await s.unlock(PW);
  return s;
}
const latest = async (repo) => (await repo.listCommits())[0];

test('each save keeps an encrypted note of what changed, with names', async () => {
  const { repo, store } = await fresh();
  const p = await store.getPerson('psample0007');
  p.occupation = 'Engineer';
  store.applyPersonEdit(p, store.relsOf(p.id));
  await store.save();
  const c = await latest(repo);
  const id = c.message.match(/Change-Id: (\w+)/)[1];
  const note = await store.readChangeNote(id);
  assert.deepEqual(note.ops, ['Edited Armen Sampleyan']); // family name only inside the encrypted note
  assert.ok(!c.message.includes('Armen'));
});

test('undo an edit', async () => {
  const { repo, store } = await fresh();
  const p = await store.getPerson('psample0004');
  p.occupation = 'Head teacher';
  p.names.latin.first = 'Grisha';
  store.applyPersonEdit(p, store.relsOf(p.id));
  await store.save();
  const result = await store.undoCommit((await latest(repo)).sha);
  assert.equal(result.skipped.length, 0);
  const s2 = await reopen(repo);
  const back = await s2.getPerson('psample0004');
  assert.equal(back.occupation, 'Teacher');
  assert.equal(back.names.latin.first, 'Grigor');
  const msg = (await latest(repo)).message;
  assert.match(msg, /^Archive: Undo of an earlier change/);
  const note = await store.readChangeNote(msg.match(/Change-Id: (\w+)/)[1]);
  assert.deepEqual(note.ops, ['Undid: Edited Grisha Sampleyan']);
});

test('undo a deletion brings the person and their family links back', async () => {
  const { repo, store } = await fresh();
  const relsBefore = store.relsOf('psample0009').length;
  store.deletePerson('psample0009');
  await store.save();
  await store.undoCommit((await latest(repo)).sha);
  const s2 = await reopen(repo);
  assert.ok(s2.people.has('psample0009'));
  assert.equal(s2.relsOf('psample0009').length, relsBefore);
  assert.equal((await s2.getPerson('psample0009')).names.latin.first, 'Davit');
  assert.ok(s2.moves.get('msample03').people.includes('psample0009'));
});

test('undo adding a person removes them', async () => {
  const { repo, store } = await fresh();
  store.applyPersonEdit({ id: 'pnewperson1', names: { latin: { first: 'Newcomer' } }, privacy: 'family' }, [
    { id: 'rnew1', type: 'parent', parent: 'psample0008', child: 'pnewperson1', kind: 'birth' },
  ]);
  await store.save();
  await store.undoCommit((await latest(repo)).sha);
  const s2 = await reopen(repo);
  assert.equal(s2.people.has('pnewperson1'), false);
  assert.equal(s2.rels.some((r) => r.id === 'rnew1'), false);
  assert.ok(!repo.snapshot()['data/family/people/pnewperson1.enc']);
});

test('things changed again later are NOT undone (and are reported)', async () => {
  const { repo, store } = await fresh();
  const edit = async (occupation) => {
    const p = await store.getPerson('psample0004');
    p.occupation = occupation;
    store.applyPersonEdit(p, store.relsOf(p.id));
    return store.save();
  };
  const first = await edit('Head teacher');
  // Unrelated second change in the same save as nothing else:
  const pl = await store.getPerson('psample0001');
  pl.occupation = 'Master blacksmith';
  store.applyPersonEdit(pl, store.relsOf(pl.id));
  await store.save();
  await edit('Headmaster'); // Grigor changed again
  const result = await store.undoCommit(first.sha);
  assert.equal(result.undone, 0);
  assert.deepEqual(result.skipped, ['Grigor Sampleyan']);
  assert.equal((await (await reopen(repo)).getPerson('psample0004')).occupation, 'Headmaster');
});

test('undo only affects that change, keeping later unrelated edits', async () => {
  const { repo, store } = await fresh();
  const a = await store.getPerson('psample0004');
  a.occupation = 'Head teacher';
  store.applyPersonEdit(a, store.relsOf(a.id));
  const first = await store.save();
  const b = await store.getPerson('psample0001');
  b.occupation = 'Master blacksmith';
  store.applyPersonEdit(b, store.relsOf(b.id));
  await store.save();
  await store.undoCommit(first.sha);
  const s2 = await reopen(repo);
  assert.equal((await s2.getPerson('psample0004')).occupation, 'Teacher');
  assert.equal((await s2.getPerson('psample0001')).occupation, 'Master blacksmith');
});

test('undo deleting a photo restores the exact image', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Keep me', choice: 'family', tags: [{ person: 'psample0007', x: 0.5, y: 0.5 }] }, upload(3));
  await store.save();
  store.deletePhoto(id);
  await store.save();
  assert.equal((await reopen(repo)).photos.has(id), false);
  await store.undoCommit((await latest(repo)).sha);
  const s2 = await reopen(repo);
  assert.equal(s2.photos.get(id).title, 'Keep me');
  assert.deepEqual(await s2.getImageBytes(id), upload(3).image);
  assert.deepEqual(s2.photos.get(id).tags.map((t) => t.person), ['psample0007']);
});

test('undo replacing an image brings the old image back', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Scan', choice: 'public' }, upload(10));
  await store.save();
  store.replacePhotoImage(id, upload(20));
  await store.save();
  await store.undoCommit((await latest(repo)).sha);
  const s2 = await reopen(repo);
  assert.deepEqual(await s2.getImageBytes(id), upload(10).image);
  // Only one copy of the image is current.
  const current = Object.keys(repo.snapshot()).filter((p) => p.startsWith(`media/public/${id}.`) && !p.includes('.t.'));
  assert.deepEqual(current, [mediaPath(s2.photos.get(id), 'public', 'full')]);
});

test('undo adding a photo removes it and its files', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Oops', choice: 'family' }, upload(30));
  await store.save();
  await store.undoCommit((await latest(repo)).sha);
  const s2 = await reopen(repo);
  assert.equal(s2.photos.has(id), false);
  assert.ok(!Object.keys(repo.snapshot()).some((p) => p.includes(id)));
});

test('undo place, move and settings changes', async () => {
  const { repo, store } = await fresh();
  const pl = structuredClone(store.places.get('lsamplekars'));
  pl.name = 'Kars (renamed)';
  store.savePlace(pl);
  store.deleteMove('msample02');
  store.setFamilySettings({ correctionEmail: 'new@example.com' });
  await store.save();
  const r = await store.undoCommit((await latest(repo)).sha);
  assert.equal(r.undone, 3);
  const s2 = await reopen(repo);
  assert.equal(s2.places.get('lsamplekars').name, 'Kars');
  assert.ok(s2.moves.has('msample02'));
  assert.equal(s2.familySettings.correctionEmail, undefined);
});

test('undo can itself be undone', async () => {
  const { repo, store } = await fresh();
  store.deletePerson('psample0005');
  await store.save();
  const undo = await store.undoCommit((await latest(repo)).sha);
  assert.ok((await reopen(repo)).people.has('psample0005'));
  await store.undoCommit(undo.sha);
  assert.equal((await reopen(repo)).people.has('psample0005'), false);
});

test('refuses to undo things it should not', async () => {
  const { repo, store } = await fresh();
  const history = await repo.listCommits({ perPage: 100 });
  const firstCommit = history.at(-1);
  await assert.rejects(store.undoCommit(firstCommit.sha), /can’t be undone/);
  await store.changePassword('another-password-1');
  await assert.rejects(store.undoCommit((await latest(repo)).sha), /Password changes/);
  store.deletePerson('psample0009');
  await assert.rejects(store.undoCommit((await latest(repo)).sha), /Save or discard/);
});

test('history lists newest first', async () => {
  const { repo } = await fresh();
  const list = await repo.listCommits();
  assert.ok(list.length >= 2);
  assert.ok(list[0].date > list[1].date);
  assert.equal(list[0].parent, list[1].sha);
});

test('git blob ids match what git itself computes', async () => {
  // `printf 'hello\n' | git hash-object --stdin` = ce013625030ba8dba906f756967f9e9ca394464a
  assert.equal(await gitBlobSha(new TextEncoder().encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('reading the published copy is only trusted when it is exactly the latest version', async () => {
  const { repo, store } = await fresh();
  const tree = await repo.listTree(store.head);
  const path = 'data/public/index.json';
  const real = await repo.readBytes(path);
  store.siteLoader = async () => new TextEncoder().encode('{"stale":true}');
  assert.deepEqual(await store.readLatestBytes(path, tree), real);
  let fromSite = 0;
  store.siteLoader = async () => { fromSite++; return real; };
  assert.deepEqual(await store.readLatestBytes(path, tree), real);
  assert.equal(fromSite, 1);
});
