// Everything the admin panel does with data: load, edit, group edits, save as one commit.
import {
  createKeyring, unlockKeyring, wrapKey, generateDataKey, encryptJSON, decryptJSON,
  DEFAULT_ITERATIONS,
} from './crypto.js';
import {
  summarize, normalizePerson, splitIndex, mergeIndexes, personPath, familyShardPath,
  PUBLIC_INDEX_PATH, CONFIG_PATH, SETTINGS_PATH, DEFAULT_SHARDS, relPeople, displayName,
  effectivePrivacy,
} from './model.js';
import { buildGraph, findProblems, PROBLEM_TEXT } from './relations.js';

const involves = (r, id) => relPeople(r).includes(id);

export class AdminStore {
  constructor(repo, { iterations = DEFAULT_ITERATIONS } = {}) {
    this.repo = repo;
    this.iterations = iterations;
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
    this.prevPrivacy = new Map();
    this.personCache = new Map();
    this.pending = new Map(); // id -> { person } or { deleted: true }
    this.ops = []; // [{ text, public }]
    this.settingsDirty = false;
    this.configDirty = false;
    this.lastPublicText = null;
    this.lastShardText = [];
  }

  get shardCount() { return this.config.familyShards || DEFAULT_SHARDS; }
  get hasFamilyPassword() { return !!this.config.crypto; }
  get pendingCount() { return this.ops.length; }
  get graph() { return buildGraph(this.rels); }

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
    this.prevPrivacy = new Map([...this.people.values()].map((s) => [s.id, s.privacy]));
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
    // Try the key on the first family file before accepting it.
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
    if (p?.person) return structuredClone(p.person);
    if (this.personCache.has(id)) return structuredClone(this.personCache.get(id));
    const privacy = this.prevPrivacy.get(id);
    if (!privacy) return null;
    const text = await this.repo.readText(personPath(id, privacy), this.head);
    let person;
    if (!text) person = { ...structuredClone(this.people.get(id)) }; // only in index
    else person = privacy === 'public' ? JSON.parse(text) : await decryptJSON(this.key, text);
    this.personCache.set(id, person);
    return structuredClone(person);
  }

  relsOf(id) {
    return this.rels.filter((r) => involves(r, id));
  }

  // ---------- editing (kept in memory until Save) ----------

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
    if (wasSaved) this.pending.set(id, { deleted: true });
    else this.pending.delete(id);
    this.ops.push({ text: `Deleted ${displayName(s)}`, public: s.privacy === 'public' });
  }

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
    const pub = this.ops.filter((o) => o.public).map((o) => o.text);
    const fam = this.ops.length - pub.length;
    const parts = [...pub];
    // Never put family-only names in commit messages: the repository is public.
    if (fam) parts.push(`${fam} family-only change${fam === 1 ? '' : 's'}`);
    return parts.length ? `Archive: ${parts.join('; ')}` : 'Archive update';
  }

  /** Work out every file that must be written or deleted. */
  async buildChanges() {
    const changes = [];
    for (const [id, p] of this.pending) {
      const prev = this.prevPrivacy.get(id);
      if (p.deleted) {
        if (prev) changes.push({ path: personPath(id, prev), delete: true });
        continue;
      }
      const priv = effectivePrivacy(p.person);
      if (priv === 'family' && !this.key) throw new Error('Unlock with the family password first.');
      const content = priv === 'public'
        ? JSON.stringify(p.person, null, 1)
        : await encryptJSON(this.key, p.person);
      changes.push({ path: personPath(id, priv), content });
      if (prev && prev !== priv) changes.push({ path: personPath(id, prev), delete: true });
    }

    const { publicIndex, familyShards } = splitIndex(this.people, this.rels, this.shardCount);
    const pubText = JSON.stringify(publicIndex);
    if (pubText !== this.lastPublicText) {
      changes.push({ path: PUBLIC_INDEX_PATH, content: JSON.stringify(publicIndex, null, 1) });
    }
    const shardTexts = familyShards.map((s) => JSON.stringify(s));
    for (let i = 0; i < familyShards.length; i++) {
      if (shardTexts[i] === this.lastShardText[i]) continue;
      if (!this.key) {
        if (familyShards[i].people.length || familyShards[i].rels.length) throw new Error('Unlock with the family password first.');
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
    return { changes, publicIndex, familyShards, pubText, shardTexts };
  }

  /** Save everything as one commit. Returns { sha } or null when nothing changed. */
  async save() {
    const { changes, publicIndex, familyShards, pubText, shardTexts } = await this.buildChanges();
    if (!changes.length) { this.clearPending(); return null; }
    const result = await this.repo.commit(this.commitMessage(), changes);
    // Success: what we saved is now the starting point.
    for (const [id, p] of this.pending) {
      if (p.deleted) this.personCache.delete(id);
      else this.personCache.set(id, p.person);
    }
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
  async changePassword(newPassword, { full = false } = {}) {
    if (this.pendingCount) throw new Error('Save or discard your other changes first.');
    if (!this.key) throw new Error('Unlock with the family password first.');
    if (!full) {
      const crypto = await wrapKey(this.key, newPassword, this.iterations);
      this.config = { ...this.config, crypto };
      this.configDirty = true;
      this.ops.push({ text: 'Changed family password', public: true });
      return this.save();
    }

    const newKey = await generateDataKey();
    const changes = [];
    for (const s of this.people.values()) {
      if (s.privacy !== 'family') continue;
      const person = await this.getPerson(s.id);
      changes.push({ path: personPath(s.id, 'family'), content: await encryptJSON(newKey, person) });
    }
    const { familyShards } = splitIndex(this.people, this.rels, this.shardCount);
    for (let i = 0; i < familyShards.length; i++) {
      changes.push({ path: familyShardPath(i), content: await encryptJSON(newKey, familyShards[i]) });
    }
    changes.push({ path: SETTINGS_PATH, content: await encryptJSON(newKey, this.familySettings) });
    const crypto = await wrapKey(newKey, newPassword, this.iterations);
    const config = { ...this.config, crypto };
    changes.push({ path: CONFIG_PATH, content: JSON.stringify(config, null, 2) });
    const result = await this.repo.commit('Change family password (full re-lock)', changes);
    this.config = config;
    this.key = newKey;
    this.head = result.sha;
    this.familyShards = familyShards;
    this.lastShardText = familyShards.map((s) => JSON.stringify(s));
    return result;
  }
}
