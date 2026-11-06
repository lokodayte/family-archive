import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleArchive } from '../tools/buildSample.js';
import { FAMILY_ONLY_WORDS } from '../tools/sampleFamily.js';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { GitHubRepo } from '../site/assets/js/lib/github.js';
import { decryptBytes, unlockKeyring, decryptJSON } from '../site/assets/js/lib/crypto.js';
import { mergeIndexes, familyShardPath, mediaPath } from '../site/assets/js/lib/model.js';
import { filterPhotos, galleryFacets, decadeOf } from '../site/assets/js/lib/gallery.js';
import { fitWithin, encodeToTarget } from '../site/assets/js/lib/imageMath.js';
import { parseDate } from '../site/assets/js/lib/dates.js';

const FAST = 1000;
const PW = 'test-family-password';
const d = (s) => parseDate(s).value;

// Fake "JPEG" bytes: the store never decodes images, it only stores them.
const fakeImage = (seed, size = 2000) => new Uint8Array(size).map((_, i) => (i * 31 + seed) % 256);
const upload = (seed) => ({ image: fakeImage(seed), thumb: fakeImage(seed + 1, 300), w: 1600, h: 1200 });

async function fresh() {
  const { repo } = await buildSampleArchive(PW, { iterations: FAST });
  const store = new AdminStore(repo, { iterations: FAST });
  await store.load();
  await store.unlock(PW);
  return { repo, store };
}

async function reopen(repo) {
  const s = new AdminStore(repo, { iterations: FAST });
  await s.load();
  await s.unlock(PW);
  return s;
}

const isPlainFile = ([path]) => !path.endsWith('.enc') && !path.endsWith('.bin');

test('a public photo of public people is stored readable; its image is the exact upload', async () => {
  const { repo, store } = await fresh();
  const up = upload(1);
  const id = store.addPhoto({
    kind: 'photo', title: 'At the forge', choice: 'public', date: d('about 1925'), place: 'Yerevan',
    tags: [{ person: 'psample0001', x: 0.3, y: 0.4 }], story: 'A sample story.',
  }, up);
  await store.save();
  const files = repo.snapshot();
  const s = store.photos.get(id);
  assert.equal(s.privacy, 'public');
  assert.deepEqual(files[mediaPath(s, 'public', 'full')], up.image);
  assert.deepEqual(files[mediaPath(s, 'public', 'thumb')], up.thumb);
  assert.match(files[`data/public/photos/${id}.json`], /A sample story/);
  assert.ok(JSON.parse(files['data/public/index.json']).photos.some((p) => p.id === id));
});

test('PRIVACY: a photo marked public but showing a family-only person becomes family-only and encrypted', async () => {
  const { repo, store } = await fresh();
  const up = upload(2);
  const id = store.addPhoto({
    title: 'Wedding of Grigor and Elena', choice: 'public', story: 'Elena Demova wore white.',
    tags: [{ person: 'psample0004', x: 0.4, y: 0.3 }, { person: 'psample0006', x: 0.6, y: 0.3 }],
  }, up);
  await store.save();
  const files = repo.snapshot();
  const s = store.photos.get(id);
  assert.equal(s.privacy, 'family');
  const stored = files[mediaPath(s, 'family', 'full')];
  assert.ok(stored, 'encrypted image exists');
  assert.notDeepEqual(stored.subarray(15, 40), up.image.subarray(0, 25));
  assert.deepEqual(await decryptBytes(store.key, stored), up.image);
  for (const [path, text] of Object.entries(files).filter(isPlainFile)) {
    const str = typeof text === 'string' ? text : '';
    for (const w of [...FAMILY_ONLY_WORDS, 'Wedding', id]) assert.ok(!str.includes(w), `"${w}" leaked into ${path}`);
  }
  for (const c of repo.commits) for (const w of FAMILY_ONLY_WORDS) assert.ok(!c.message.includes(w));
});

test('when a person becomes family-only, their public photos move to encrypted storage', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Lusine', choice: 'public', tags: [{ person: 'psample0005', x: 0.5, y: 0.5 }] }, upload(3));
  await store.save();
  const before = store.photos.get(id);
  assert.equal(before.privacy, 'public');

  const p = await store.getPerson('psample0005');
  p.privacy = 'family';
  store.applyPersonEdit(p, store.relsOf(p.id));
  await store.save();

  const files = repo.snapshot();
  assert.ok(!files[mediaPath(before, 'public', 'full')], 'public copy removed');
  assert.ok(!files[`data/public/photos/${id}.json`]);
  const after = store.photos.get(id);
  assert.equal(after.privacy, 'family');
  assert.deepEqual(await decryptBytes(store.key, files[mediaPath(after, 'family', 'full')]), upload(3).image);
  assert.ok(files[`data/family/photos/${id}.enc`]);
  assert.ok(!files['data/public/index.json'].includes(id));

  // And back to public again when the person is made public.
  const p2 = await store.getPerson('psample0005');
  p2.privacy = 'public';
  store.applyPersonEdit(p2, store.relsOf(p2.id));
  await store.save();
  assert.equal(store.photos.get(id).privacy, 'public');
  assert.deepEqual(repo.snapshot()[mediaPath(store.photos.get(id), 'public', 'full')], upload(3).image);
});

