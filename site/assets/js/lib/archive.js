// Loads the published archive for visitors, and unlocks family data with the password.
import { unlockKeyring, decryptJSON, exportKey, importKey } from './crypto.js';
import {
  mergeIndexes, personPath, familyShardPath, PUBLIC_INDEX_PATH, CONFIG_PATH, SETTINGS_PATH,
  DEFAULT_SHARDS,
} from './model.js';
import { buildGraph } from './relations.js';
import { safeStorage, scopedKey } from './dom.js';

const KEY_NAME = () => scopedKey('familyKey');

export class Archive {
  constructor(base = '') {
    this.base = base;
    this.key = null;
    this.familyShards = [];
    this.familySettings = {};
    this.personCache = new Map();
  }

  async fetchText(path) {
    const res = await fetch(this.base + path, { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.text();
  }

  async fetchJSON(path) {
    const t = await this.fetchText(path);
    return t == null ? null : JSON.parse(t);
  }

  get unlocked() { return !!this.key; }
  get hasFamilyData() { return !!this.config?.crypto; }

  async load() {
    this.config = (await this.fetchJSON(CONFIG_PATH)) || {};
    this.publicIndex = (await this.fetchJSON(PUBLIC_INDEX_PATH)) || { people: [], rels: [] };
    const saved = safeStorage.get('localStorage', KEY_NAME()) || safeStorage.get('sessionStorage', KEY_NAME());
    if (saved && this.hasFamilyData) {
      try {
        await this.#openFamily(await importKey(saved));
      } catch {
        this.forgetKey(); // password was changed since; ask again
      }
    }
    this.rebuild();
  }

  async #openFamily(key) {
    const n = this.config.familyShards || DEFAULT_SHARDS;
    const texts = await Promise.all(Array.from({ length: n }, (_, i) => this.fetchText(familyShardPath(i))));
    const shards = [];
    for (const t of texts) shards.push(t ? await decryptJSON(key, t) : { people: [], rels: [] });
    const settingsText = await this.fetchText(SETTINGS_PATH);
    this.familySettings = settingsText ? await decryptJSON(key, settingsText) : {};
    this.key = key;
    this.familyShards = shards;
  }

  /** Throws WrongPasswordError if the password is wrong. */
  async unlock(password, remember) {
    const key = await unlockKeyring(this.config.crypto, password);
    await this.#openFamily(key);
    const b64 = await exportKey(key);
    this.forgetKey();
    safeStorage.set(remember ? 'localStorage' : 'sessionStorage', KEY_NAME(), b64);
    this.personCache.clear();
    this.rebuild();
  }

  lock() {
    this.key = null;
    this.familyShards = [];
    this.familySettings = {};
    this.personCache.clear();
    this.forgetKey();
    this.rebuild();
  }

  forgetKey() {
    safeStorage.remove('localStorage', KEY_NAME());
    safeStorage.remove('sessionStorage', KEY_NAME());
  }

  rebuild() {
    const { people, rels } = mergeIndexes(this.publicIndex, this.familyShards);
    this.people = people;
    this.rels = rels;
    this.graph = buildGraph(rels);
  }

  async getPerson(id) {
    if (this.personCache.has(id)) return this.personCache.get(id);
    const s = this.people.get(id);
    if (!s) return null;
    let person = null;
    if (s.privacy === 'public') person = await this.fetchJSON(personPath(id, 'public'));
    else if (this.key) {
      const t = await this.fetchText(personPath(id, 'family'));
      person = t ? await decryptJSON(this.key, t) : null;
    }
    person = person || { ...s };
    this.personCache.set(id, person);
    return person;
  }
}
