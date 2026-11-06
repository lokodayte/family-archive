// Everything the admin panel does with data: load, edit, group edits, save as one commit.
import {
  createKeyring, unlockKeyring, wrapKey, generateDataKey, encryptJSON, decryptJSON,
  encryptBytes, decryptBytes, DEFAULT_ITERATIONS, WrongPasswordError,
} from './crypto.js';
import { gitBlobSha } from './hash.js';
import {
  summarize, normalizePerson, splitIndex, mergeIndexes, personPath, familyShardPath,
  PUBLIC_INDEX_PATH, CONFIG_PATH, SETTINGS_PATH, DEFAULT_SHARDS, relPeople, displayName,
  effectivePrivacy, effectivePhotoPrivacy, mediaPath, photoDetailsPath, splitPhoto, newId, compact,
} from './model.js';
import { buildGraph, findProblems, PROBLEM_TEXT } from './relations.js';
import { estimateYear } from './dates.js';

const involves = (r, id) => relPeople(r).includes(id);

export class AdminStore {
  /**
   * @param repo  GitHubRepo or MemoryRepo
   * @param opts.siteLoader  optional async (path) => Uint8Array|null, reads published files
   *                         (faster than the GitHub API for images)
   */
  constructor(repo, { iterations = DEFAULT_ITERATIONS, siteLoader } = {}) {
    this.repo = repo;
    this.iterations = iterations;
    this.siteLoader = siteLoader;
    this.key = null;
    this.reset();
  }

  reset() {
    this.head = null;
    this.config = {};
    this.publicIndex = { v: 1, people: [], rels: [] };
    this.familyShards = [];
    this.familySettings = {};
    this.people = new Map();
    this.rels = [];
    this.photos = new Map();
    this.places = new Map();
    this.moves = new Map();
    this.prevPrivacy = new Map();
    this.prevPhotos = new Map(); // photo summaries as they are on GitHub right now
    this.personCache = new Map();
    this.photoDetailsCache = new Map();
    this.pending = new Map(); // person id -> { person } or { deleted: true }
    this.pendingPhotos = new Map(); // photo id -> { details?, image?, thumb? } or { deleted: true }
    this.ops = []; // [{ text, public, photo }]
    this.settingsDirty = false;
    this.configDirty = false;
    this.lastPublicText = null;
    this.lastShardText = [];
  }

  get shardCount() { return this.config.familyShards || DEFAULT_SHARDS; }
  get hasFamilyPassword() { return !!this.config.crypto; }
  get pendingCount() { return this.ops.length; }
  get graph() { return buildGraph(this.rels); }

  /** Bytes of new images waiting to be uploaded. */
  get pendingUploadBytes() {
    let n = 0;
    for (const p of this.pendingPhotos.values()) n += (p.image?.length || 0) + (p.thumb?.length || 0);
    return n;
  }

  // ---------- loading ----------

  async load() {
    this.reset();
    this.head = await this.repo.getHead();
    const cfg = await this.repo.readText(CONFIG_PATH, this.head);
    this.config = cfg ? JSON.parse(cfg) : { siteTitle: 'Our Family Archive', familyShards: DEFAULT_SHARDS };
    const pub = await this.repo.readText(PUBLIC_INDEX_PATH, this.head);
    this.publicIndex = pub ? JSON.parse(pub) : { v: 1, people: [], rels: [] };
    this.lastPublicText = JSON.stringify(this.publicIndex);
    this.rebuild();
  }

  rebuild() {
    const merged = mergeIndexes(this.publicIndex, this.familyShards);
    this.people = merged.people;
    this.rels = merged.rels;
    this.photos = merged.photos;
    this.places = merged.places;
    this.moves = merged.moves;
    this.prevPrivacy = new Map([...this.people.values()].map((s) => [s.id, s.privacy]));
    this.prevPhotos = new Map([...this.photos.values()].map((s) => [s.id, structuredClone(s)]));
  }

  /** First-time setup: choose the family password. Saved immediately. */
  async createFamilyPassword(password) {
    if (this.hasFamilyPassword) throw new Error('A family password already exists.');
    const { key, keyring } = await createKeyring(password, this.iterations);
    this.key = key;
    this.config = { ...this.config, crypto: keyring, familyShards: this.config.familyShards || DEFAULT_SHARDS };
    this.configDirty = true;
    this.familyShards = Array.from({ length: this.shardCount }, () => ({ people: [], rels: [] }));
    this.lastShardText = this.familyShards.map(() => null);
    this.ops.push({ text: 'Set up family password', public: true });
    return this.save();
  }

  async unlock(password) {
    const key = await unlockKeyring(this.config.crypto, password);
    await this.useKey(key);
    return key;
  }

