// "How are we related?" — finds the relationship between any two people and names it in English.
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n) => ORD[n] || `${n}th`;
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
const times = (n) => TIMES[n] || `${n} times`;

const g3 = (sex, male, female, neutral) => (sex === 'male' ? male : sex === 'female' ? female : neutral);
const greats = (n) => 'great-'.repeat(Math.max(0, n));

/**
 * Name for "B is A's ___" given a = generations from A up to the common ancestor,
 * b = generations from B up to it, and B's sex.
 */
export function relationshipName(a, b, sex, { half = false } = {}) {
  const halfP = half ? 'half-' : '';
  if (a === 0 && b === 0) return 'the same person';
  if (a === 0) { // B descends from A
    const base = g3(sex, 'son', 'daughter', 'child');
    if (b === 1) return base;
    return `${greats(b - 2)}grand${base}`;
  }
  if (b === 0) { // B is A's ancestor
    const base = g3(sex, 'father', 'mother', 'parent');
    if (a === 1) return base;
    return `${greats(a - 2)}grand${base}`;
  }
  if (a === 1 && b === 1) return halfP + g3(sex, 'brother', 'sister', 'sibling');
  if (a === 1) { // B is a descendant of A's sibling: nephew, great-nephew...
    return halfP + greats(b - 2) + g3(sex, 'nephew', 'niece', 'niece/nephew');
  }
  if (b === 1) { // B is a sibling of A's ancestor: uncle, great-uncle...
    return halfP + greats(a - 2) + g3(sex, 'uncle', 'aunt', 'aunt/uncle');
  }
  const degree = Math.min(a, b) - 1;
  const removed = Math.abs(a - b);
  return `${halfP}${ordinal(degree)} cousin${removed ? ` ${times(removed)} removed` : ''}`;
}

/** Blood relationship via the closest common ancestor(s). */
export function bloodRelation(g, aId, bId, sexOf = () => 'unknown') {
  if (aId === bId) return { a: 0, b: 0, common: [aId], text: 'the same person' };
  const blood = (x) => g.parentsOf(x).filter((p) => p.kind !== 'step').map((p) => p.id);
  const walk = (start) => {
    const found = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; frontier.length && d < 60; d++) {
      const next = [];
      for (const id of frontier) for (const p of blood(id)) if (!found.has(p)) { found.set(p, d); next.push(p); }
      frontier = next;
    }
    return found;
  };
  const upA = walk(aId);
  const upB = walk(bId);
  let best = null;
  for (const [id, da] of upA) {
    if (!upB.has(id)) continue;
    const db = upB.get(id);
    const total = da + db;
    if (!best || total < best.total) best = { total, a: da, b: db, common: [id] };
    else if (total === best.total && da === best.a) best.common.push(id);
  }
  if (!best) return null;
  // Siblings, nieces, cousins... are "half" when the two lines go back to
  // children of the common ancestor who had different other parents.
  let half = false;
  if (best.a >= 1 && best.b >= 1 && best.common.length === 1) {
    const c = best.common[0];
    const childOf = (up, depth) => [...up].find(([id, dist]) => dist === depth - 1 && blood(id).includes(c))?.[0];
    const ca = childOf(upA, best.a);
    const cb = childOf(upB, best.b);
    const others = (x) => blood(x).filter((p) => p !== c);
    if (ca && cb && ca !== cb) {
      const pa = others(ca);
      const pb = others(cb);
      half = pa.length > 0 && pb.length > 0 && !pa.some((p) => pb.includes(p));
    }
  }
  return { ...best, half, text: relationshipName(best.a, best.b, sexOf(bId), { half }) };
}

const IN_LAW = {
  father: 'father-in-law', mother: 'mother-in-law', parent: 'parent-in-law',
  brother: 'brother-in-law', sister: 'sister-in-law', sibling: 'sibling-in-law',
  son: 'son-in-law', daughter: 'daughter-in-law', child: 'child-in-law',
};

/**
 * The full answer: blood relation, or by marriage, or the shortest chain of family links.
 * Returns { kind: 'blood' | 'spouse' | 'marriage' | 'chain' | 'none', text, common?, path? }
 * text completes the sentence "B is A's …" (or describes the connection).
 */
export function howRelated(g, aId, bId, { sexOf = () => 'unknown', nameOf = (id) => id } = {}) {
  const blood = bloodRelation(g, aId, bId, sexOf);
  if (blood) return { kind: 'blood', ...blood };

  if (g.spousesOf(aId).some((s) => s.id === bId)) {
    return { kind: 'spouse', text: { male: 'husband', female: 'wife' }[sexOf(bId)] || 'spouse' };
  }
  // B is a blood relative of A's spouse (A's in-laws).
  for (const s of g.spousesOf(aId)) {
    const r = bloodRelation(g, s.id, bId, sexOf);
    if (r) {
      return {
        kind: 'marriage', via: s.id, common: r.common,
        text: IN_LAW[r.text] && (r.a + r.b <= 2) ? IN_LAW[r.text] : `${r.text} of ${nameOf(s.id)} (by marriage)`,
      };
    }
  }
  // B is the spouse of A's blood relative.
  for (const s of g.spousesOf(bId)) {
    const r = bloodRelation(g, aId, s.id, sexOf);
    if (r) {
      let text;
      if (r.a === 1 && r.b === 1) text = IN_LAW[g3(sexOf(bId), 'brother', 'sister', 'sibling')];
      else if (r.a === 0 && r.b === 1) text = IN_LAW[g3(sexOf(bId), 'son', 'daughter', 'child')];
      else if (r.b === 0 && r.a === 1) text = g3(sexOf(bId), 'stepfather', 'stepmother', 'step-parent');
      else text = `${g3(sexOf(bId), 'husband', 'wife', 'spouse')} of ${nameOf(s.id)} (your ${r.text})`;
      return { kind: 'marriage', via: s.id, common: r.common, text };
    }
  }
  // Otherwise: the shortest chain of family links.
  const path = shortestPath(g, aId, bId);
  if (path) return { kind: 'chain', path, text: 'connected through the family' };
  return { kind: 'none', text: 'not connected in this archive (yet)' };
}

/** Shortest chain through parents, children and spouses: [{ id, via }] from A to B. */
export function shortestPath(g, aId, bId) {
  const prev = new Map([[aId, null]]);
  const queue = [aId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === bId) break;
    const steps = [
      ...g.parentsOf(cur).map((p) => [p.id, 'parent']),
      ...g.childrenOf(cur).map((c) => [c.id, 'child']),
      ...g.spousesOf(cur).map((s) => [s.id, 'spouse']),
    ];
    for (const [next, via] of steps) {
      if (prev.has(next)) continue;
      prev.set(next, { from: cur, via });
      queue.push(next);
    }
  }
  if (!prev.has(bId)) return null;
  const path = [];
  for (let x = bId; x != null; x = prev.get(x)?.from ?? null) {
    path.unshift({ id: x, via: prev.get(x)?.via || null });
    if (x === aId) break;
  }
  return path;
}
