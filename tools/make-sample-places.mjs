// Adds the made-up sample places and moves to the sample archive on disk,
// and links the sample people and photos to them.
// Usage: SAMPLE_PASSWORD=... node tools/make-sample-places.mjs
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { MemoryRepo } from '../site/assets/js/lib/memoryRepo.js';
import { samplePeople, samplePlaces, sampleMoves, sampleRels } from './sampleFamily.js';

const password = process.env.SAMPLE_PASSWORD;
if (!password) { console.error('Set SAMPLE_PASSWORD'); process.exit(1); }
const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');

const repo = new MemoryRepo({}, {
  loader: async (path) => { try { return new Uint8Array(await readFile(join(siteDir, path))); } catch { return null; } },
});
const store = new AdminStore(repo);
await store.load();
await store.unlock(password);

for (const pl of samplePlaces()) store.savePlace(pl);

const wanted = new Map(samplePeople().map((p) => [p.id, p]));
const relsWanted = new Map(sampleRels().map((r) => [r.id, r]));
for (const id of wanted.keys()) {
  if (!store.people.has(id)) continue;
  const person = await store.getPerson(id);
  const w = wanted.get(id);
  person.birth = { ...person.birth, ...w.birth };
  if (w.death) person.death = { ...person.death, ...w.death };
  person.events = (person.events || []).filter((e) => e.type !== 'move');
  const rels = store.relsOf(id).map((r) => ({ ...r, ...(relsWanted.get(r.id)?.placeId ? { placeId: relsWanted.get(r.id).placeId } : {}) }));
  store.applyPersonEdit(person, rels);
}
for (const m of sampleMoves()) store.saveMove(m);

// Link the sample photos to the saved places.
for (const ph of [...store.photos.values()]) {
  if (ph.place === 'Yerevan' && !ph.placeId) {
    const details = await store.getPhotoDetails(ph.id);
    store.updatePhoto({ ...ph, ...details, placeId: 'lsampleyerevan' });
  }
}
await store.save();

for (const c of repo.commits.at(-1).changes) {
  const full = join(siteDir, c.path);
  if (c.delete) { await rm(full, { force: true }); console.log('deleted', c.path); continue; }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, c.bytes || c.content);
  console.log('wrote', c.path);
}
