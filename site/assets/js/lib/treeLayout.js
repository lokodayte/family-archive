// Works out where each box goes in the family tree ("hourglass": ancestors
// above, the chosen person in the middle, descendants below). No drawing here.

export const NODE_W = 172;
export const NODE_H = 64;
export const GAP_X = 20;
export const ROW_H = 124;
const SLOT = NODE_W + GAP_X;

const uniq = (arr) => [...new Set(arr)];

/**
 * @param g        graph from buildGraph()
 * @param focus    id of the person in the middle
 * @param opts.up / opts.down   generations to show
 * @param opts.sortKeyOf(id)    for ordering children by birth
 * @param opts.sexOf(id)        to put fathers on the left
 * @returns { nodes: [{key,id,x,y,role,moreUp,moreDown}], links: [{d,kind}], bounds }
 */
export function layoutTree(g, focus, opts = {}) {
  const up = opts.up ?? 3;
  const down = opts.down ?? 3;
  const sortKeyOf = opts.sortKeyOf || (() => null);
  const sexOf = opts.sexOf || (() => 'unknown');
  // Branches opened beyond the generation limit, or closed by hand.
  const expandUp = opts.expandUp || new Set();
  const expandDown = opts.expandDown || new Set();
  const collapseUp = opts.collapseUp || new Set();
  const collapseDown = opts.collapseDown || new Set();
  const nodes = [];
  const links = [];
  let n = 0;
  const parentIds = (id) => uniq(g.parentsOf(id).filter((p) => p.kind !== 'step').map((p) => p.id));
  const addNode = (id, x, y, role) => {
    const node = {
      key: `${id}#${n++}`, id, x, y, role,
      moreUp: false, moreDown: false, lessUp: false, lessDown: false,
    };
    nodes.push(node);
    return node;
  };
  const byBirth = (a, b) => {
    const ka = sortKeyOf(a), kb = sortKeyOf(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return ka - kb;
  };

  // ---------- descendants (and spouses) ----------
  function buildDown(id, depth, path) {
    const kids = uniq(g.childrenOf(id).map((c) => c.id)).filter((c) => !path.has(c));
    // Partners: recorded spouses, plus anyone who had a child with this person.
    const spouses = uniq([
      ...g.spousesOf(id).slice().sort((a, b) => byBirth2(a.rel.start, b.rel.start)).map((s) => s.id),
      ...kids.flatMap((c) => parentIds(c).filter((p) => p !== id)),
    ]).filter((s) => s !== id);
    const unit = { id, spouses, children: [], hasMoreDown: false, open: false };
    if (kids.length && !collapseDown.has(id) && (depth < down || expandDown.has(id))) {
      unit.open = true;
      const otherParentIndex = (c) => {
        const ps = parentIds(c);
        const i = spouses.findIndex((s) => ps.includes(s));
        return i === -1 ? spouses.length : i;
      };
      kids.sort((a, b) => otherParentIndex(a) - otherParentIndex(b) || byBirth(a, b));
      for (const c of kids) unit.children.push(buildDown(c, depth + 1, new Set([...path, c])));
    } else {
      unit.hasMoreDown = kids.length > 0;
    }
    unit.unitW = (1 + spouses.length) * SLOT;
    const childW = unit.children.reduce((s, c) => s + c.width, 0);
    unit.width = Math.max(unit.unitW, childW);
    return unit;
  }

  function placeDown(unit, left, y, role) {
    const cx = left + unit.width / 2;
    // Order on the row: odd-numbered spouses on the left, even-numbered on the right.
    const leftSp = unit.spouses.filter((_, i) => i % 2 === 1).reverse();
    const rightSp = unit.spouses.filter((_, i) => i % 2 === 0);
    const row = [...leftSp, unit.id, ...rightSp];
    let x = cx - unit.unitW / 2 + SLOT / 2;
    const pos = new Map();
    for (const id of row) {
      const node = addNode(id, x, y, id === unit.id ? role : 'spouse');
      if (id !== unit.id) node.moreUp = parentIds(id).length > 0;
      pos.set(id, node);
      x += SLOT;
    }
    const me = pos.get(unit.id);
    me.moreDown = unit.hasMoreDown;
    me.lessDown = unit.open;
    for (const sp of unit.spouses) {
      const s = pos.get(sp);
      const [a, b] = s.x < me.x ? [s, me] : [me, s];
      links.push({ kind: 'spouse', d: `M${a.x + NODE_W / 2},${y} H${b.x - NODE_W / 2}` });
    }
    let start = cx - unit.children.reduce((s, c) => s + c.width, 0) / 2;
    const childY = y + ROW_H;
    const midY = y + NODE_H / 2 + (ROW_H - NODE_H) / 2;
    for (const child of unit.children) {
      const childNode = placeDown(child, start, childY, 'descendant');
      start += child.width;
      const other = parentIds(child.id).find((p) => pos.has(p) && p !== unit.id);
      let fromX = me.x, fromY = y + NODE_H / 2;
      if (other) { fromX = (me.x + pos.get(other).x) / 2; fromY = y; }
      links.push({
        kind: 'parent',
        d: `M${fromX},${fromY} V${midY} H${childNode.x} V${childY - NODE_H / 2}`,
      });
    }
    return me;
  }

  // ---------- ancestors ----------
  function buildUp(id, depth, path) {
    const ps = parentIds(id).filter((p) => !path.has(p)).slice(0, 2);
    ps.sort((a, b) => (sexOf(a) === 'male' ? -1 : 0) - (sexOf(b) === 'male' ? -1 : 0));
    const unit = { id, parents: [], hasMoreUp: false, open: false };
    if (ps.length && !collapseUp.has(id) && (depth < up || expandUp.has(id))) {
      unit.parents = ps.map((p) => buildUp(p, depth + 1, new Set([...path, p])));
      unit.open = true;
    } else unit.hasMoreUp = ps.length > 0;
    unit.width = Math.max(SLOT, unit.parents.reduce((s, p) => s + p.width, 0));
    return unit;
  }

  function placeUp(unit, cx, y, existing) {
    const node = existing || addNode(unit.id, cx, y, 'ancestor');
    node.moreUp = unit.hasMoreUp;
    node.lessUp = unit.open;
    let start = cx - unit.parents.reduce((s, p) => s + p.width, 0) / 2;
    const parentY = y - ROW_H;
    const midY = y - NODE_H / 2 - (ROW_H - NODE_H) / 2;
    const placed = [];
    for (const p of unit.parents) {
      const pcx = start + p.width / 2;
      placed.push(placeUp(p, pcx, parentY));
      start += p.width;
    }
    if (placed.length === 2) {
      const [a, b] = placed;
      links.push({ kind: 'spouse', d: `M${a.x + NODE_W / 2},${parentY} H${b.x - NODE_W / 2}` });
    }
    if (placed.length) {
      const fromX = placed.length === 2 ? (placed[0].x + placed[1].x) / 2 : placed[0].x;
      const fromY = placed.length === 2 ? parentY : parentY + NODE_H / 2;
      links.push({ kind: 'parent', d: `M${fromX},${fromY} V${midY} H${node.x} V${y - NODE_H / 2}` });
    }
    return node;
  }

  const downRoot = buildDown(focus, 0, new Set([focus]));
  const focusNode = placeDown(downRoot, 0, 0, 'focus');
  const upRoot = buildUp(focus, 0, new Set([focus]));
  placeUp(upRoot, focusNode.x, 0, focusNode);

  // Put the chosen person at (0, 0).
  const dx = focusNode.x;
  for (const node of nodes) node.x -= dx;
  for (const l of links) {
    l.d = l.d.replace(/([MH])(-?[\d.]+)/g, (_, c, v) => `${c}${round(Number(v) - dx)}`)
      .replace(/([V])(-?[\d.]+)/g, (_, c, v) => `${c}${round(Number(v))}`)
      .replace(/,(-?[\d.]+)/g, (_, v) => `,${round(Number(v))}`);
  }

  const xs = nodes.map((n2) => n2.x), ys = nodes.map((n2) => n2.y);
  const bounds = {
    minX: Math.min(...xs) - NODE_W / 2, maxX: Math.max(...xs) + NODE_W / 2,
    minY: Math.min(...ys) - NODE_H / 2, maxY: Math.max(...ys) + NODE_H / 2,
  };
  return { nodes, links, bounds };

  function byBirth2(a, b) {
    // spouses: order by marriage date when known
    const ka = a?.date ? a.date : a?.from || null;
    const kb = b?.date ? b.date : b?.from || null;
    if (!ka && !kb) return 0;
    if (!ka) return 1;
    if (!kb) return -1;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }
}

const round = (v) => Math.round(v * 10) / 10;
