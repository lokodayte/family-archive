// Talks to GitHub from the browser. Saves many file changes as ONE commit.
import { toBase64 } from './crypto.js';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const TREE_CHUNK = 400; // files per request when building a commit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GitHubRepo {
  /**
   * @param {object} o
   * @param {string} o.owner
   * @param {string} o.repo
   * @param {string} o.token  fine-grained token (kept only in this browser)
   * @param {string} [o.branch]
   * @param {string} [o.root]  folder inside the repo where the site lives
   */
  constructor({ owner, repo, token, branch = 'main', root = 'site/', fetchImpl, sleepImpl }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.branch = branch;
    this.root = root;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.sleep = sleepImpl || sleep;
    this.onWait = null; // called with seconds when GitHub asks us to slow down
  }

  async api(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        method,
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).message || msg; } catch { /* not JSON */ }
        // GitHub limits how fast files can be uploaded. Wait and try again.
        const limited = res.status === 429 || (res.status === 403 && /rate limit/i.test(msg));
        if (limited && attempt < 5) {
          const after = Number(res.headers?.get?.('retry-after')) || 60;
          this.onWait?.(after);
          await this.sleep(after * 1000);
          continue;
        }
        throw new GitHubError(res.status, msg);
      }
      if (res.status === 204) return null;
      return accept.includes('raw') ? res : res.json();
    }
  }

  get base() { return `/repos/${this.owner}/${this.repo}`; }

  /** Check the token works for this repository. */
  async checkAccess() {
    const info = await this.api(this.base);
    return { sizeKB: info.size, private: info.private, defaultBranch: info.default_branch };
  }

  /**
   * Can this token save changes? Tries the smallest possible write (an unused,
   * empty file object that GitHub throws away later). Returns true/false.
   */
  async canWrite() {
    try {
      await this.api(`${this.base}/git/blobs`, { method: 'POST', body: { content: '', encoding: 'utf-8' } });
      return true;
    } catch (e) {
      if (e.status === 403 || e.status === 404) return false;
      throw e;
    }
  }

  async getHead() {
    const ref = await this.api(`${this.base}/git/ref/heads/${this.branch}`);
    return ref.object.sha;
  }

  /** Read a text file at a given commit. Returns null if it doesn't exist. */
  async readText(path, ref) {
    try {
      const res = await this.api(
        `${this.base}/contents/${encodePath(this.root + path)}?ref=${ref || this.branch}`,
        { accept: 'application/vnd.github.raw+json' },
      );
      return await res.text();
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Read a binary file at a given commit. Returns null if it doesn't exist. */
  async readBytes(path, ref) {
    try {
      const res = await this.api(
        `${this.base}/contents/${encodePath(this.root + path)}?ref=${ref || this.branch}`,
        { accept: 'application/vnd.github.raw+json' },
      );
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Save several changes as one commit.
   * changes: [{ path, content: string } | { path, bytes: Uint8Array } | { path, delete: true }]
   * Paths are relative to the site folder.
   */
  async commit(message, changes, { onProgress } = {}) {
    // Binary files are uploaded first (they don't depend on the latest commit).
    const entries = [];
    const total = changes.filter((c) => c.bytes).length;
    let done = 0;
    if (total) onProgress?.({ done, total });
    for (const c of changes) {
      const path = this.root + c.path;
      if (c.delete) entries.push({ path, mode: '100644', type: 'blob', sha: null });
      else if (c.bytes) {
        const blob = await this.api(`${this.base}/git/blobs`, {
          method: 'POST',
          body: { content: toBase64(c.bytes), encoding: 'base64' },
        });
        entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        onProgress?.({ done: ++done, total });
      } else entries.push({ path, mode: '100644', type: 'blob', content: c.content });
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await this.getHead();
      const headCommit = await this.api(`${this.base}/git/commits/${head}`);
      let tree = headCommit.tree.sha;
      for (let i = 0; i < entries.length; i += TREE_CHUNK) {
        const t = await this.api(`${this.base}/git/trees`, {
          method: 'POST',
          body: { base_tree: tree, tree: entries.slice(i, i + TREE_CHUNK) },
        });
        tree = t.sha;
      }
      const commit = await this.api(`${this.base}/git/commits`, {
        method: 'POST',
        body: { message, tree, parents: [head] },
      });
      try {
        await this.api(`${this.base}/git/refs/heads/${this.branch}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });
        return { sha: commit.sha, parent: head };
      } catch (e) {
        // Someone else saved at the same moment: try again on top of their change.
        if (e.status !== 422 && e.status !== 409) throw e;
      }
    }
    throw new GitHubError(409, 'The archive kept changing while saving. Please try again.');
  }

  /** Past changes, newest first: [{ sha, parent, message, date, author }]. */
  async listCommits({ page = 1, perPage = 30 } = {}) {
    const data = await this.api(`${this.base}/commits?sha=${this.branch}&per_page=${perPage}&page=${page}`);
    return data.map((c) => ({
      sha: c.sha,
      parent: c.parents?.[0]?.sha || null,
      message: c.commit.message,
      date: c.commit.author?.date || c.commit.committer?.date,
      author: c.author?.login || c.commit.author?.name || '',
    }));
  }

  /** One change with the list of files it touched (paths inside the site folder). */
  async getCommit(sha) {
    const c = await this.api(`${this.base}/commits/${sha}?per_page=300`);
    const files = (c.files || []).map((f) => f.filename);
    return {
      sha,
      parent: c.parents?.[0]?.sha || null,
      message: c.commit.message,
      date: c.commit.author?.date,
      files: files.filter((f) => f.startsWith(this.root)).map((f) => f.slice(this.root.length)),
      truncated: files.length >= 300,
    };
  }

  /** path -> blob id for every file in the site folder at a commit (one request). */
  async listTree(ref) {
    const commit = await this.api(`${this.base}/git/commits/${ref || await this.getHead()}`);
    const tree = await this.api(`${this.base}/git/trees/${commit.tree.sha}?recursive=1`);
    const out = new Map();
    for (const e of tree.tree || []) {
      if (e.type === 'blob' && e.path.startsWith(this.root)) out.set(e.path.slice(this.root.length), e.sha);
    }
    out.truncated = !!tree.truncated;
    return out;
  }

  /** Size of the whole repository (including history), in KB. */
  async sizeKB() {
    return (await this.api(this.base)).size;
  }

  /**
   * Status of the publish run for a commit:
   * 'waiting' | 'running' | 'live' | 'failed' | 'unknown' (no permission to see)
   */
  async deployStatus(sha) {
    try {
      const data = await this.api(`${this.base}/actions/runs?head_sha=${sha}&per_page=5`);
      const run = data.workflow_runs?.[0];
      if (!run) return 'waiting';
      if (run.status !== 'completed') return 'running';
      return run.conclusion === 'success' ? 'live' : 'failed';
    } catch (e) {
      if (e.status === 403 || e.status === 404) return 'unknown';
      throw e;
    }
  }
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
