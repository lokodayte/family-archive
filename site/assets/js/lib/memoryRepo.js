// A pretend GitHub repository kept in memory. Used by the automated tests
// and by "practice mode" when the admin panel runs on your own computer.

export class MemoryRepo {
  /** @param loader optional async (path) => string|Uint8Array|null for files not changed yet */
  constructor(files = {}, { loader, sizeKB = 1200 } = {}) {
    this.files = new Map(Object.entries(files));
    this.loader = loader;
    this.commits = [];
    this.headSha = 'c0';
    this._size = sizeKB;
  }

  async checkAccess() { return { sizeKB: this._size, private: false }; }
  async getHead() { return this.headSha; }
  async sizeKB() { return this._size; }

  async #get(path) {
    if (this.files.has(path)) return this.files.get(path);
    return this.loader ? this.loader(path) : null;
  }

  async readText(path) {
    const v = await this.#get(path);
    if (v == null) return null;
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }

  async readBytes(path) {
    const v = await this.#get(path);
    if (v == null) return null;
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  }

  async commit(message, changes) {
    for (const c of changes) {
      if (c.delete) {
        if (!(await this.#get(c.path))) throw Object.assign(new Error(`Cannot delete missing file ${c.path}`), { status: 422 });
        this.files.set(c.path, null);
      } else this.files.set(c.path, c.bytes || c.content);
    }
    const sha = `c${this.commits.length + 1}`;
    this.commits.push({ sha, message, changes });
    this.headSha = sha;
    this._deployAt = Date.now() + 2500;
    return { sha, parent: `c${this.commits.length - 1}` };
  }

  async deployStatus() {
    return Date.now() < (this._deployAt || 0) ? 'running' : 'live';
  }

  /** All current files (for tests). */
  snapshot() {
    return Object.fromEntries([...this.files].filter(([, v]) => v != null));
  }
}
