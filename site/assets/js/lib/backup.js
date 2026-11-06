// "Download full backup": everything in readable form, in one ZIP file.
import { makeZip } from './zip.js';
import { exportGedcom } from './gedcom.js';
import { personPath, photoDetailsPath, mediaPath, displayName, photoTitle } from './model.js';
import { decryptJSON, decryptBytes } from './crypto.js';
import { formatDate, estimateYear } from './dates.js';

const README = (date, withPhotos) => `FAMILY ARCHIVE BACKUP — ${date}

This ZIP holds a complete, READABLE copy of the family archive, including
family-only information (it is NOT encrypted). Keep it somewhere safe and private,
for example on an external drive that stays at home.

What is inside
  archive.json   Everything: people, family links, places, moves and photo details,
                 in a structured format any programmer can read.
  family.ged     The family tree in GEDCOM format. Open or import it in other
                 genealogy programs (Gramps, MyHeritage, Ancestry, RootsMagic...).
  people.txt     A simple list of everyone, readable in any text editor.
${withPhotos ? '  photos/        Every photo and scanned document (the web-sized copies kept in the\n                 archive, not your full-size originals).\n' : '  (Photos were not included in this backup.)\n'}
The archive itself (with full history of every change) is also kept on GitHub.
Remember to keep your full-resolution original photos and scans outside the archive too.
`;

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/** Every person's full record, read efficiently. */
export async function gatherPeople(store, onProgress) {
  let tree = null;
  try { tree = await store.repo.listTree(store.head); } catch { tree = null; }
  const people = new Map();
  const ids = [...store.people.keys()];
  for (let i = 0; i < ids.length; i++) {
    const s = store.people.get(ids[i]);
    onProgress?.({ step: 'people', done: i, total: ids.length });
    let full = null;
    if (store.pending.has(s.id)) full = await store.getPerson(s.id);
    else {
      const bytes = await store.readLatestBytes(personPath(s.id, s.privacy), tree);
      const text = bytes ? new TextDecoder().decode(bytes) : null;
      if (text) full = s.privacy === 'public' ? JSON.parse(text) : await decryptJSON(store.key, text);
    }
    full = { ...(full || s) };
    if (s.photo) full.photo = s.photo;
    people.set(s.id, full);
  }
  return { people, tree };
}

/**
 * Build the backup ZIP. Returns { parts, filename, counts }.
 * onProgress({ step, done, total }).
 */
export async function buildBackup(store, { withPhotos = true, onProgress } = {}) {
  if (store.pendingCount) throw new Error('Please Save & publish (or discard) your changes before making a backup.');
  const { people, tree } = await gatherPeople(store, onProgress);
  const readText = async (path) => {
    const bytes = await store.readLatestBytes(path, tree);
    return bytes ? new TextDecoder().decode(bytes) : null;
  };

  // Photos: details (+ images).
  const files = [];
  const photos = [];
  const list = [...store.photos.values()];
  for (let i = 0; i < list.length; i++) {
    const ph = list[i];
    onProgress?.({ step: 'photos', done: i, total: list.length });
    const dt = await readText(photoDetailsPath(ph.id, ph.privacy));
    let details = {};
    if (dt) details = ph.privacy === 'public' ? JSON.parse(dt) : await decryptJSON(store.key, dt);
    const entry = { ...ph, ...details };
    if (withPhotos) {
      let bytes = await store.readLatestBytes(mediaPath(ph, ph.privacy, 'full'), tree);
      if (bytes && ph.privacy === 'family') bytes = await decryptBytes(store.key, bytes);
      if (bytes) {
        const y = estimateYear(ph.date);
        const tagged = (ph.tags || []).map((t) => store.people.get(t.person)).filter(Boolean).map((s) => displayName(s)).slice(0, 3);
        // Year - title - (people), shortened neatly if too long.
        let name = safeName([y ?? 'undated', photoTitle(ph), tagged.length ? `(${tagged.join(', ')})` : ''].filter(Boolean).join(' - '));
        if (name.length >= 80) name = safeName(`${y ?? 'undated'} - ${photoTitle(ph)}`);
        entry.file = `photos/${name}.jpg`;
        files.push({ name: entry.file, data: bytes });
      }
    }
    photos.push(entry);
  }

  onProgress?.({ step: 'packing', done: 0, total: 1 });
  const date = new Date().toISOString().slice(0, 10);
  const archive = {
    exported: new Date().toISOString(),
    title: store.config.siteTitle,
    people: [...people.values()],
    relationships: store.rels,
    places: [...store.places.values()],
    moves: [...store.moves.values()],
    photos,
    familySettings: store.familySettings,
  };
  const { text: ged } = exportGedcom({ people, rels: store.rels, places: store.places, moves: store.moves, title: store.config.siteTitle });
  const txt = [...people.values()]
    .sort((a, b) => displayName(a).localeCompare(displayName(b)))
    .map((p) => {
      const life = [p.birth?.date && `born ${formatDate(p.birth.date)}`, p.death?.date && `died ${formatDate(p.death.date)}`].filter(Boolean).join(', ');
      return `${displayName(p)}${life ? ` — ${life}` : ''}${p.privacy === 'public' ? '' : '  [family only]'}`;
    }).join('\n');
  const parts = makeZip([
    { name: 'README.txt', data: README(date, withPhotos) },
    { name: 'archive.json', data: JSON.stringify(archive, null, 2) },
    { name: 'family.ged', data: ged },
    { name: 'people.txt', data: `${txt}\n` },
    ...files,
  ]);
  return { parts, filename: `family-archive-backup-${date}${withPhotos ? '' : '-no-photos'}.zip`, counts: { people: people.size, photos: photos.length, images: files.length } };
}
