// Showing photos: lazy loading (only when on screen) and name tags on top of images.
import { h } from './dom.js';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
let observer = null;

function watch(img) {
  if (!('IntersectionObserver' in window)) { img._load(); return; }
  observer ||= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      e.target._load();
    }
  }, { rootMargin: '400px 0px' });
  observer.observe(img);
}

/**
 * An <img> that only loads when it scrolls near the screen.
 * load() returns a Promise of the image URL (a plain URL or a decrypted blob URL).
 */
export function lazyImage(load, { alt = '', className = '', width, height, eager = false } = {}) {
  const img = h('img', { src: BLANK, alt, class: `lazy ${className}`, decoding: 'async', width, height, draggable: 'false' });
  img._load = async () => {
    try {
      const url = await load();
      if (!url) { img.classList.add('missing'); return; }
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.src = url;
    } catch (err) {
      console.warn('Image failed', err);
      img.classList.add('missing');
    }
  };
  if (eager) img._load(); else watch(img);
  return img;
}

/** Keeps decrypted images in memory (limited), so scrolling back is instant. */
export class BlobCache {
  constructor(limit = 400) { this.limit = limit; this.map = new Map(); }
  async get(key, makeBytes, type = 'image/jpeg') {
    if (this.map.has(key)) {
      const v = this.map.get(key);
      this.map.delete(key); this.map.set(key, v); // most recently used
      return v;
    }
    const promise = (async () => {
      const bytes = await makeBytes();
      return bytes ? URL.createObjectURL(new Blob([bytes], { type })) : null;
    })();
    this.map.set(key, promise);
    promise.catch(() => this.map.delete(key));
    while (this.map.size > this.limit) {
      const [oldKey, old] = this.map.entries().next().value;
      this.map.delete(oldKey);
      old.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    }
    return promise;
  }
}

/**
 * Draw name tags over an image.
 * tags: [{ person, x, y }] with x/y from 0 to 1.
 */
export function tagLayer(tags, { nameOf, hrefOf, onClickTag, highlight } = {}) {
  const layer = h('div', { class: 'tag-layer' });
  for (const tag of tags) {
    const name = nameOf(tag.person);
    const inner = [h('span', { class: 'tag-dot', 'aria-hidden': 'true' }), h('span', { class: 'tag-label' }, name)];
    const attrs = {
      class: `tag${highlight === tag.person ? ' tag-highlight' : ''}`,
      style: `left:${tag.x * 100}%;top:${tag.y * 100}%`,
      title: name,
    };
    let el;
    if (onClickTag) el = h('button', { ...attrs, type: 'button', onclick: (e) => { e.stopPropagation(); onClickTag(tag, e); } }, inner);
    else if (hrefOf) el = h('a', { ...attrs, href: hrefOf(tag.person) }, inner);
    else el = h('span', attrs, inner);
    layer.append(el);
  }
  return layer;
}

/** Where on the image (0–1) a click landed. */
export function clickPosition(e, el) {
  const r = el.getBoundingClientRect();
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return {
    x: Math.round(clamp((e.clientX - r.left) / r.width) * 1000) / 1000,
    y: Math.round(clamp((e.clientY - r.top) / r.height) * 1000) / 1000,
  };
}
