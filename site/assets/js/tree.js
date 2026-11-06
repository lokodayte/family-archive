// Draws the interactive family tree (SVG) with zoom and pan (mouse, trackpad, touch).
import { layoutTree, NODE_W, NODE_H } from './lib/treeLayout.js';
import { displayName } from './lib/model.js';
import { lifespan } from './lib/timeline.js';
import { sortKey } from './lib/dates.js';
import { t } from './lib/i18n.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
};

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @returns {{ zoomBy(f), fit(), destroy() }}
 */
export function renderTree(container, {
  graph, people, focus, up = 3, down = 3, onSelect, onToggle,
  expandUp, expandDown, collapseUp, collapseDown,
}) {
  const layout = layoutTree(graph, focus, {
    up, down, expandUp, expandDown, collapseUp, collapseDown,
    sortKeyOf: (id) => sortKey(people.get(id)?.birth?.date),
    sexOf: (id) => people.get(id)?.sex,
  });

  const svg = s('svg', { class: 'tree-svg', role: 'group', 'aria-label': t('Family tree') });
  const world = s('g');
  svg.append(world);

  const linkLayer = s('g', { class: 'tree-links' });
  for (const l of layout.links) linkLayer.append(s('path', { d: l.d, class: `tree-link tree-link-${l.kind}` }));
  world.append(linkLayer);

  for (const node of layout.nodes) {
    const p = people.get(node.id);
    if (!p) continue;
    const name = displayName(p);
    const g = s('g', {
      class: `tree-node role-${node.role} sex-${p.sex || 'unknown'}${p.placeholder ? ' placeholder' : ''}${p.privacy === 'family' ? ' family' : ''}`,
      transform: `translate(${node.x - NODE_W / 2},${node.y - NODE_H / 2})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${name} ${lifespan(p)}`,
      'data-id': node.id,
    });
    g.append(
      s('rect', { width: NODE_W, height: NODE_H, rx: 10, class: 'tree-box' }),
      s('rect', { width: 5, height: NODE_H - 16, x: 6, y: 8, rx: 2, class: 'tree-stripe' }),
    );
    const title = s('text', { x: 20, y: 27, class: 'tree-name' });
    title.textContent = truncate(p.placeholder && name === 'Unknown person' ? `? ${t('Unknown')}` : name, 20);
    const sub = s('text', { x: 20, y: 47, class: 'tree-dates' });
    sub.textContent = lifespan(p);
    g.append(title, sub, s('title', {}, document.createTextNode(`${name} ${lifespan(p)}`)));
    // Little buttons to open (▲ ▼) or close (–) a branch.
    const toggle = (dir, action, cy, shape) => {
      const b = s('g', { class: `tree-toggle tree-${action}`, 'data-dir': dir, 'data-action': action, 'data-id': node.id, transform: `translate(${NODE_W / 2},${cy})` },
        s('circle', { r: 10 }), s('path', { d: shape }));
      b.append(s('title', {}, document.createTextNode(t(action === 'open' ? (dir === 'up' ? 'Show parents' : 'Show children') : (dir === 'up' ? 'Hide parents' : 'Hide children')))));
      g.append(b);
    };
    const tri = (up) => (up ? 'M-5,3 L0,-4 L5,3 Z' : 'M-5,-3 L0,4 L5,-3 Z');
    const minus = 'M-5,0 H5';
    if (node.moreUp && node.role !== 'spouse') toggle('up', 'open', -12, tri(true));
    else if (node.moreUp) g.append(s('path', { d: `M${NODE_W / 2 - 6},-3 l6,-7 l6,7 z`, class: 'tree-more' }));
    else if (node.lessUp) toggle('up', 'close', -12, minus);
    if (node.moreDown) toggle('down', 'open', NODE_H + 12, tri(false));
    else if (node.lessDown) toggle('down', 'close', NODE_H + 12, minus);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(node.id); }
    });
    world.append(g);
  }

  container.replaceChildren(svg);

  // ---------- view box, zoom and pan ----------
  const b = layout.bounds;
  let vb = { x: 0, y: 0, w: 1, h: 1 };
  // Big trees: only boxes near the visible area are drawn.
  const nodeEls = [...world.querySelectorAll('.tree-node')].map((el) => {
    const m = el.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    return { el, x: Number(m[1]), y: Number(m[2]) };
  });
  let cullQueued = false;
  const cull = () => {
    cullQueued = false;
    if (nodeEls.length < 150) return;
    const mx = vb.w * 0.3;
    const my = vb.h * 0.3;
    for (const n of nodeEls) {
      const visible = n.x + NODE_W > vb.x - mx && n.x < vb.x + vb.w + mx && n.y + NODE_H > vb.y - my && n.y < vb.y + vb.h + my;
      n.el.style.display = visible ? '' : 'none';
    }
  };
  const apply = () => {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    if (!cullQueued) { cullQueued = true; requestAnimationFrame(cull); }
  };

  function fit() {
    const pad = 40;
    const rect = svg.getBoundingClientRect();
    const aspect = rect.height && rect.width ? rect.height / rect.width : 0.6;
    let w = b.maxX - b.minX + pad * 2;
    let h = b.maxY - b.minY + pad * 2;
    // Don't zoom in further than life-size on small trees.
    w = Math.max(w, rect.width || w);
    h = Math.max(h, w * aspect);
    w = Math.max(w, h / aspect);
    vb = { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
    // On small screens start zoomed on the chosen person instead of showing everything tiny.
    if (rect.width && rect.width < 700 && w > rect.width * 1.6) {
      const w2 = rect.width * 1.25;
      vb = { x: -w2 / 2, y: -(w2 * aspect) / 2, w: w2, h: w2 * aspect };
    }
    apply();
  }

  const toWorld = (clientX, clientY) => {
    const pt = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  };

  function zoomAt(clientX, clientY, factor) {
    const p = toWorld(clientX, clientY);
    const nw = Math.min(Math.max(vb.w * factor, 200), 30000);
    const f = nw / vb.w;
    vb = { x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w: vb.w * f, h: vb.h * f };
    apply();
  }

  function zoomBy(factor) {
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  const pointers = new Map();
  let moved = 0;
  let pinchDist = 0;
  let downTarget = null;

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    downTarget = e.target.closest?.('.tree-toggle') || e.target.closest?.('.tree-node');
    if (pointers.size === 2) {
      const [a, c] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - c.x, a.y - c.y);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      const p0 = toWorld(prev.x, prev.y);
      const p1 = toWorld(cur.x, cur.y);
      vb.x -= p1.x - p0.x;
      vb.y -= p1.y - p0.y;
      moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      apply();
    }
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2) {
      const [a, c] = [...pointers.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      if (pinchDist) zoomAt((a.x + c.x) / 2, (a.y + c.y) / 2, pinchDist / d);
      pinchDist = d;
      moved += 10;
    }
  });
  const end = (e) => {
    if (pointers.size === 1 && moved < 6 && downTarget) {
      if (downTarget.classList.contains('tree-toggle')) onToggle?.(downTarget.dataset.id, downTarget.dataset.dir, downTarget.dataset.action);
      else onSelect?.(downTarget.dataset.id);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    downTarget = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); downTarget = null; });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(delta * 0.0015));
  }, { passive: false });

  const ro = new ResizeObserver(() => fit());
  ro.observe(svg);
  requestAnimationFrame(fit);

  return { zoomBy, fit, destroy: () => ro.disconnect() };
}
