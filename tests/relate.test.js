import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../site/assets/js/lib/relations.js';
import { relationshipName, howRelated, shortestPath } from '../site/assets/js/lib/relate.js';
import { layoutTree } from '../site/assets/js/lib/treeLayout.js';
import { samplePeople, sampleRels } from '../tools/sampleFamily.js';

const P = (n) => `psample${String(n).padStart(4, '0')}`;
const sample = new Map(samplePeople().map((p) => [p.id, p]));
const sexOf = (id) => sample.get(id)?.sex || people.get(id)?.sex || 'unknown';
const nameOf = (id) => sample.get(id)?.names?.latin?.first || id;
const g = buildGraph(sampleRels());
const rel = (a, b, graph = g) => howRelated(graph, a, b, { sexOf, nameOf }).text;

test('names for every kind of blood relative', () => {
  const cases = [
    [0, 1, 'male', 'son'], [0, 2, 'female', 'granddaughter'], [0, 3, 'unknown', 'great-grandchild'], [0, 5, 'male', 'great-great-great-grandson'],
    [1, 0, 'female', 'mother'], [2, 0, 'male', 'grandfather'], [4, 0, 'female', 'great-great-grandmother'],
    [1, 1, 'male', 'brother'], [1, 2, 'female', 'niece'], [1, 3, 'male', 'great-nephew'],
    [2, 1, 'male', 'uncle'], [3, 1, 'female', 'great-aunt'],
    [2, 2, 'female', 'first cousin'], [3, 3, 'male', 'second cousin'], [2, 3, 'male', 'first cousin once removed'],
    [4, 2, 'female', 'first cousin twice removed'], [5, 4, 'male', 'third cousin once removed'],
  ];
  for (const [a, b, sex, want] of cases) assert.equal(relationshipName(a, b, sex), want, `${a},${b}`);
  assert.equal(relationshipName(1, 1, 'female', { half: true }), 'half-sister');
});

test('relationships in the sample family', () => {
  assert.equal(rel(P(9), P(1)), 'great-grandfather'); // Davit -> Hovhannes
  assert.equal(rel(P(1), P(9)), 'great-grandson');
  assert.equal(rel(P(7), P(8)), 'sister'); // Armen -> Karine
  assert.equal(rel(P(4), P(5)), 'half-sister'); // Grigor -> Lusine (different mothers)
  assert.equal(rel(P(9), P(8)), 'aunt'); // Davit -> Karine
  assert.equal(rel(P(9), P(5)), 'half-great-aunt'); // Davit -> Lusine
  assert.equal(rel(P(4), P(6)), 'wife'); // Grigor -> Elena
  assert.equal(rel(P(6), P(1)), 'father-in-law'); // Elena -> Hovhannes
  assert.equal(rel(P(1), P(6)), 'daughter-in-law'); // Hovhannes -> Elena
  assert.equal(rel(P(5), P(6)), 'sister-in-law'); // Lusine -> Elena (half-brother's wife)
  assert.equal(rel(P(4), P(3)), 'stepmother'); // Grigor -> Anahit (father's second wife)
});

test('cousins', () => {
  const rels = [];
  const add = (parent, child) => rels.push({ id: `${parent}-${child}`, type: 'parent', parent, child });
  // G has children A and B; A -> a1 -> a2; B -> b1 -> b2
  add('G', 'A'); add('G', 'B'); add('A', 'a1'); add('B', 'b1'); add('a1', 'a2'); add('b1', 'b2');
  const gg = buildGraph(rels);
  assert.equal(rel('a1', 'b1', gg), 'first cousin');
  assert.equal(rel('a2', 'b2', gg), 'second cousin');
  assert.equal(rel('a1', 'b2', gg), 'first cousin once removed');
  assert.equal(rel('a2', 'B', gg), 'great-aunt/uncle');
  const r = howRelated(gg, 'a2', 'b2');
  assert.deepEqual(r.common, ['G']);
});

test('no blood or marriage link: shortest chain, or not connected', () => {
  const rels = [
    { id: '1', type: 'spouse', a: 'X', b: 'Y' },
    { id: '2', type: 'parent', parent: 'Y', child: 'Z' },
    { id: '3', type: 'spouse', a: 'Z', b: 'W' },
    { id: '4', type: 'parent', parent: 'W', child: 'V' },
  ];
  const gg = buildGraph(rels);
  const r = howRelated(gg, 'X', 'V');
  assert.equal(r.kind, 'chain');
  assert.deepEqual(r.path.map((s) => s.id), ['X', 'Y', 'Z', 'W', 'V']);
  assert.equal(howRelated(gg, 'X', 'nobody').kind, 'none');
  assert.equal(shortestPath(gg, 'X', 'X').length, 1);
});

// ---------- tree: expand and collapse ----------

const people = new Map(samplePeople().map((p) => [p.id, p]));

test('tree: open a branch beyond the generation limit, and close one', () => {
  const base = layoutTree(g, P(4), { up: 0, down: 1 });
  assert.ok(!base.nodes.some((n) => n.id === P(9)));
  assert.ok(base.nodes.find((n) => n.id === P(7)).moreDown);
  const opened = layoutTree(g, P(4), { up: 0, down: 1, expandDown: new Set([P(7)]) });
  assert.ok(opened.nodes.some((n) => n.id === P(9)), 'Davit appears when Armen is opened');
  assert.ok(opened.nodes.find((n) => n.id === P(7)).lessDown);
  const closed = layoutTree(g, P(4), { up: 0, down: 3, collapseDown: new Set([P(4)]) });
  assert.deepEqual(closed.nodes.map((n) => n.id).sort(), [P(4), P(6)]);
  assert.ok(closed.nodes.find((n) => n.id === P(4)).moreDown);
  const up = layoutTree(g, P(9), { up: 1, down: 0, expandUp: new Set([P(7)]) });
  assert.ok(up.nodes.some((n) => n.id === P(4)), 'grandparents shown when father is opened');
  const upClosed = layoutTree(g, P(9), { up: 3, down: 0, collapseUp: new Set([P(9)]) });
  assert.equal(upClosed.nodes.length, 1);
  assert.ok(upClosed.nodes[0].moreUp);
});

test('tree: ancestors-only and descendants-only views', () => {
  const anc = layoutTree(g, P(9), { up: 5, down: 0 });
  assert.ok(anc.nodes.every((n) => n.y <= 0));
  assert.ok(anc.nodes.some((n) => n.id === P(1)));
  const desc = layoutTree(g, P(1), { up: 0, down: 5 });
  assert.ok(desc.nodes.every((n) => n.y >= 0));
  assert.ok(desc.nodes.some((n) => n.id === P(9)));
});

test('tree: a big family lays out quickly without overlaps', () => {
  // 6 generations, 3 children each = 364 people + spouses.
  const rels = [];
  let n = 0;
  const grow = (id, depth) => {
    if (depth === 6) return;
    for (let i = 0; i < 3; i++) {
      const c = `p${++n}`;
      rels.push({ id: `r${n}`, type: 'parent', parent: id, child: c });
      grow(c, depth + 1);
    }
  };
  grow('root', 0);
  const big = buildGraph(rels);
  const t0 = performance.now();
  const { nodes } = layoutTree(big, 'root', { up: 0, down: 6 });
  assert.ok(performance.now() - t0 < 500);
  assert.equal(nodes.length, 1093);
  const rows = new Map();
  for (const node of nodes) { if (!rows.has(node.y)) rows.set(node.y, []); rows.get(node.y).push(node.x); }
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 172);
  }
});
