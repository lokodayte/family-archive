// Tiny helpers for building the page safely (text is never treated as HTML).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Paragraphs from plain text (blank line = new paragraph). */
export function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => h('p', { class: 'prose' }, p));
}

/** Storage that never throws (private browsing, blocked storage...). */
export const safeStorage = {
  get(store, key) { try { return globalThis[store]?.getItem(key) ?? null; } catch { return null; } },
  set(store, key, v) { try { globalThis[store]?.setItem(key, v); } catch { /* ignore */ } },
  remove(store, key) { try { globalThis[store]?.removeItem(key); } catch { /* ignore */ } },
};

/** Keys are namespaced per archive so two archives on one domain don't mix. */
export function scopedKey(name) {
  const scope = location.pathname.split('/').filter(Boolean)[0] || 'root';
  return `fa:${scope}:${name}`;
}

export function toast(message, kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) document.body.append((box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
  const el = h('div', { class: `toast toast-${kind}` }, message);
  box.append(el);
  setTimeout(() => el.classList.add('fade'), 3500);
  setTimeout(() => el.remove(), 4200);
}
