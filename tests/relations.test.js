import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph, siblings, ancestors, descendants, checkParentLink, checkSpouseLink, findProblems,
} from '../site/assets/js/lib/relations.js';
import { sampleRels } from '../tools/sampleFamily.js';
import { layoutTree } from '../site/assets/js/lib/treeLayout.js';
import { buildTimeline, lifespan } from '../site/assets/js/lib/timeline.js';
import { samplePeople } from '../tools/sampleFamily.js';
import { summarize } from '../site/assets/js/lib/model.js';

const P = (n) => `psample${String(n).padStart(4, '0')}`;
const g = buildGraph(sampleRels());

test('parents, children and spouses (including a second marriage)', () => {
  assert.deepEqual(g.parentsOf(P(4)).map((p) => p.id).sort(), [P(1), P(2)]);
  assert.deepEqual(g.childrenOf(P(1)).map((c) => c.id).sort(), [P(4), P(5)]);
  assert.deepEqual(g.spousesOf(P(1)).map((s) => s.id).sort(), [P(2), P(3)]);
});

test('full and half siblings are calculated', () => {
  // Grigor (4) and Lusine (5) share only their father: half-siblings.
  assert.deepEqual(siblings(g, P(4)), { full: [], half: [P(5)] });
  // Armen (7) and Karine (8) share both parents: full siblings.
  assert.deepEqual(siblings(g, P(7)), { full: [P(8)], half: [] });
  // With one unknown parent we cannot say "half", so they count as siblings.
  const g2 = buildGraph([
    { id: 'a', type: 'parent', parent: 'M', child: 'x' },
    { id: 'b', type: 'parent', parent: 'M', child: 'y' },
    { id: 'c', type: 'parent', parent: 'F', child: 'y' },
  ]);
  assert.deepEqual(siblings(g2, 'x'), { full: ['y'], half: [] });
  // Step-parents never create siblings.
  const g3 = buildGraph([
    { id: 'a', type: 'parent', parent: 'S', child: 'x', kind: 'step' },
    { id: 'b', type: 'parent', parent: 'S', child: 'y' },
  ]);
  assert.deepEqual(siblings(g3, 'x'), { full: [], half: [] });
});

test('ancestors and descendants with generation numbers', () => {
  const anc = ancestors(g, P(9));
  assert.equal(anc.get(P(7)), 1);
  assert.equal(anc.get(P(4)), 2);
  assert.equal(anc.get(P(1)), 3);
  assert.equal(ancestors(g, P(9), 2).has(P(1)), false);
  const desc = descendants(g, P(1));
  assert.equal(desc.get(P(9)), 3);
});

test('refuses impossible links', () => {
  assert.equal(checkParentLink(g, P(9), P(1)), 'cycle'); // great-grandson as parent
  assert.equal(checkParentLink(g, P(4), P(4)), 'self');
  assert.equal(checkParentLink(g, P(1), P(4)), 'duplicate');
  assert.equal(checkParentLink(g, P(3), P(4), 'birth'), 'too-many-parents');
  assert.equal(checkParentLink(g, P(3), P(4), 'step'), null);
  assert.equal(checkSpouseLink(g, P(1), P(9)), 'cycle');
  assert.equal(checkSpouseLink(g, P(5), P(7)), null);
  assert.deepEqual(findProblems(sampleRels()), []);
  assert.equal(findProblems([...sampleRels(), { id: 'bad', type: 'parent', parent: P(9), child: P(1) }])[0].code, 'cycle');
});

test('tree layout: hourglass with the chosen person in the middle', () => {
  const { nodes, links } = layoutTree(g, P(4), { up: 2, down: 2 });
  const focus = nodes.find((n) => n.role === 'focus');
  assert.equal(focus.id, P(4));
  assert.equal(focus.x, 0);
  assert.equal(focus.y, 0);
  const ids = nodes.map((n) => n.id);
  for (const id of [P(1), P(2), P(6), P(7), P(8), P(9)]) assert.ok(ids.includes(id), `${id} shown`);
  assert.ok(nodes.find((n) => n.id === P(1)).y < 0, 'parents above');
  assert.ok(nodes.find((n) => n.id === P(7)).y > 0, 'children below');
  // No two boxes on the same row overlap.
  for (const a of nodes) for (const b of nodes) {
    if (a !== b && a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= 172, `${a.id} and ${b.id} overlap`);
  }
  assert.ok(links.length > 0);
  // Limits respected, with a marker that there is more.
  const small = layoutTree(g, P(4), { up: 0, down: 1 });
  assert.ok(!small.nodes.some((n) => n.id === P(9)));
  assert.ok(small.nodes.find((n) => n.id === P(4)).moreUp);
  assert.ok(small.nodes.find((n) => n.id === P(7)).moreDown);
});

test('timeline puts birth, marriages, children and death in order', () => {
  const people = new Map(samplePeople().map((p) => [p.id, summarize(p)]));
  const hov = samplePeople()[0];
  const items = buildTimeline(hov, { graph: g, people });
  assert.deepEqual(items.map((i) => i.type), ['birth', 'marriage', 'child', 'marriage', 'move', 'child', 'death']);
  assert.equal(lifespan(summarize(hov)), 'c. 1880 – 1951');
  assert.equal(lifespan(people.get(P(8))), 'b. 1945');
});

import { searchPeople } from '../site/assets/js/lib/model.js';

test('search: any alphabet, nicknames, and first/last names rank above patronymics', () => {
  const people = samplePeople();
  const first = (q) => searchPeople(people, q).map((p) => p.names.latin?.first);
  assert.deepEqual(first('hovh'), ['Hovhannes', 'Grigor']); // Grigor matches only via "Hovhannesi"
  assert.equal(first('Հովհ')[0], 'Hovhannes');
  assert.equal(first('сэмпл григ')[0], 'Grigor');
  assert.deepEqual(first('vano'), ['Hovhannes']);
  assert.deepEqual(first('Demova'), ['Elena']); // maiden name
  assert.deepEqual(first('zzz'), []);
});