  async useKey(key) {
    const shards = [];
    const texts = await Promise.all(
      Array.from({ length: this.shardCount }, (_, i) => this.repo.readText(familyShardPath(i), this.head)),
    );
    for (const text of texts) shards.push(text ? await decryptJSON(key, text) : { people: [], rels: [] });
    const settingsText = await this.repo.readText(SETTINGS_PATH, this.head);
    this.familySettings = settingsText ? await decryptJSON(key, settingsText) : {};
    this.key = key;
    this.familyShards = shards;
    this.lastShardText = texts.map((t, i) => (t ? JSON.stringify(shards[i]) : null));
    this.rebuild();
  }

  // ---------- reading people ----------

  async getPerson(id) {
    const p = this.pending.get(id);
    let person;
    if (p?.person) person = structuredClone(p.person);
    else if (this.personCache.has(id)) person = structuredClone(this.personCache.get(id));
    else {
      const privacy = this.prevPrivacy.get(id);
      if (!privacy) return null;
      const text = await this.repo.readText(personPath(id, privacy), this.head);
      if (!text) person = { ...structuredClone(this.people.get(id)) }; // only in index
      else person = privacy === 'public' ? JSON.parse(text) : await decryptJSON(this.key, text);
      this.personCache.set(id, person);
      person = structuredClone(person);
    }
    // The index is the source of truth for the profile photo.
    const photo = this.people.get(id)?.photo;
    if (photo) person.photo = photo; else delete person.photo;
    return person;
  }

  relsOf(id) {
    return this.rels.filter((r) => involves(r, id));
  }

  // ---------- reading photos ----------

  photoPrivacy(summary) {
    return effectivePhotoPrivacy(summary, this.people);
  }

  async getPhotoDetails(id) {
    const p = this.pendingPhotos.get(id);
    if (p?.details) return structuredClone(p.details);
    if (this.photoDetailsCache.has(id)) return structuredClone(this.photoDetailsCache.get(id));
    const prev = this.prevPhotos.get(id);
    if (!prev) return { id };
    const text = await this.repo.readText(photoDetailsPath(id, prev.privacy), this.head);
    let details = { id };
    if (text) details = prev.privacy === 'public' ? JSON.parse(text) : await decryptJSON(this.key, text);
    this.photoDetailsCache.set(id, details);
    return structuredClone(details);
  }

  /** Image bytes (readable JPEG) for a photo: 'full' or 'thumb'. */
  async getImageBytes(id, which = 'full') {
    const p = this.pendingPhotos.get(id);
    if (p?.image) return which === 'thumb' ? p.thumb : p.image;
    const prev = this.prevPhotos.get(id);
    if (!prev) return null;
    return this.#readMedia(prev, which, { preferSite: true });
  }

