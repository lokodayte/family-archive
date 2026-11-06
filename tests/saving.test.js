import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleArchive } from '../tools/buildSample.js';
import { FAMILY_ONLY_WORDS } from '../tools/sampleFamily.js';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { GitHubRepo } from '../site/assets/js/lib/github.js';
import { decryptJSON, unlockKeyring } from '../site/assets/js/lib/crypto.js';
import { emptyPerson, mergeIndexes, familyShardPath } from '../site/assets/js/lib/model.js';

const FAST = 1000;
const PW = 'test-family-password';

async function fresh() {
  const { repo } = await buildSampleArchive(PW, { iterations: FAST, settings: { correctionEmail: 'me@example.com' } });
  const store = new AdminStore(repo, { iterations: FAST });
  await store.load();
  await store.unlock(PW);
  return { repo, store };
}

function publicTexts(repo) {
  return Object.entries(repo.snapshot()).filter(([path]) => !path.endsWith('.enc'));
}

test('PRIVACY: no family-only information appears in any unencrypted file', async () => {
  const { repo } = await fresh();
  const files = publicTexts(repo);
  assert.ok(files.length >= 3);
  for (const [path, text] of files) {
    for (const word of FAMILY_ONLY_WORDS) {
      assert.ok(!String(text).includes(word), `"${word}" leaked into ${path}`);
    }
    for (const id of ['psample0006', 'psample0007', 'psample0008', 'psample0009', 'psample0010']) {
      assert.ok(!String(text).includes(id), `family person id ${id} leaked into ${path}`);
    }
  }
  // Commit messages are public too.
  for (const c of repo.commits) {
    for (const word of FAMILY_ONLY_WORDS) assert.ok(!c.message.includes(word), `"${word}" leaked into a commit message`);
  }
});

test('PRIVACY: living people are family-only even if marked public', async () => {
  const { repo, store } = await fresh();
  const p = { ...emptyPerson(), privacy: 'public', living: true, names: { latin: { first: 'Livingtest' } } };
  store.applyPersonEdit(p, []);
  await store.save();
  for (const [path, text] of publicTexts(repo)) assert.ok(!String(text).includes('Livingtest'), path);
});

test('everything can be read back with the password', async () => {
  const { repo } = await fresh();
  const files = repo.snapshot();
  const config = JSON.parse(files['data/config.json']);
  const key = await unlockKeyring(config.crypto, PW);
  const shards = [];
  for (let i = 0; i < config.familyShards; i++) {
    const t = files[familyShardPath(i)];
    if (t) shards.push(await decryptJSON(key, t));
  }
  const { people, rels } = mergeIndexes(JSON.parse(files['data/public/index.json']), shards);
  assert.equal(people.size, 10);
  assert.equal(rels.length, 13);
  const elena = await decryptJSON(key, files['data/family/people/psample0006.enc']);
  assert.equal(elena.names.cyrillic.maiden, 'Демова');
  assert.deepEqual(await decryptJSON(key, files['data/family/settings.enc']), { correctionEmail: 'me@example.com' });
});

test('several edits are grouped into ONE commit, touching only changed files', async () => {
  const { repo, store } = await fresh();
  const before = repo.commits.length;
  const a = await store.getPerson('psample0004');
  a.occupation = 'Head teacher';
  store.applyPersonEdit(a, store.relsOf(a.id));
  const b = await store.getPerson('psample0007');
  b.occupation = 'Engineer';
  store.applyPersonEdit(b, store.relsOf(b.id));
  assert.equal(store.pendingCount, 2);
  await store.save();
  assert.equal(repo.commits.length, before + 1);
  const paths = repo.commits.at(-1).changes.map((c) => c.path).sort();
  assert.ok(paths.includes('data/public/people/psample0004.json'));
  assert.ok(paths.includes('data/family/people/psample0007.enc'));
  // Only the family index part that changed is rewritten, not all 16.
  assert.ok(paths.filter((p) => p.startsWith('data/family/index/')).length <= 1);
  assert.match(repo.commits.at(-1).message, /Edited Grigor Sampleyan/);
  assert.match(repo.commits.at(-1).message, /1 family-only change/);
  assert.equal(store.pendingCount, 0);
});

test('saving with no real changes does not create a commit', async () => {
  const { repo, store } = await fresh();
  const before = repo.commits.length;
  assert.equal(await store.save(), null);
  assert.equal(repo.commits.length, before);
});

test('changing privacy moves the file and deletes the old copy', async () => {
  const { repo, store } = await fresh();
  const p = await store.getPerson('psample0005');
  p.privacy = 'family';
  store.applyPersonEdit(p, store.relsOf(p.id));
  await store.save();
  const files = repo.snapshot();
  assert.ok(!files['data/public/people/psample0005.json']);
  assert.ok(files['data/family/people/psample0005.enc']);
  assert.ok(!files['data/public/index.json'].includes('Lusine'));
  // A link between a public and a family person is kept private.
  assert.ok(!files['data/public/index.json'].includes('psample0005'));
});

test('deleting a person removes them and their links', async () => {
  const { repo, store } = await fresh();
  store.deletePerson('psample0009');
  await store.save();
  const files = repo.snapshot();
  assert.ok(!files['data/family/people/psample0009.enc']);
  const s2 = new AdminStore(repo, { iterations: FAST });
  await s2.load();
  await s2.unlock(PW);
  assert.equal(s2.people.has('psample0009'), false);
  assert.ok(!s2.rels.some((r) => r.child === 'psample0009'));
});