test('replacing an image gives it a new file name and removes the old file', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Scan', kind: 'document', choice: 'family' }, upload(4));
  await store.save();
  const v1 = store.photos.get(id);
  assert.ok(store.replacedBytes(id) > 0);
  store.replacePhotoImage(id, upload(5));
  await store.save();
  const files = repo.snapshot();
  const v2 = store.photos.get(id);
  assert.equal(v2.v, 2);
  assert.ok(!files[mediaPath(v1, 'family', 'full')]);
  assert.deepEqual(await decryptBytes(store.key, files[mediaPath(v2, 'family', 'full')]), upload(5).image);
});

test('photos are read back after reopening, with tags, details and images', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({
    title: 'Family table', choice: 'family', description: 'Sunday lunch', date: d('1962'),
    tags: [{ person: 'psample0007', x: 0.2, y: 0.5 }],
  }, upload(6));
  await store.save();
  const s2 = await reopen(repo);
  const ph = s2.photos.get(id);
  assert.equal(ph.title, 'Family table');
  assert.deepEqual(ph.tags, [{ person: 'psample0007', x: 0.2, y: 0.5 }]);
  assert.equal((await s2.getPhotoDetails(id)).description, 'Sunday lunch');
  assert.deepEqual(await s2.getImageBytes(id, 'thumb'), upload(6).thumb);
  assert.deepEqual(s2.photosOf('psample0007').map((p) => p.id), [id]);
});

test('profile photo: a public person can use a family photo without revealing it publicly', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Portrait', choice: 'family', tags: [{ person: 'psample0004', x: 0.5, y: 0.3 }] }, upload(7));
  store.setPortrait('psample0004', id);
  await store.save();
  const files = repo.snapshot();
  const pub = JSON.parse(files['data/public/index.json']);
  assert.equal(pub.people.find((p) => p.id === 'psample0004').photo, undefined);
  assert.ok(!files['data/public/people/psample0004.json'].includes(id));
  // With the password, the portrait comes back.
  const config = JSON.parse(files['data/config.json']);
  const key = await unlockKeyring(config.crypto, PW);
  const shards = [];
  for (let i = 0; i < config.familyShards; i++) if (files[familyShardPath(i)]) shards.push(await decryptJSON(key, files[familyShardPath(i)]));
  const merged = mergeIndexes(pub, shards);
  assert.equal(merged.people.get('psample0004').photo, id);
  // Without it, no portrait (and no broken image).
  assert.equal(mergeIndexes(pub, []).people.get('psample0004').photo, undefined);
});

test('deleting a photo removes its files and clears it as a profile photo', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Old', choice: 'public', tags: [{ person: 'psample0001', x: 0.5, y: 0.5 }] }, upload(8));
  store.setPortrait('psample0001', id);
  await store.save();
  const s = store.photos.get(id);
  store.deletePhoto(id);
  await store.save();
  const files = repo.snapshot();
  assert.ok(!files[mediaPath(s, 'public', 'full')]);
  assert.ok(!files[`data/public/photos/${id}.json`]);
  const s2 = await reopen(repo);
  assert.equal(s2.people.get('psample0001').photo, undefined);
  assert.equal(s2.photos.size, 0);
});

test('deleting a person removes their tags from photos', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'Group', choice: 'family', tags: [{ person: 'psample0009', x: 0.5, y: 0.5 }, { person: 'psample0008', x: 0.2, y: 0.5 }] }, upload(9));
  await store.save();
  store.deletePerson('psample0009');
  await store.save();
  const s2 = await reopen(repo);
  assert.deepEqual(s2.photos.get(id).tags.map((t) => t.person), ['psample0008']);
});

test('several uploads are one commit; commit message never names family photos', async () => {
  const { repo, store } = await fresh();
  const before = repo.commits.length;
  for (let i = 0; i < 5; i++) store.addPhoto({ title: `Secret family picture ${i}`, choice: 'family' }, upload(20 + i));
  await store.save();
  assert.equal(repo.commits.length, before + 1);
  assert.match(repo.commits.at(-1).message, /5 photo changes/);
  assert.ok(!repo.commits.at(-1).message.includes('Secret'));
});

