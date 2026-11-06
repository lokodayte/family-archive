// Family relationships.
//
// Only two kinds of links are stored:
//   { id, type: 'parent', parent, child, kind: 'birth' | 'adoptive' | 'step' | 'foster' }
//   { id, type: 'spouse', a, b, start?, end?, endReason?: 'divorce' | 'death' | 'separation', place? }
// Everything else (siblings, half-siblings, ancestors...) is calculated.

export const PARENT_KINDS = ['birth', 'adoptive', 'step', 'foster'];

export function buildGraph(rels) {
  const parents = new Map();
  const children = new Map();
  const spouses = new Map();
  const push = (map, k, v) => {
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(v);
  };
  for (const r of rels) {
    if (r.type === 'parent') {
      const kind = r.kind || 'birth';
      push(parents, r.child, { id: r.parent, kind, rel: r });
      push(children, r.parent, { id: r.child, kind, rel: r });
    } else if (r.type === 'spouse') {
      push(spouses, r.a, { id: r.b, rel: r });
      push(spouses, r.b, { id: r.a, rel: r });
    }
  }
  return {
    parentsOf: (id) => parents.get(id) || [],
    childrenOf: (id) => children.get(id) || [],
    spousesOf: (id) => spouses.get(id) || [],
  };
}

// Parents that count for sibling calculation (step-parents don't make siblings).
function familyParents(g, id) {
  return new Set(g.parentsOf(id).filter((p) => p.kind !== 'step').map((p) => p.id));
}

/**
 * Siblings share at least one parent. They are "half" siblings only when both
 * people have two known parents and share exactly one. If a parent is unknown
 * we can't tell, so they're listed as (full) siblings.
 */
export function siblings(g, id) {
  const mine = familyParents(g, id);
  const full = [];
  const half = [];
  const seen = new Set([id]);
  for (const p of mine) {
    for (const c of g.childrenOf(p)) {
      if (seen.has(c.id) || c.kind === 'step') continue;
      seen.add(c.id);
      const theirs = familyParents(g, c.id);
      let shared = 0;
      for (const x of theirs) if (mine.has(x)) shared++;
      if (shared === 0) continue;
      if (mine.size >= 2 && theirs.size >= 2 && shared < 2) half.push(c.id);
      else full.push(c.id);
    }
  }
  return { full, half };
}

function walk(g, start, next, maxDepth) {
  const found = new Map(); // id -> generation distance
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const nextFrontier = [];
    for (const id of frontier) {
      for (const n of next(id)) {
        if (n === start || found.has(n)) continue;
        found.set(n, depth);
        nextFrontier.push(n);
      }
    }
    frontier = nextFrontier;
  }
  return found;
}

/** Map of ancestor id -> generations up (1 = parent). */
export function ancestors(g, id, maxDepth = Infinity) {
  return walk(g, id, (x) => g.parentsOf(x).map((p) => p.id), maxDepth);
}

/** Map of descendant id -> generations down (1 = child). */
export function descendants(g, id, maxDepth = Infinity) {
  return walk(g, id, (x) => g.childrenOf(x).map((c) => c.id), maxDepth);
}

export function isAncestor(g, maybeAncestor, of) {
  return ancestors(g, of).has(maybeAncestor);
}

/** Returns a problem code, or null when the parent link is fine. */
export function checkParentLink(g, parent, child, kind = 'birth') {
  if (!parent || !child) return 'missing';
  if (parent === child) return 'self';
  if (g.parentsOf(child).some((p) => p.id === parent)) return 'duplicate';
  if (parent !== child && isAncestor(g, child, parent)) return 'cycle';
  if (kind === 'birth' && g.parentsOf(child).filter((p) => p.kind === 'birth').length >= 2) {
    return 'too-many-parents';
  }
  return null;
}

/** Returns a problem code, or null when the spouse link is fine. */
export function checkSpouseLink(g, a, b) {
  if (!a || !b) return 'missing';
  if (a === b) return 'self';
  if (isAncestor(g, a, b) || isAncestor(g, b, a)) return 'cycle';
  return null;
}

/** Check a whole set of relationships (used before saving). */
export function findProblems(rels) {
  const problems = [];
  const built = [];
  for (const r of rels) {
    const g = buildGraph(built);
    const code = r.type === 'parent'
      ? checkParentLink(g, r.parent, r.child, r.kind || 'birth')
      : r.type === 'spouse' ? (r.a === r.b ? 'self' : null) : 'unknown-type';
    if (code && code !== 'duplicate') problems.push({ rel: r, code });
    built.push(r);
  }
  return problems;
}

export const PROBLEM_TEXT = {
  missing: 'Choose a person first.',
  self: 'A person cannot be linked to themselves.',
  duplicate: 'These two people are already linked this way.',
  cycle: 'That would make someone their own ancestor.',
  'too-many-parents': 'This person already has two birth parents. Use "adoptive" or "step" for others.',
  'unknown-type': 'Unknown kind of relationship.',
};
