// Builds the sample archive using the same code the admin panel uses.
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { MemoryRepo } from '../site/assets/js/lib/memoryRepo.js';
import { samplePeople, sampleRels, samplePlaces, sampleMoves } from './sampleFamily.js';
import { relPeople } from '../site/assets/js/lib/model.js';

export async function buildSampleArchive(password, { iterations, settings = {} } = {}) {
  const repo = new MemoryRepo();
  const store = new AdminStore(repo, iterations ? { iterations } : {});
  await store.load();
  store.config.siteTitle = 'The Sampleyan Family Archive';
  await store.createFamilyPassword(password);
  for (const pl of samplePlaces()) store.savePlace(pl);
  const rels = sampleRels();
  for (const p of samplePeople()) {
    store.applyPersonEdit(p, [...store.relsOf(p.id), ...rels.filter((r) => relPeople(r).includes(p.id) && !store.rels.includes(r))]);
  }
  for (const m of sampleMoves()) store.saveMove(m);
  if (Object.keys(settings).length) store.setFamilySettings(settings);
  await store.save();
  return { repo, store };
}