test('full re-lock re-encrypts photos too', async () => {
  const { repo, store } = await fresh();
  const id = store.addPhoto({ title: 'x', choice: 'family' }, upload(30));
  await store.save();
  await store.changePassword('a-brand-new-password', { full: true });
  const s2 = new AdminStore(repo, { iterations: FAST });
  await s2.load();
  await s2.unlock('a-brand-new-password');
  assert.deepEqual(await s2.getImageBytes(id), upload(30).image);
  assert.equal(s2.photos.get(id).title, 'x');
});

// ---------- gallery filters ----------

test('gallery filters by person, place, decade and kind', () => {
  const photos = [
    { id: 'a', date: d('1925'), place: 'Yerevan', tags: [{ person: 'p1' }], kind: 'photo' },
    { id: 'b', date: d('about 1938'), place: 'yerevan ', tags: [{ person: 'p2' }], kind: 'document' },
    { id: 'c', date: d('between 1930 and 1935'), place: 'Kars', tags: [{ person: 'p1' }, { person: 'p2' }] },
    { id: 'd', place: 'Kars' },
  ];
  const ids = (f) => filterPhotos(photos, f).map((p) => p.id);
  assert.deepEqual(ids({}), ['a', 'c', 'b', 'd']); // by date, undated last
  assert.deepEqual(ids({ person: 'p1' }), ['a', 'c']);
  assert.deepEqual(ids({ place: 'Yerevan' }), ['a', 'b']); // case and spaces ignored
  assert.deepEqual(ids({ decade: 1930 }), ['c', 'b']);
  assert.deepEqual(ids({ decade: 'undated' }), ['d']);
  assert.deepEqual(ids({ kind: 'document' }), ['b']);
  assert.deepEqual(ids({ person: 'p2', place: 'Kars' }), ['c']);
  const f = galleryFacets(photos);
  assert.deepEqual(f.places.map((p) => [p.label, p.count]), [['Kars', 2], ['Yerevan', 2]]);
  assert.deepEqual(f.decades, [{ decade: 1920, count: 1 }, { decade: 1930, count: 2 }]);
  assert.equal(f.undated, 1);
  assert.equal(f.people.get('p2'), 2);
  assert.equal(decadeOf(d('before 1900')), 1890);
});

// ---------- image sizing ----------

test('images are fitted within the size limit without stretching or enlarging', () => {
  assert.deepEqual(fitWithin(4000, 3000, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(fitWithin(3000, 4000, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(fitWithin(800, 600, 2000), { w: 800, h: 600 });
});

test('compression lowers quality until the file is small enough', async () => {
  const sizes = { 0.86: 500_000, 0.8: 400_000, 0.72: 290_000, 0.64: 200_000 };
  const tried = [];
  const blob = await encodeToTarget(async (q) => { tried.push(q); return { size: sizes[q] ?? 100_000, q }; }, 300_000);
  assert.equal(blob.q, 0.72);
  assert.deepEqual(tried, [0.86, 0.8, 0.72]);
});

// ---------- GitHub upload limits ----------

test('GitHub client waits and retries when uploading too fast', async () => {
  let blobCalls = 0;
  const waits = [];
  const fetchImpl = async (url, opts) => {
    const path = url.replace('https://api.github.com', '');
    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
    if (path.endsWith('/git/blobs')) {
      blobCalls++;
      if (blobCalls === 1) return json({ message: 'You have exceeded a secondary rate limit.' }, 403, { 'retry-after': '7' });
      return json({ sha: `blob${blobCalls}` }, 201);
    }
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'h1' } });
    if (path.includes('/git/commits/') && opts.method === 'GET') return json({ tree: { sha: 't0' } });
    if (path.endsWith('/git/trees')) return json({ sha: 't1' }, 201);
    if (path.endsWith('/git/commits')) return json({ sha: 'c1' }, 201);
    if (path.endsWith('/git/refs/heads/main')) return json({ object: { sha: 'c1' } });
    return json({}, 500);
  };
  const repo = new GitHubRepo({ owner: 'o', repo: 'r', token: 'T', fetchImpl, sleepImpl: async (ms) => { waits.push(ms); } });
  const progress = [];
  await repo.commit('x', [{ path: 'a.bin', bytes: new Uint8Array([1]) }, { path: 'b.bin', bytes: new Uint8Array([2]) }], { onProgress: (p) => progress.push(p.done) });
  assert.deepEqual(waits, [7000]);
  assert.equal(blobCalls, 3);
  assert.deepEqual(progress, [0, 1, 2]);
});
