// A pretend GitHub repository kept in memory, with history. Used by the automated
// tests and by "practice mode" when the admin panel runs on your own computer.
import { gitBlobSha } from './hash.js';

export class MemoryRepo {
  /** @param loader optional async (path) => string|Uint8Array|null for files not changed yet */
  constructor(files = {}, { loader, sizeKB = 1200 } = {}) {
    this.files = new Map(Object.entries(files));
    this.loader = loader;
    this.commits = [];
    this.headSha = 'c0';
    this.snapshots = new Map([['c0', new Map(this.files)]]);
    this._size = sizeKB;
    this._clock = 0;
  }

  async checkAccess() { return { sizeKB: this._size, private: false }; }
  async getHead() { return this.headSha; }
  async canWrite() { return true; }
  async sizeKB() { return this._size; }

  async #get(path, ref) {
    const snap = (ref && this.snapshots.get(ref)) || this.files;
    if (snap.has(path)) return snap.get(path);
    return this.loader ? this.loader(path) : null;
  }

  async readText(path, ref) {
    const v = await this.#get(path, ref);
    if (v == null) return null;
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }

  async readBytes(path, ref) {
    const v = await this.#get(path, ref);
    if (v == null) return null;
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  }

  async commit(message, changes, { onProgress } = {}) {
    const total = changes.filter((c) => c.bytes).length;
    if (total) onProgress?.({ done: total, total });
    for (const c of changes) {
      if (c.delete) {
        if (!(await this.#get(c.path))) throw Object.assign(new Error(`Cannot delete missing file ${c.path}`), { status: 422 });
        this.files.set(c.path, null);
      } else this.files.set(c.path, c.bytes || c.content);
    }
    const parent = this.headSha;
    const sha = `c${this.commits.length + 1}`;
    this._clock = Math.max(Date.now(), this._clock + 1000); // always later than the previous change
    this.commits.push({ sha, parent, message, changes, date: new Date(this._clock).toISOString() });
    this.snapshots.set(sha, new Map(this.files));
    this.headSha = sha;
    this._deployAt = Date.now() + 2500;
    return { sha, parent };
  }

  async deployStatus() {
    return Date.now() < (this._deployAt || 0) ? 'running' : 'live';
  }

  /** Newest first, like GitHub. */
  async listCommits({ page = 1, perPage = 30 } = {}) {
    const all = [...this.commits].reverse().map((c) => ({
      sha: c.sha, parent: c.parent, message: c.message, date: c.date, author: 'you',
    }));
    return all.slice((page - 1) * perPage, page * perPage);
  }

  async getCommit(sha) {
    const c = this.commits.find((x) => x.sha === sha);
    if (!c) throw Object.assign(new Error('No such change'), { status: 404 });
    return {
      sha, parent: c.parent, message: c.message, date: c.date,
      files: [...new Set(c.changes.map((x) => x.path))], truncated: false,
    };
  }

  /** path -> git blob id for every file we know about at a commit. */
  async listTree(ref) {
    const snap = (ref && this.snapshots.get(ref)) || this.files;
    const out = new Map();
    for (const [path, v] of snap) {
      if (v == null) continue;
      out.set(path, await gitBlobSha(typeof v === 'string' ? new TextEncoder().encode(v) : v));
    }
    return out;
  }

  /** All current files (for tests). */
  snapshot() {
    return Object.fromEntries([...this.files].filter(([, v]) => v != null));
  }
}
