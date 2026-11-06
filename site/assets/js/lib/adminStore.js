// Everything the admin panel does with data: load, edit, group edits, save as one commit.
import {
  createKeyring, unlockKeyring, wrapKey, generateDataKey, encryptJSON, decryptJSON,
  encryptBytes, decryptBytes, DEFAULT_ITERATIONS,
} from './crypto.js';
import {
  summarize, normalizePerson, splitIndex, mergeIndexes, personPath, familyShardPath,
  PUBLIC_INDEX_PATH, CONFIG_PATH, SETTINGS_PATH, DEFAULT_SHARDS, relPeople, displayName,
  effectivePrivacy, effectivePhotoPrivacy, mediaPath, photoDetailsPath, splitPhoto, newId, compact,
} from './model.js';
import { buildGraph, findProblems, PROBLEM_TEXT } from './relations.js';

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
    const generic = (o) => o.photo || o.place || o.move;
    const pub = this.ops.filter((o) => o.public && !generic(o)).map((o) => o.text);
    const count = (k, word) => {
      const n = this.ops.filter((o) => o[k]).length;
      if (n) parts.push(`${n} ${word} change${n === 1 ? '' : 's'}`);
      return n;
    };
    const parts = [...pub];
    const photos = count('photo', 'photo') + count('place', 'place') + count('move', 'move');
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
    const result = await this.repo.commit(this.commitMessage(), changes, { onProgress });
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