test('bad links are caught before keeping an edit', async () => {
  const { store } = await fresh();
  const p = await store.getPerson('psample0001');
  const problems = store.checkEdit(p, [...store.relsOf(p.id), { id: 'x', type: 'parent', parent: 'psample0009', child: p.id, kind: 'birth' }]);
  assert.ok(problems.some((m) => /own ancestor/.test(m)));
});

test('quick password change: old password stops working, data still readable', async () => {
  const { repo, store } = await fresh();
  await store.changePassword('new-password');
  const s2 = new AdminStore(repo, { iterations: FAST });
  await s2.load();
  await assert.rejects(s2.unlock(PW));
  await s2.unlock('new-password');
  assert.equal(s2.people.size, 10);
  assert.equal((await s2.getPerson('psample0006')).names.latin.first, 'Elena');
});

test('full re-lock: every family file is re-encrypted with a new key', async () => {
  const { repo, store } = await fresh();
  const oldFiles = repo.snapshot();
  await store.changePassword('brand-new', { full: true });
  const newFiles = repo.snapshot();
  for (const path of Object.keys(oldFiles).filter((p) => p.endsWith('.enc'))) {
    assert.notEqual(newFiles[path], oldFiles[path], `${path} re-encrypted`);
  }
  const s2 = new AdminStore(repo, { iterations: FAST });
  await s2.load();
  await s2.unlock('brand-new');
  assert.equal(s2.people.size, 10);
  assert.equal((await s2.getPerson('psample0008')).names.latin.first, 'Karine');
  assert.equal(s2.familySettings.correctionEmail, 'me@example.com');
});

test('cannot change the password with unsaved edits waiting', async () => {
  const { store } = await fresh();
  store.deletePerson('psample0009');
  await assert.rejects(store.changePassword('x'), /Save or discard/);
});

// ---------- the real GitHub client, with a pretend GitHub ----------

function fakeGitHub({ failRefUpdates = 0 } = {}) {
  const calls = [];
  let head = 'h1';
  let failures = failRefUpdates;
  const fetchImpl = async (url, opts) => {
    const path = url.replace('https://api.github.com', '');
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method: opts.method, path, body, auth: opts.headers.Authorization });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: head } });
    if (path.includes('/git/commits/') && opts.method === 'GET') return json({ tree: { sha: `tree-of-${path.split('/').pop()}` } });
    if (path.endsWith('/git/blobs')) return json({ sha: 'blob1' }, 201);
    if (path.endsWith('/git/trees')) return json({ sha: `t${calls.length}` }, 201);
    if (path.endsWith('/git/commits')) return json({ sha: `new${calls.length}` }, 201);
    if (path.endsWith('/git/refs/heads/main')) {
      if (failures-- > 0) { head = 'h2'; return json({ message: 'Update is not a fast forward' }, 422); }
      head = body.sha;
      return json({ object: { sha: body.sha } });
    }
    if (path.includes('/contents/')) {
      if (path.includes('missing')) return json({ message: 'Not Found' }, 404);
      return new Response('file text', { status: 200 });
    }
    if (path.includes('/actions/runs')) return json({ workflow_runs: [{ status: 'completed', conclusion: 'success' }] });
    return json({ message: 'unexpected' }, 500);
  };
  return { calls, fetchImpl };
}

test('GitHub client makes one commit with text, binary and deleted files', async () => {
  const gh = fakeGitHub();
  const repo = new GitHubRepo({ owner: 'me', repo: 'family-archive', token: 'TEST', fetchImpl: gh.fetchImpl });
  const result = await repo.commit('Archive: test', [
    { path: 'data/a.json', content: '{}' },
    { path: 'media/x.bin', bytes: new Uint8Array([1, 2, 3]) },
    { path: 'data/old.json', delete: true },
  ]);
  assert.ok(result.sha.startsWith('new'));
  const tree = gh.calls.find((c) => c.path.endsWith('/git/trees'));
  assert.equal(tree.body.base_tree, 'tree-of-h1');
  assert.deepEqual(tree.body.tree.map((e) => e.path), ['site/data/a.json', 'site/media/x.bin', 'site/data/old.json']);
  assert.equal(tree.body.tree[2].sha, null);
  assert.equal(gh.calls.filter((c) => c.path.endsWith('/git/commits') && c.method === 'POST').length, 1);
  assert.ok(gh.calls.every((c) => c.auth === 'Bearer TEST'));
});

test('GitHub client retries when someone else saved at the same moment', async () => {
  const gh = fakeGitHub({ failRefUpdates: 1 });
  const repo = new GitHubRepo({ owner: 'me', repo: 'r', token: 'T', fetchImpl: gh.fetchImpl });
  await repo.commit('x', [{ path: 'a', content: 'b' }]);
  const commits = gh.calls.filter((c) => c.path.endsWith('/git/commits') && c.method === 'POST');
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[1].body.parents, ['h2']);
});

test('GitHub client reads files and reports missing ones as null', async () => {
  const gh = fakeGitHub();
  const repo = new GitHubRepo({ owner: 'me', repo: 'r', token: 'T', fetchImpl: gh.fetchImpl });
  assert.equal(await repo.readText('data/x.json', 'h1'), 'file text');
  assert.equal(await repo.readText('data/missing.json', 'h1'), null);
  assert.equal(await repo.deployStatus('abc'), 'live');
});

test('GitHub client can tell whether a token is allowed to save', async () => {
  const make = (status) => new GitHubRepo({
    owner: 'me', repo: 'r', token: 'T',
    fetchImpl: async () => new Response(JSON.stringify(status === 201 ? { sha: 'x' } : { message: 'Resource not accessible by personal access token' }), { status }),
  });
  assert.equal(await make(201).canWrite(), true);
  assert.equal(await make(403).canWrite(), false); // read-only token ("Public repositories")
  await assert.rejects(make(500).canWrite());
});
