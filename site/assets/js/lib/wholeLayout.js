// "Whole family" view: everyone on one canvas. Each generation is a row
// (oldest at the top), couples sit side by side, and the order within each row
// is arranged so family lines cross as little as possible.
import { NODE_W, NODE_H, GAP_X, ROW_H } from './treeLayout.js';

const SLOT = NODE_W + GAP_X;
const FAMILY_GAP = SLOT * 1.2; // space between separate families
const uniq = (a) => [...new Set(a)];

/**
 * @param g     graph from buildGraph()
 * @param ids   people to show
 * @param opts.sortKeyOf(id)  birth order, used to order brothers and sisters
 * @returns { nodes, links, bounds } in the same shape as layoutTree()
 */
export function layoutWhole(g, ids, { sortKeyOf = () => null } = {}) {
  const inSet = new Set(ids);
  const parentsOf = (id) => uniq(g.parentsOf(id).filter((p) => p.kind !== 'step' && inSet.has(p.id)).map((p) => p.id));
  const childrenOf = (id) => uniq(g.childrenOf(id).filter((c) => c.kind !== 'step' && inSet.has(c.id)).map((c) => c.id));
  // Partners: recorded spouses plus anyone who had a child together.
  const partnersOf = (id) => uniq([
    ...g.spousesOf(id).map((s) => s.id),
    ...childrenOf(id).flatMap((c) => parentsOf(c)),
  ].filter((x) => x !== id && inSet.has(x)));
  const birth = (id) => sortKeyOf(id) ?? Infinity;

  // ---------- 1. separate families (connected groups) ----------
  const groupOf = new Map();
  const groups = [];
  for (const start of ids) {
    if (groupOf.has(start)) continue;
    const members = [];
    const stack = [start];
    groupOf.set(start, groups.length);
    while (stack.length) {
      const id = stack.pop();
      members.push(id);
      for (const n of [...parentsOf(id), ...childrenOf(id), ...partnersOf(id)]) {
        if (!groupOf.has(n)) { groupOf.set(n, groups.length); stack.push(n); }
      }
    }
    groups.push(members);
  }

  // ---------- 2. generations ----------
  const gen = new Map();
  for (const members of groups) {
    // Start from the oldest person and walk the family.
    const start = [...members].sort((a, b) => birth(a) - birth(b))[0];
    gen.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      const here = gen.get(id);
      const visit = (n, value) => { if (!gen.has(n)) { gen.set(n, value); queue.push(n); } };
      for (const p of parentsOf(id)) visit(p, here - 1);
      for (const c of childrenOf(id)) visit(c, here + 1);
      for (const s of partnersOf(id)) visit(s, here);
    }
    // Fix up: children always below parents, partners on the same row.
    for (let iter = 0; iter < 60; iter++) {
      let changed = false;
      for (const id of members) {
        for (const c of childrenOf(id)) {
          if (gen.get(c) < gen.get(id) + 1) { gen.set(c, gen.get(id) + 1); changed = true; }
        }
        for (const s of partnersOf(id)) {
          const m = Math.max(gen.get(id), gen.get(s));
          if (gen.get(id) !== m || gen.get(s) !== m) { gen.set(id, m); gen.set(s, m); changed = true; }
        }
      }
      // People with no parents shown sit just above their children (married-in families).
      for (const id of members) {
        if (parentsOf(id).length) continue;
        const kids = childrenOf(id);
        const partners = partnersOf(id);
        if (!kids.length) continue;
        const target = Math.min(...kids.map((c) => gen.get(c))) - 1;
        const partnerRows = partners.map((s) => gen.get(s));
        if (target > gen.get(id) && partnerRows.every((r) => r >= target)) { gen.set(id, target); changed = true; }
      }
      if (!changed) break;
    }
    const min = Math.min(...members.map((id) => gen.get(id)));
    for (const id of members) gen.set(id, gen.get(id) - min);
  }

  // ---------- 3. couples become blocks; order rows to reduce crossings ----------
  const layoutGroup = (members) => {
    const rows = new Map();
    for (const id of members) {
      const r = gen.get(id);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(id);
    }
    const rowNums = [...rows.keys()].sort((a, b) => a - b);
    // Blocks: people joined by partnership on the same row.
    const blockOf = new Map();
    const blocks = new Map(); // row -> [block]
    for (const r of rowNums) {
      const list = [];
      for (const id of rows.get(r).sort((a, b) => birth(a) - birth(b))) {
        if (blockOf.has(id)) continue;
        const block = [];
        const stack = [id];
        blockOf.set(id, block);
        while (stack.length) {
          const x = stack.pop();
          block.push(x);
          for (const s of partnersOf(x)) if (gen.get(s) === r && !blockOf.has(s)) { blockOf.set(s, block); stack.push(s); }
        }
        // Someone with two partners goes in the middle.
        if (block.length >= 3) {
          const centre = [...block].sort((a, b) => partnersOf(b).length - partnersOf(a).length)[0];
          const others = block.filter((x) => x !== centre).sort((a, b) => birth(a) - birth(b));
          block.length = 0;
          block.push(...others.slice(0, Math.ceil(others.length / 2)), centre, ...others.slice(Math.ceil(others.length / 2)));
        } else block.sort((a, b) => birth(a) - birth(b));
        list.push(block);
      }
      blocks.set(r, list);
    }

    const x = new Map();
    const place = (r) => {
      let cursor = 0;
      for (const block of blocks.get(r)) {
        for (const id of block) { x.set(id, cursor + SLOT / 2); cursor += SLOT; }
      }
    };
    rowNums.forEach(place);
    const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    const blockKey = (block, dir) => mean(block.flatMap((id) => (dir === 'down' ? parentsOf(id) : childrenOf(id))).map((n) => x.get(n)).filter((v) => v != null));

    // Ordering sweeps (barycentre method).
    for (let sweep = 0; sweep < 6; sweep++) {
      const dir = sweep % 2 === 0 ? 'down' : 'up';
      const order = dir === 'down' ? rowNums.slice(1) : rowNums.slice(0, -1).reverse();
      for (const r of order) {
        const list = blocks.get(r);
        const keyed = list.map((b, i) => ({ b, i, k: blockKey(b, dir) ?? mean(b.map((id) => x.get(id))) }));
        keyed.sort((a, b2) => a.k - b2.k || a.i - b2.i);
        blocks.set(r, keyed.map((e) => e.b));
        place(r);
      }
    }

    // Positions: pull each block towards its relatives, without overlapping.
    for (let pass = 0; pass < 8; pass++) {
      const order = pass % 2 === 0 ? rowNums : [...rowNums].reverse();
      for (const r of order) {
        let prevEnd = -Infinity;
        for (const block of blocks.get(r)) {
          const width = block.length * SLOT;
          const relatives = block.flatMap((id) => [...parentsOf(id), ...childrenOf(id)]).map((n) => x.get(n)).filter((v) => v != null);
          const current = x.get(block[0]) - SLOT / 2;
          const wanted = relatives.length ? mean(relatives) - width / 2 : current;
          const left = Math.max(wanted, prevEnd);
          block.forEach((id, i) => x.set(id, left + i * SLOT + SLOT / 2));
          prevEnd = left + width;
        }
      }
    }
    const minX = Math.min(...members.map((id) => x.get(id)));
    for (const id of members) x.set(id, x.get(id) - minX + SLOT / 2);
    return { x, blocks };
  };

  // ---------- 4. place families side by side (biggest first; singles at the end) ----------
  const order = groups.map((m, i) => ({ m, i })).sort((a, b) => b.m.length - a.m.length || a.i - b.i);
  const nodes = [];
  const links = [];
  const posOf = new Map();
  let offset = 0;
  for (const { m } of order) {
    const { x, blocks } = layoutGroup(m);
    for (const id of m) {
      const node = { key: `${id}#w`, id, x: x.get(id) + offset, y: gen.get(id) * ROW_H, role: 'member' };
      nodes.push(node);
      posOf.set(id, node);
    }
    // Couple lines between neighbours in a block.
    for (const list of blocks.values()) {
      for (const block of list) {
        for (let i = 1; i < block.length; i++) {
          const a = posOf.get(block[i - 1]);
          const b = posOf.get(block[i]);
          if (partnersOf(block[i - 1]).includes(block[i])) links.push({ kind: 'spouse', d: `M${a.x + NODE_W / 2},${a.y} H${b.x - NODE_W / 2}` });
        }
      }
    }
    offset = Math.max(...m.map((id) => posOf.get(id).x)) + NODE_W / 2 + FAMILY_GAP;
  }

  // Parent -> child lines (from between a couple when both parents are side by side).
  for (const node of nodes) {
    const ps = parentsOf(node.id).map((p) => posOf.get(p)).filter(Boolean);
    if (!ps.length) continue;
    const childTop = node.y - NODE_H / 2;
    const adjacent = ps.length === 2 && ps[0].y === ps[1].y && Math.abs(ps[0].x - ps[1].x) <= SLOT + 1;
    const sources = adjacent
      ? [{ x: (ps[0].x + ps[1].x) / 2, y: ps[0].y }]
      : ps.map((p) => ({ x: p.x, y: p.y + NODE_H / 2 }));
    for (const s of sources) {
      const midY = Math.max(s.y, childTop - (ROW_H - NODE_H) / 2);
      links.push({ kind: 'parent', d: `M${s.x},${s.y} V${midY} H${node.x} V${childTop}` });
    }
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const bounds = nodes.length ? {
    minX: Math.min(...xs) - NODE_W / 2, maxX: Math.max(...xs) + NODE_W / 2,
    minY: Math.min(...ys) - NODE_H / 2, maxY: Math.max(...ys) + NODE_H / 2,
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { nodes, links, bounds, families: groups.length };
}
