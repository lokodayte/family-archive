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

// ---------- whole-family view ----------
import { layoutWhole } from '../site/assets/js/lib/wholeLayout.js';

function checkLayout(graph, ids, layout) {
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.equal(layout.nodes.length, ids.length, 'everyone appears exactly once');
  for (const id of ids) {
    for (const p of graph.parentsOf(id).filter((x) => x.kind !== 'step' && pos.has(x.id))) {
      assert.ok(pos.get(p.id).y < pos.get(id).y, `${p.id} (parent) above ${id}`);
    }
  }
  const rows = new Map();
  for (const n of layout.nodes) { if (!rows.has(n.y)) rows.set(n.y, []); rows.get(n.y).push(n.x); }
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 172 - 0.01, 'no overlapping boxes');
  }
  return pos;
}

test('whole family: everyone, generations in rows, couples side by side', () => {
  const ids = samplePeople().map((p) => p.id);
  const layout = layoutWhole(g, ids, { sortKeyOf: () => null });
  const pos = checkLayout(g, ids, layout);
  assert.equal(pos.get(P(1)).y, pos.get(P(2)).y, 'Hovhannes and Mariam on one row');
  assert.equal(pos.get(P(1)).y, pos.get(P(3)).y, 'Hovhannes and Anahit on one row');
  assert.equal(pos.get(P(4)).y, pos.get(P(6)).y, 'Grigor and Elena on one row');
  assert.equal(pos.get(P(7)).y, pos.get(P(10)).y, 'Armen and Davit’s unknown mother on one row');
  assert.ok(Math.abs(pos.get(P(4)).x - pos.get(P(6)).x) <= 193, 'a couple sits next to each other');
  assert.equal(new Set(layout.nodes.map((n) => n.y)).size, 4, 'four generations');
  assert.equal(layout.families, 1);
  assert.ok(layout.links.some((l) => l.kind === 'spouse'));
});

test('whole family: separate families and loose people do not overlap', () => {
  const rels = [
    { id: '1', type: 'parent', parent: 'A', child: 'C' }, { id: '2', type: 'parent', parent: 'B', child: 'C' },
    { id: '3', type: 'spouse', a: 'A', b: 'B' },
    { id: '4', type: 'parent', parent: 'X', child: 'Y' },
  ];
  const gg = buildGraph(rels);
  const ids = ['A', 'B', 'C', 'X', 'Y', 'LONE'];
  const layout = layoutWhole(gg, ids);
  checkLayout(gg, ids, layout);
  assert.equal(layout.families, 3);
});

test('whole family: a married-in family joins at the right height; odd data does not hang', () => {
  // Elena's parents (married-in family) should sit just above her, not at the very top.
  const rels = [...sampleRels(),
    { id: 'e1', type: 'parent', parent: 'EF', child: P(6) }, { id: 'e2', type: 'parent', parent: 'EM', child: P(6) }];
  const gg = buildGraph(rels);
  const ids = [...samplePeople().map((p) => p.id), 'EF', 'EM'];
  const pos = checkLayout(gg, ids, layoutWhole(gg, ids));
  assert.equal(pos.get('EF').y, pos.get(P(1)).y, 'Elena’s parents on the same row as Grigor’s parents');
  // Cousins who married each other: still finishes and stays valid.
  const loop = buildGraph([
    { id: 'a', type: 'parent', parent: 'G', child: 'P1' }, { id: 'b', type: 'parent', parent: 'G', child: 'P2' },
    { id: 'c', type: 'parent', parent: 'P1', child: 'C1' }, { id: 'd', type: 'parent', parent: 'P2', child: 'C2' },
    { id: 'e', type: 'spouse', a: 'C1', b: 'C2' }, { id: 'f', type: 'parent', parent: 'C1', child: 'K' }, { id: 'g', type: 'parent', parent: 'C2', child: 'K' },
  ]);
  checkLayout(loop, ['G', 'P1', 'P2', 'C1', 'C2', 'K'], layoutWhole(loop, ['G', 'P1', 'P2', 'C1', 'C2', 'K']));
});

test('whole family: a thousand people lay out quickly', () => {
  const rels = [];
  const ids = ['root', 'rootw'];
  rels.push({ id: 'w', type: 'spouse', a: 'root', b: 'rootw' });
  let n = 0;
  const grow = (a, b, depth) => {
    if (depth === 5) return;
    for (let i = 0; i < 3; i++) {
      const c = `p${++n}`;
      const s = `s${n}`;
      ids.push(c, s);
      rels.push({ id: `ra${n}`, type: 'parent', parent: a, child: c }, { id: `rb${n}`, type: 'parent', parent: b, child: c }, { id: `rs${n}`, type: 'spouse', a: c, b: s });
      grow(c, s, depth + 1);
    }
  };
  grow('root', 'rootw', 0);
  const gg = buildGraph(rels);
  const t0 = performance.now();
  const layout = layoutWhole(gg, ids);
  const ms = performance.now() - t0;
  checkLayout(gg, ids, layout);
  assert.ok(ids.length > 700);
  assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
});