  async #readMedia(summary, which, { preferSite = false } = {}) {
    const path = mediaPath(summary, summary.privacy, which);
    const open = (bytes) => (summary.privacy === 'family' ? decryptBytes(this.key, bytes) : bytes);
    if (preferSite && this.siteLoader) {
      // The published copy is quicker to get; if it is missing or out of date, ask GitHub.
      try {
        const bytes = await this.siteLoader(path);
        if (bytes) return await open(bytes);
      } catch { /* fall back below */ }
    }
    const bytes = await this.repo.readBytes(path, this.head);
    return bytes ? open(bytes) : null;
  }

  async #seal(bytes, privacy, key = this.key) {
    if (privacy === 'public') return bytes;
    if (!key) throw new Error('Unlock with the family password first.');
    return encryptBytes(key, bytes);
  }

  // ---------- editing people (kept in memory until Save) ----------

  /**
   * Check a person edit before keeping it. Returns a list of problem messages.
   * draftRels = every link that involves this person after the edit.
   */
  checkEdit(person, draftRels) {
    const others = this.rels.filter((r) => !involves(r, person.id));
    const problems = findProblems([...others, ...draftRels])
      .filter((p) => draftRels.includes(p.rel))
      .map((p) => PROBLEM_TEXT[p.code] || p.code);
    return [...new Set(problems)];
  }

  /** Keep an edited (or new) person, their links, and any newly created relatives. */
  applyPersonEdit(person, draftRels, newPeople = []) {
    for (const np of newPeople) this.#stage(np, `Added ${displayName(summarize(np))}`);
    const isNew = !this.people.has(person.id);
    this.#stage(person, `${isNew ? 'Added' : 'Edited'} ${displayName(summarize(person))}`);
    this.rels = [...this.rels.filter((r) => !involves(r, person.id)), ...draftRels];
  }

  #stage(person, text) {
    const clean = normalizePerson(person);
    if (clean.photo && !this.photos.has(clean.photo)) delete clean.photo;
    this.pending.set(clean.id, { person: clean });
    this.people.set(clean.id, summarize(clean));
    this.ops.push({ text, public: effectivePrivacy(clean) === 'public' });
  }

  deletePerson(id) {
    const s = this.people.get(id);
    if (!s) return;
    const wasSaved = this.prevPrivacy.has(id);
    this.people.delete(id);
    this.rels = this.rels.filter((r) => !involves(r, id));
    // Remove their name tags from photos.
    for (const [pid, ph] of this.photos) {
      if (ph.tags?.some((t) => t.person === id)) this.photos.set(pid, { ...ph, tags: ph.tags.filter((t) => t.person !== id) });
    }
    for (const [mid, m] of this.moves) {
      if (!m.people?.includes(id)) continue;
      const people = m.people.filter((p) => p !== id);
      if (people.length) this.moves.set(mid, { ...m, people });
      else this.moves.delete(mid);
    }
    if (wasSaved) this.pending.set(id, { deleted: true });
    else this.pending.delete(id);
    this.ops.push({ text: `Deleted ${displayName(s)}`, public: s.privacy === 'public' });
  }

  /** Set (or clear, with null) a person's profile photo. */
  setPortrait(personId, photoId) {
    const s = this.people.get(personId);
    if (!s) return;
    const next = { ...s };
    if (photoId) next.photo = photoId; else delete next.photo;
    this.people.set(personId, next);
    const pend = this.pending.get(personId);
    if (pend?.person) { if (photoId) pend.person.photo = photoId; else delete pend.person.photo; }
    this.ops.push({ text: `Changed profile photo of ${displayName(s)}`, public: s.privacy === 'public' });
  }

  // ---------- editing photos ----------

  /**
   * Add a new photo or document.
   * photo: { kind, title, date, place, choice, tags, description, story, originalName }
   * image/thumb: JPEG bytes; w/h: pixel size of the full image
   */
  addPhoto(photo, { image, thumb, w, h }) {
    const id = photo.id || newId('f');
    const { summary, details } = splitPhoto({
      ...photo, id, v: 1, w, h, bytes: image.length + thumb.length, added: new Date().toISOString().slice(0, 10),
    });
    summary.privacy = this.photoPrivacy(summary);
    this.photos.set(id, summary);
    this.pendingPhotos.set(id, { details, image, thumb });
    this.ops.push({ text: 'Added a photo', photo: true, photoId: id });
    return id;
  }

  /** Change a photo's information (title, date, tags, privacy, story...). */
  updatePhoto(photo) {
    const old = this.photos.get(photo.id);
    if (!old) throw new Error('Unknown photo');
    const { summary, details } = splitPhoto({ ...photo, v: old.v, w: old.w, h: old.h, bytes: old.bytes });
    summary.privacy = this.photoPrivacy(summary);
    this.photos.set(photo.id, summary);
    const pend = this.pendingPhotos.get(photo.id) || {};
    this.pendingPhotos.set(photo.id, { ...pend, details });
    // A photo that isn't saved yet is already counted as "Added a photo".
    if (this.prevPhotos.has(photo.id)) this.ops.push({ text: 'Edited a photo', photo: true });
  }

  /** Swap in a new image (e.g. a better scan, or rotated). The old one stays in the history. */
  replacePhotoImage(id, { image, thumb, w, h }) {
    const old = this.photos.get(id);
    if (!old) throw new Error('Unknown photo');
    const prev = this.prevPhotos.get(id);
    const v = prev ? (prev.v || 1) + 1 : old.v || 1;
    this.photos.set(id, { ...old, v, w, h, bytes: image.length + thumb.length });
    const pend = this.pendingPhotos.get(id) || {};
    this.pendingPhotos.set(id, { ...pend, image, thumb });
    if (prev) this.ops.push({ text: 'Replaced a photo image', photo: true });
  }

  /** How much storage the image that would be replaced uses (stays in history). */
  replacedBytes(id) {
    return this.prevPhotos.get(id)?.bytes || 0;
  }

  deletePhoto(id) {
    if (!this.photos.has(id)) return;
    this.photos.delete(id);
    for (const [pid, s] of this.people) {
      if (s.photo === id) {
        const { photo, ...rest } = s;
        this.people.set(pid, rest);
        const pend = this.pending.get(pid);
        if (pend?.person) delete pend.person.photo;
      }
    }
    if (this.prevPhotos.has(id)) {
      this.pendingPhotos.set(id, { deleted: true });
      this.ops.push({ text: 'Deleted a photo', photo: true });
    } else {
      // Never saved: just forget it (and its "Added a photo" line).
      this.pendingPhotos.delete(id);
      const i = this.ops.findIndex((o) => o.photoId === id);
      if (i >= 0) this.ops.splice(i, 1);
    }
  }

  photosOf(personId) {
    return [...this.photos.values()].filter((p) => p.tags?.some((t) => t.person === personId));
  }

  // ---------- places and moves (they live only in the index files) ----------

  /** Add or change a saved place. Returns its id. */
  savePlace(place) {
    const clean = compact({ ...place, id: place.id || newId('l') }) || {};
    clean.id = place.id || clean.id;
    clean.name = (place.name || '').trim() || 'Unnamed place';
    for (const k of ['lat', 'lng']) {
      if (Number.isFinite(place[k])) clean[k] = Math.round(place[k] * 1e5) / 1e5; else delete clean[k];
    }
    const isNew = !this.places.has(clean.id);
    this.places.set(clean.id, clean);
    this.ops.push({ text: isNew ? 'Added a place' : 'Edited a place', place: true });
    return clean.id;
  }

  /** What still uses a place (so you can be warned before deleting it). */
  placeUsage(placeId) {
    const moves = [...this.moves.values()].filter((m) => m.from === placeId || m.to === placeId);
    const people = [...this.people.values()].filter((s) => s.birth?.placeId === placeId || s.death?.placeId === placeId
      || (s.placeRefs || []).includes(placeId));
    const photos = [...this.photos.values()].filter((p) => p.placeId === placeId);
    const rels = this.rels.filter((r) => r.placeId === placeId);
    return { moves, people, photos, rels };
  }

  /** Delete a place. Moves using it must be changed first; people and photos keep the name as text. */
  deletePlace(placeId) {
    const use = this.placeUsage(placeId);
    if (use.moves.length) throw new Error(`This place is used by ${use.moves.length} move(s). Change or delete those moves first.`);
    this.places.delete(placeId);
    this.ops.push({ text: 'Deleted a place', place: true });
  }

  /** Add or change a move. Returns its id. */
  saveMove(move) {
    const people = [...new Set(move.people || [])].filter((id) => this.people.has(id));
    if (!people.length) throw new Error('Choose at least one person who moved.');
    if (!move.from && !move.to) throw new Error('Choose where they moved from or to.');
    const clean = compact({ ...move, people }) || {};
    clean.id = move.id || newId('m');
    clean.people = people;
    const isNew = !this.moves.has(clean.id);
    this.moves.set(clean.id, clean);
    this.ops.push({ text: isNew ? 'Added a move' : 'Edited a move', move: true });
    return clean.id;
  }

  deleteMove(id) {
    if (!this.moves.delete(id)) return;
    this.ops.push({ text: 'Deleted a move', move: true });
  }

  movesOf(personId) {
    return [...this.moves.values()].filter((m) => m.people?.includes(personId));
  }

  // ---------- importing ----------

  /** Add many people, links and places at once (e.g. from a GEDCOM file) as one change. */
  importBatch({ people = [], rels = [], places = [] }, label = 'Imported people from a GEDCOM file') {
    for (const pl of places) this.places.set(pl.id, compact(pl) || pl);
    for (const person of people) {
      const clean = normalizePerson(person);
      this.pending.set(clean.id, { person: clean });
      this.people.set(clean.id, summarize(clean));
    }
    this.rels.push(...rels);
    this.ops.push({ text: `${label} (${people.length} people)`, public: false });
  }

  /** People who look like someone already in the archive (same name and birth year). */
  likelyDuplicates(people) {
    const key = (s) => `${displayName(s).toLowerCase()}|${estimateYear(s.birth?.date) ?? ''}`;
    const named = (s) => !s.placeholder || displayName(s) !== 'Unknown person';
    const existing = new Set([...this.people.values()].filter(named).map(key));
    return people.filter((p) => named(p) && existing.has(key(p)));
  }

  // ---------- history and undo ----------

  /** Read the whole archive as it was at a past change. */
  async readSnapshot(ref) {
    const cfgText = await this.repo.readText(CONFIG_PATH, ref);
    const config = cfgText ? JSON.parse(cfgText) : {};
    const pubText = await this.repo.readText(PUBLIC_INDEX_PATH, ref);
    const pub = pubText ? JSON.parse(pubText) : { people: [], rels: [] };
    const n = config.familyShards || DEFAULT_SHARDS;
    const shards = [];
    let settings = {};
    if (config.crypto) {
      const texts = await Promise.all(Array.from({ length: n }, (_, i) => this.repo.readText(familyShardPath(i), ref)));
      for (const text of texts) shards.push(text ? await decryptJSON(this.key, text) : { people: [], rels: [] });
      const st = await this.repo.readText(SETTINGS_PATH, ref);
      settings = st ? await decryptJSON(this.key, st) : {};
    }
    return { config, settings, ...mergeIndexes(pub, shards) };
  }

  /** The encrypted "what changed" note saved with a change (null if none). */
  async readChangeNote(changeId) {
    const text = await this.repo.readText(`data/family/changes/${changeId}.enc`);
    if (!text) return null;
    try { return await decryptJSON(this.key, text); } catch { return null; }
  }

  async #readPersonAt(id, privacy, ref) {
    const text = await this.repo.readText(personPath(id, privacy), ref);
    if (!text) return null;
    return privacy === 'public' ? JSON.parse(text) : decryptJSON(this.key, text);
  }

  async #readDetailsAt(id, privacy, ref) {
    const text = await this.repo.readText(photoDetailsPath(id, privacy), ref);
    if (!text) return { id };
    return privacy === 'public' ? JSON.parse(text) : decryptJSON(this.key, text);
  }

  async #readMediaAt(summary, which, ref) {
    const bytes = await this.repo.readBytes(mediaPath(summary, summary.privacy, which), ref);
    if (!bytes) return null;
    return summary.privacy === 'family' ? decryptBytes(this.key, bytes) : bytes;
  }

  /**
   * Undo one past change by putting back what it changed — but only things that
   * haven't been changed again since. Saves the result as a new change.
   * Returns { undone, skipped: [descriptions], sha }.
   */
  async undoCommit(sha) {
    if (this.pendingCount) throw new Error('Save or discard your other changes first.');
    if (!this.key) throw new Error('Unlock with the family password first.');
    const info = await this.repo.getCommit(sha);
    if (!info.parent) throw new Error('The very first version of the archive can’t be undone.');
    if (info.truncated) throw new Error('This change is too large to undo automatically.');
    if (/family password/i.test(info.message)) throw new Error('Password changes can’t be undone here. Change the password again in Settings instead.');
    const files = info.files.filter((f) => f.startsWith('data/') || f.startsWith('media/'));
    if (!files.length) throw new Error('This was an update to the website itself, not to the archive, so there is nothing to undo.');

    let before;
    let after;
    try {
      before = await this.readSnapshot(info.parent);
      after = await this.readSnapshot(sha);
    } catch (err) {
      if (err instanceof WrongPasswordError) throw new Error('This change was made before the family password was fully re-locked, so it can’t be undone automatically.');
      throw err;
    }

    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const changed = (bm, am) => [...new Set([...bm.keys(), ...am.keys()])].filter((id) => !same(bm.get(id), am.get(id)));
    const skipped = [];
    let undone = 0;
    const touchedFile = (path) => files.includes(path);

    // People: their index summary, and their full record if the change touched it.
    const peopleIds = new Set(changed(before.people, after.people));
    for (const f of files) {
      const m = f.match(/^data\/(?:public|family)\/people\/(.+)\.(?:json|enc)$/);
      if (m) peopleIds.add(m[1]);
    }
    for (const id of peopleIds) {
      const b = before.people.get(id);
      const a = after.people.get(id);
      const cur = this.people.get(id);
      const name = displayName(b || a || cur || {});
      if (!same(cur, a)) {
        // A full-record-only change: compare the records themselves.
        if (!(a && cur && same(cur, a))) { skipped.push(name); continue; }
      }
      if (a && cur && same(cur, a) && (touchedFile(personPath(id, 'public')) || touchedFile(personPath(id, 'family')))) {
        const nowFull = await this.getPerson(id);
        const afterFull = await this.#readPersonAt(id, a.privacy, sha);
        const strip = (p) => { if (!p) return p; const { photo, ...rest } = p; return rest; };
        if (afterFull && !same(strip(normalizePerson(nowFull)), strip(normalizePerson(afterFull)))) { skipped.push(name); continue; }
      }
      if (!b) {
        // The change added this person: remove them again.
        this.people.delete(id);
        if (this.prevPrivacy.has(id)) this.pending.set(id, { deleted: true });
        undone++;
        continue;
      }
      let full = await this.#readPersonAt(id, b.privacy, info.parent);
      if (!full) full = { ...b };
      const clean = normalizePerson({ ...full, photo: b.photo });
      if (!b.photo) delete clean.photo;
      this.pending.set(id, { person: clean });
      this.people.set(id, structuredClone(b));
      this.personCache.delete(id);
      undone++;
    }

    // Family links, places and moves live only in the index.
    const relIndex = (list) => new Map(list.map((r) => [r.id, r]));
    const relsBefore = relIndex(before.rels);
    const relsAfter = relIndex(after.rels);
    const relsNow = relIndex(this.rels);
    for (const id of changed(relsBefore, relsAfter)) {
      if (!same(relsNow.get(id), relsAfter.get(id))) { skipped.push('a family link'); continue; }
      if (relsBefore.has(id)) relsNow.set(id, structuredClone(relsBefore.get(id)));
      else relsNow.delete(id);
      undone++;
    }
    this.rels = [...relsNow.values()].filter((r) => relPeople(r).every((pid) => this.people.has(pid)));

    for (const [key, label] of [['places', 'a place'], ['moves', 'a move']]) {
      for (const id of changed(before[key], after[key])) {
        if (!same(this[key].get(id), after[key].get(id))) { skipped.push(label); continue; }
        if (before[key].has(id)) this[key].set(id, structuredClone(before[key].get(id)));
        else this[key].delete(id);
        undone++;
      }
    }

    // Photos: index entry, details, and the image itself if it was added, replaced or deleted.
    const noPrivacy = (p) => { if (!p) return p; const { privacy, ...rest } = p; return rest; };
    const photoIds = new Set(changed(before.photos, after.photos));
    for (const f of files) {
      const m = f.match(/^data\/(?:public|family)\/photos\/(.+)\.(?:json|enc)$/);
      if (m) photoIds.add(m[1]);
    }
    for (const id of photoIds) {
      const b = before.photos.get(id);
      const a = after.photos.get(id);
      const cur = this.photos.get(id);
      if (!same(noPrivacy(cur), noPrivacy(a))) { skipped.push(b?.title || a?.title || 'a photo'); continue; }
      if (!b) {
        this.photos.delete(id);
        if (this.prevPhotos.has(id)) this.pendingPhotos.set(id, { deleted: true });
        undone++;
        continue;
      }
      const pend = { details: await this.#readDetailsAt(id, b.privacy, info.parent) };
      if (!a || (a.v || 1) !== (b.v || 1)) {
        pend.image = await this.#readMediaAt(b, 'full', info.parent);
        pend.thumb = await this.#readMediaAt(b, 'thumb', info.parent);
        if (!pend.image || !pend.thumb) { skipped.push(b.title || 'a photo'); continue; }
        // A new version number keeps browsers from showing a stale copy.
        const latest = Math.max(b.v || 1, a?.v || 1, cur?.v || 1);
        this.photos.set(id, { ...structuredClone(b), v: cur ? latest + 1 : b.v || 1 });
      } else {
        this.photos.set(id, { ...structuredClone(b), v: cur?.v ?? b.v });
      }
      this.pendingPhotos.set(id, pend);
      undone++;
    }

    // Settings
    if (!same(before.settings, after.settings)) {
      if (same(this.familySettings, after.settings)) { this.familySettings = structuredClone(before.settings); this.settingsDirty = true; undone++; } else skipped.push('family settings');
    }
    if ((before.config.siteTitle || '') !== (after.config.siteTitle || '')) {
      if ((this.config.siteTitle || '') === (after.config.siteTitle || '')) { this.config = { ...this.config, siteTitle: before.config.siteTitle }; this.configDirty = true; undone++; } else skipped.push('the archive title');
    }

    if (!undone) return { undone: 0, skipped, sha: null };
    // The private note says exactly what was undone; the public label stays general.
    const changeId = info.message.match(/Change-Id: (\w+)/)?.[1];
    const note = changeId ? await this.readChangeNote(changeId) : null;
    const what = note?.ops?.length ? note.ops.join('; ') : info.message.split('\n')[0].replace(/^Archive: /, '');
    this.ops.push({ text: `Undid: ${what}`, undo: true });
    const result = await this.save();
    return { undone, skipped: [...new Set(skipped)], sha: result?.sha || null };
  }

  /**
   * Read a file as it is now, quickly: use the published copy when it is
   * exactly the latest version (same git blob id), otherwise ask GitHub.
   */
  async readLatestBytes(path, tree) {
    if (this.siteLoader && tree?.has(path)) {
      try {
        const bytes = await this.siteLoader(path);
        if (bytes && await gitBlobSha(bytes) === tree.get(path)) return bytes;
      } catch { /* fall back */ }
    }
    return this.repo.readBytes(path, this.head);
  }

  // ---------- settings ----------

  setFamilySettings(settings) {
    this.familySettings = { ...this.familySettings, ...settings };
    this.settingsDirty = true;
    this.ops.push({ text: 'Changed family settings', public: false });
  }

  setConfig(patch) {
    this.config = { ...this.config, ...patch };
    this.configDirty = true;
    this.ops.push({ text: 'Changed site settings', public: true });
  }

  // ---------- saving ----------

  commitMessage() {
    // Never put family-only names in commit messages: the repository is public.
    const generic = (o) => o.photo || o.place || o.move || o.undo;
    const pub = this.ops.filter((o) => o.public && !generic(o)).map((o) => o.text);
    const count = (k, word) => {
      const n = this.ops.filter((o) => o[k]).length;
      if (n) parts.push(`${n} ${word} change${n === 1 ? '' : 's'}`);
      return n;
    };
    const parts = [...pub];
    const undos = this.ops.filter((o) => o.undo).length;
    if (undos) parts.unshift('Undo of an earlier change');
    const photos = undos + count('photo', 'photo') + count('place', 'place') + count('move', 'move');
    const fam = this.ops.length - pub.length - photos;
    if (fam) parts.push(`${fam} family-only change${fam === 1 ? '' : 's'}`);
    return parts.length ? `Archive: ${parts.join('; ')}` : 'Archive update';
  }

  /** Work out every file that must be written or deleted. */
  async buildChanges() {
    const changes = [];
    // People
    for (const [id, p] of this.pending) {
      const prev = this.prevPrivacy.get(id);
      if (p.deleted) {
        if (prev) changes.push({ path: personPath(id, prev), delete: true });
        continue;
      }
      const priv = effectivePrivacy(p.person);
      if (priv === 'family' && !this.key) throw new Error('Unlock with the family password first.');
      const { photo, ...withoutPhoto } = p.person; // the index holds the profile photo
      const content = priv === 'public'
        ? JSON.stringify(withoutPhoto, null, 1)
        : await encryptJSON(this.key, withoutPhoto);
      changes.push({ path: personPath(id, priv), content });
      if (prev && prev !== priv) changes.push({ path: personPath(id, prev), delete: true });
    }

    // Photos: new images, replaced images, moves between public and family, details
    const finalPhotos = new Map();
    for (const [id, s] of this.photos) {
      const eff = this.photoPrivacy(s);
      const cur = { ...s, privacy: eff };
      finalPhotos.set(id, cur);
      const prev = this.prevPhotos.get(id);
      const pend = this.pendingPhotos.get(id);
      const moved = !!prev && prev.privacy !== eff;
      const oldMedia = () => prev ? [
        { path: mediaPath(prev, prev.privacy, 'full'), delete: true },
        { path: mediaPath(prev, prev.privacy, 'thumb'), delete: true },
      ] : [];
      if (pend?.image) {
        changes.push({ path: mediaPath(cur, eff, 'full'), bytes: await this.#seal(pend.image, eff) });
        changes.push({ path: mediaPath(cur, eff, 'thumb'), bytes: await this.#seal(pend.thumb, eff) });
        if (prev && (moved || (prev.v || 1) !== (cur.v || 1))) changes.push(...oldMedia());
      } else if (moved) {
        for (const which of ['full', 'thumb']) {
          const bytes = await this.#readMedia(prev, which);
          if (bytes) changes.push({ path: mediaPath(cur, eff, which), bytes: await this.#seal(bytes, eff) });
        }
        changes.push(...oldMedia());
      }
      if (pend?.details || moved || !prev) {
        const details = pend?.details || await this.getPhotoDetails(id);
        changes.push({
          path: photoDetailsPath(id, eff),
          content: eff === 'public' ? JSON.stringify(details, null, 1) : await encryptJSON(this.key, details),
        });
        if (moved) changes.push({ path: photoDetailsPath(id, prev.privacy), delete: true });
      }
    }
    for (const [id, p] of this.pendingPhotos) {
      if (!p.deleted) continue;
      const prev = this.prevPhotos.get(id);
      if (!prev) continue;
      changes.push(
        { path: mediaPath(prev, prev.privacy, 'full'), delete: true },
        { path: mediaPath(prev, prev.privacy, 'thumb'), delete: true },
        { path: photoDetailsPath(id, prev.privacy), delete: true },
      );
    }

    // Index files: only the parts that actually changed are rewritten.
    const { publicIndex, familyShards } = splitIndex(this.people, this.rels, this.shardCount, this.photos, { places: this.places, moves: this.moves });
    const pubText = JSON.stringify(publicIndex);
    if (pubText !== this.lastPublicText) {
      changes.push({ path: PUBLIC_INDEX_PATH, content: JSON.stringify(publicIndex, null, 1) });
    }
    const shardTexts = familyShards.map((s) => JSON.stringify(s));
    for (let i = 0; i < familyShards.length; i++) {
      if (shardTexts[i] === this.lastShardText[i]) continue;
      if (!this.key) {
        const sh = familyShards[i];
        if (sh.people.length || sh.rels.length || sh.photos?.length || sh.portraits) throw new Error('Unlock with the family password first.');
        continue;
      }
      changes.push({ path: familyShardPath(i), content: await encryptJSON(this.key, familyShards[i]) });
    }
    if (this.settingsDirty) {
      changes.push({ path: SETTINGS_PATH, content: await encryptJSON(this.key, this.familySettings) });
    }
    if (this.configDirty) {
      changes.push({ path: CONFIG_PATH, content: JSON.stringify(this.config, null, 2) });
    }
    return { changes, publicIndex, familyShards, pubText, shardTexts, finalPhotos };
  }

  /**
   * Save everything as one commit. Returns { sha } or null when nothing changed.
   * onProgress({ done, total }) reports image uploads.
   */
  async save({ onProgress } = {}) {
    const { changes, publicIndex, familyShards, pubText, shardTexts, finalPhotos } = await this.buildChanges();
    if (!changes.length) { this.clearPending(); return null; }
    // An encrypted note of exactly what changed (with names), for the "Recent changes" page.
    const changeId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + newId('').slice(0, 5);
    let message = this.commitMessage();
    if (this.key) {
      changes.push({
        path: `data/family/changes/${changeId}.enc`,
        content: await encryptJSON(this.key, { at: new Date().toISOString(), ops: this.ops.map((o) => o.text) }),
      });
      message += `\n\nChange-Id: ${changeId}`;
    }
    const result = await this.repo.commit(message, changes, { onProgress });
    // Success: what we saved is now the starting point.
    for (const [id, p] of this.pending) {
      if (p.deleted) this.personCache.delete(id);
      else this.personCache.set(id, p.person);
    }
    for (const [id, p] of this.pendingPhotos) {
      if (p.deleted) this.photoDetailsCache.delete(id);
      else if (p.details) this.photoDetailsCache.set(id, p.details);
    }
    this.photos = finalPhotos;
    this.prevPhotos = new Map([...finalPhotos].map(([id, s]) => [id, structuredClone(s)]));
    this.publicIndex = publicIndex;
    this.familyShards = familyShards;
    this.lastPublicText = pubText;
    this.lastShardText = this.key ? shardTexts : this.lastShardText;
    this.head = result.sha;
    this.prevPrivacy = new Map([...this.people.values()].map((s) => [s.id, s.privacy]));
    this.clearPending();
    return result;
  }

  clearPending() {
    this.pending.clear();
    this.pendingPhotos.clear();
    this.ops = [];
    this.settingsDirty = false;
    this.configDirty = false;
  }

  /** Throw away unsaved edits. */
  async discard() {
    const key = this.key;
    await this.load();
    if (key) await this.useKey(key);
  }

  // ---------- family password ----------

  /**
   * quick: lock the same data key with the new password (no extra storage).
   * full:  new data key, every family file re-encrypted (use if the old password leaked).
   */
  async changePassword(newPassword, { full = false, onProgress } = {}) {
    if (this.pendingCount) throw new Error('Save or discard your other changes first.');
    if (!this.key) throw new Error('Unlock with the family password first.');
    if (!full) {
      const crypto = await wrapKey(this.key, newPassword, this.iterations);
      this.config = { ...this.config, crypto };
      this.configDirty = true;
      this.ops.push({ text: 'Changed family password', public: true });
      return this.save({ onProgress });
    }

    const newKey = await generateDataKey();
    const changes = [];
    for (const s of this.people.values()) {
      if (s.privacy !== 'family') continue;
      const { photo, ...person } = await this.getPerson(s.id);
      changes.push({ path: personPath(s.id, 'family'), content: await encryptJSON(newKey, person) });
    }
    for (const s of this.prevPhotos.values()) {
      if (s.privacy !== 'family') continue;
      for (const which of ['full', 'thumb']) {
        const bytes = await this.#readMedia(s, which);
        if (bytes) changes.push({ path: mediaPath(s, 'family', which), bytes: await encryptBytes(newKey, bytes) });
      }
      changes.push({ path: photoDetailsPath(s.id, 'family'), content: await encryptJSON(newKey, await this.getPhotoDetails(s.id)) });
    }
    const { familyShards } = splitIndex(this.people, this.rels, this.shardCount, this.photos, { places: this.places, moves: this.moves });
    for (let i = 0; i < familyShards.length; i++) {
      changes.push({ path: familyShardPath(i), content: await encryptJSON(newKey, familyShards[i]) });
    }
    changes.push({ path: SETTINGS_PATH, content: await encryptJSON(newKey, this.familySettings) });
    // The "what changed" notes contain names too.
    const tree = await this.repo.listTree(this.head);
    for (const path of tree.keys()) {
      if (!path.startsWith('data/family/changes/')) continue;
      const text = await this.repo.readText(path, this.head);
      try { changes.push({ path, content: await encryptJSON(newKey, await decryptJSON(this.key, text)) }); } catch { /* unreadable old note: leave it */ }
    }
    const crypto = await wrapKey(newKey, newPassword, this.iterations);
    const config = { ...this.config, crypto };
    changes.push({ path: CONFIG_PATH, content: JSON.stringify(config, null, 2) });
    const result = await this.repo.commit('Change family password (full re-lock)', changes, { onProgress });
    this.config = config;
    this.key = newKey;
    this.head = result.sha;
    this.familyShards = familyShards;
    this.lastShardText = familyShards.map((s) => JSON.stringify(s));
    return result;
  }
}
