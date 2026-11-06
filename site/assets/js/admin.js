// The admin panel: manage the archive from the browser, no code editing.
import { h, clear, debounce, safeStorage, scopedKey, toast } from './lib/dom.js';
import { t, loadLanguage } from './lib/i18n.js';
import { GitHubRepo, GitHubError } from './lib/github.js';
import { MemoryRepo } from './lib/memoryRepo.js';
import { AdminStore } from './lib/adminStore.js';
import { exportKey, importKey, WrongPasswordError } from './lib/crypto.js';
import {
  emptyPerson, newId, displayName, searchPeople, summarize, initials,
  SCRIPTS, SCRIPT_LABELS, effectivePrivacy, relPeople, mediaPath, effectivePhotoPrivacy,
  photoTitle, PHOTO_KINDS, normalizeText,
} from './lib/model.js';
import { processImage, rotateImage, formatBytes, ACCEPTED } from './lib/images.js';
import { lazyImage, BlobCache, tagLayer, clickPosition } from './lib/media.js';
import { sortPhotos } from './lib/gallery.js';
import { parseDate, formatDate, DATE_HELP } from './lib/dates.js';
import { PARENT_KINDS } from './lib/relations.js';
import { lifespan, EVENT_TYPES } from './lib/timeline.js';

const view = document.getElementById('admin-view');
const savebar = document.getElementById('savebar');
const banners = document.getElementById('banners');
const TOKEN_KEY = scopedKey('ghToken');
const FAMILY_KEY = scopedKey('familyKey');
const STORAGE_LIMIT_KB = 1024 * 1024; // GitHub's recommended ~1 GB
const params = new URLSearchParams(location.search);
const PRACTICE = params.has('practice') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

let store = null;
let editorDirty = false;
let publishState = { state: 'idle' };
let pollTimer = null;
let storageKB = null;

// =====================================================================
// Start-up: token → family password → main screens
// =====================================================================

async function repoName() {
  try {
    const cfg = await (await fetch('../data/config.json', { cache: 'no-cache' })).json();
    if (cfg.repo) return cfg.repo.split('/');
  } catch { /* fall through */ }
  const owner = location.hostname.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return [owner, repo];
}

async function start() {
  await loadLanguage('../');
  if (PRACTICE) {
    const repo = new MemoryRepo({}, {
      loader: async (path) => {
        const res = await fetch(`../${path}`, { cache: 'no-cache' });
        return res.ok ? res.text() : null;
      },
    });
    banners.append(h('div', { class: 'practice-banner' }, t('Practice mode: changes stay in this browser tab and are NOT saved to GitHub. Reload the page to start over.')));
    return openStore(repo);
  }
  const token = safeStorage.get('localStorage', TOKEN_KEY);
  if (!token) return tokenScreen();
  const [owner, name] = await repoName();
  return openStore(new GitHubRepo({ owner, repo: name, token }));
}

function tokenScreen(error) {
  const input = h('input', { type: 'password', name: 'token', autocomplete: 'off', placeholder: 'github_pat_…', required: true, spellcheck: 'false' });
  const msg = h('p', { class: 'form-message', role: 'alert' }, error || '');
  const form = h('form', {
    class: 'panel narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      const token = input.value.trim();
      msg.textContent = t('Checking…');
      const [owner, name] = await repoName();
      const repo = new GitHubRepo({ owner, repo: name, token });
      try {
        await repo.checkAccess();
        await repo.getHead();
      } catch (err) {
        msg.textContent = err.status === 401
          ? t('GitHub did not accept this token. Check you copied all of it, and that it has not expired.')
          : err.status === 404
            ? t('This token cannot see the repository {repo}. When creating it, choose "Only select repositories" and pick {repo}.', { repo: `${owner}/${name}` })
            : t('Could not reach GitHub: {msg}', { msg: err.message });
        return;
      }
      safeStorage.set('localStorage', TOKEN_KEY, token);
      openStore(repo);
    },
  },
  h('h1', {}, t('Unlock the admin panel')),
  h('p', {}, t('The first time you use the admin panel on a device, paste your GitHub access token. It is stored only in this browser.')),
  h('label', { class: 'field' }, h('span', {}, t('GitHub token')), input),
  msg,
  h('button', { class: 'btn btn-primary', type: 'submit' }, t('Unlock')),
  tokenHelp());
  clear(view, form);
  input.focus();
}

function tokenHelp() {
  const prefill = 'https://github.com/settings/personal-access-tokens/new?name=Family+archive+admin&description=Lets+the+family+archive+admin+panel+save+changes&expires_in=366&contents=write&actions=read';
  return h('details', { class: 'help-box' },
    h('summary', {}, t('How do I get a token? (step by step)')),
    h('ol', {},
      h('li', {}, t('Open '), h('a', { href: prefill, target: '_blank', rel: 'noopener' }, t('GitHub → New fine-grained token')), t(' (sign in if asked).')),
      h('li', {}, t('Token name: "Family archive admin". Expiration: 1 year (put a reminder in your calendar to make a new one).')),
      h('li', {}, t('Repository access: choose "Only select repositories" and pick '), h('strong', {}, 'family-archive'), '.'),
      h('li', {}, t('Permissions → Repository permissions: set "Contents" to "Read and write" and "Actions" to "Read-only". ("Metadata: Read-only" is added automatically.) Leave everything else as "No access".')),
      h('li', {}, t('Click "Generate token", then copy the token (it starts with github_pat_). GitHub shows it only once.')),
      h('li', {}, t('Paste it above and click Unlock.'))),
    h('p', { class: 'muted small' }, t('Keep the token secret, like a password: anyone who has it can change the archive. If you think it leaked, delete it on GitHub and make a new one.')));
}

async function openStore(repo) {
  clear(view, h('p', { class: 'loading' }, t('Loading the archive…')));
  store = new AdminStore(repo, {
    siteLoader: async (path) => {
      const res = await fetch(`../${path}`);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
  });
  try {
    await store.load();
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 401 || err.status === 403)) {
      safeStorage.remove('localStorage', TOKEN_KEY);
      return tokenScreen(t('Your saved token no longer works (it may have expired). Please paste a new one.'));
    }
    return clear(view, h('div', { class: 'panel' }, h('h1', {}, t('Could not load the archive')), h('p', {}, err.message),
      h('button', { class: 'btn', onclick: () => location.reload() }, t('Try again'))));
  }
  if (!store.hasFamilyPassword) return createPasswordScreen();
  const saved = safeStorage.get('localStorage', FAMILY_KEY) || safeStorage.get('sessionStorage', FAMILY_KEY);
  if (saved) {
    try {
      await store.useKey(await importKey(saved));
      return enterApp();
    } catch {
      safeStorage.remove('localStorage', FAMILY_KEY);
      safeStorage.remove('sessionStorage', FAMILY_KEY);
    }
  }
  return familyPasswordScreen();
}

function familyPasswordScreen() {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const remember = h('input', { type: 'checkbox', checked: true });
  const msg = h('p', { class: 'form-message', role: 'alert' });
  clear(view, h('form', {
    class: 'panel narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = t('Unlocking…');
      try {
        const key = await store.unlock(input.value);
        safeStorage.set(remember.checked ? 'localStorage' : 'sessionStorage', FAMILY_KEY, await exportKey(key));
        enterApp();
      } catch (err) {
        msg.textContent = err instanceof WrongPasswordError ? t('That family password is not right.') : err.message;
      }
    },
  },
  h('h1', {}, t('Family password')),
  h('p', {}, t('Enter the family password to see and edit family-only information.')),
  h('label', { class: 'field' }, h('span', {}, t('Family password')), input),
  h('label', { class: 'check' }, remember, t('Remember on this device')),
  msg,
  h('button', { class: 'btn btn-primary', type: 'submit' }, t('Unlock'))));
  input.focus();
}

function createPasswordScreen() {
  const a = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
  const b = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const msg = h('p', { class: 'form-message', role: 'alert' });
  clear(view, h('form', {
    class: 'panel narrow',
    onsubmit: async (e) => {
      e.preventDefault();
      if (a.value.length < 10) { msg.textContent = t('Please use at least 10 characters.'); return; }
      if (a.value !== b.value) { msg.textContent = t('The two passwords are different.'); return; }
      msg.textContent = t('Setting up… this takes a few seconds.');
      try {
        await store.createFamilyPassword(a.value);
        safeStorage.set('localStorage', FAMILY_KEY, await exportKey(store.key));
        enterApp();
      } catch (err) { msg.textContent = err.message; }
    },
  },
  h('h1', {}, t('Choose a family password')),
  h('p', {}, t('This password locks all family-only information. Share it only with relatives. Tip: a few random words are easy to remember and hard to guess, e.g. "apricot river lantern 48".')),
  h('p', { class: 'notice notice-warn' }, t('Write it down somewhere safe. If it is lost, family-only information cannot be recovered by anyone.')),
  h('label', { class: 'field' }, h('span', {}, t('New family password')), a),
  h('label', { class: 'field' }, h('span', {}, t('Type it again')), b),
  msg,
  h('button', { class: 'btn btn-primary', type: 'submit' }, t('Create password'))));
  a.focus();
}

function enterApp() {
  document.getElementById('admin-nav').hidden = false;
  savebar.hidden = false;
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (store.pendingCount || editorDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  renderSavebar();
  refreshStorage();
  route();
}

// =====================================================================
// Save bar: "3 unsaved changes [Save & publish]" and publishing status
// =====================================================================

function renderSavebar() {
  const n = store.pendingCount;
  const status = {
    idle: n ? null : h('span', { class: 'status status-ok' }, '✓ ', t('Everything is saved')),
    saving: h('span', { class: 'status status-busy' }, h('span', { class: 'spinner' }), t('Saving…')),
    uploading: h('span', { class: 'status status-busy' }, h('span', { class: 'spinner' }), t('Uploading images: {done} of {total}…', publishState)),
    waiting: h('span', { class: 'status status-busy' }, h('span', { class: 'spinner' }), t('GitHub asked us to slow down. Waiting {sec} seconds, then continuing — keep this page open.', publishState)),
    publishing: h('span', { class: 'status status-busy' }, h('span', { class: 'spinner' }), t('Saved. Live in about a minute…')),
    live: h('span', { class: 'status status-ok' }, '✓ ', t('Live on the site'), publishState.at ? ` (${publishState.at})` : ''),
    saved: h('span', { class: 'status status-ok' }, '✓ ', t('Saved. Live in about a minute.')),
    failed: h('span', { class: 'status status-bad' }, '⚠ ', t('Saved, but the site was not updated (a safety check failed). See Help.')),
    error: h('span', { class: 'status status-bad' }, '⚠ ', publishState.message || t('Saving failed')),
  }[publishState.state];

  clear(savebar,
    n ? h('details', { class: 'pending' },
      h('summary', {}, t(n === 1 ? '1 unsaved change' : '{n} unsaved changes', { n })),
      h('div', { class: 'pending-list' },
        h('ul', {}, store.ops.map((o) => h('li', {}, o.text))),
        h('button', { class: 'btn btn-quiet btn-small', onclick: discardAll }, t('Discard these changes')))) : null,
    n ? h('button', { class: 'btn btn-primary', onclick: saveAll, disabled: ['saving', 'uploading', 'waiting'].includes(publishState.state) }, t('Save & publish')) : null,
    status);
}

async function saveAll() {
  if (editorDirty && !confirm(t('You are in the middle of editing. Those edits are not kept yet. Save the other changes anyway?'))) return;
  const upload = store.pendingUploadBytes;
  if (upload && storageKB != null && (storageKB * 1024 + upload) / (STORAGE_LIMIT_KB * 1024) >= 0.7
    && !confirm(t('These uploads ({size}) will bring storage above 70% of the ~1 GB limit. Continue?', { size: formatBytes(upload) }))) return;
  publishState = { state: 'saving' };
  renderSavebar();
  store.repo.onWait = (sec) => { publishState = { state: 'waiting', sec }; renderSavebar(); };
  try {
    const result = await store.save({
      onProgress: ({ done, total }) => { publishState = { state: 'uploading', done, total }; renderSavebar(); },
    });
    if (!result) { publishState = { state: 'idle' }; renderSavebar(); return; }
    publishState = { state: 'publishing', sha: result.sha };
    renderSavebar();
    toast(t('Saved to GitHub. The site will update in about a minute.'), 'ok');
    watchPublish(result.sha);
    if (!editorDirty) route();
  } catch (err) {
    publishState = { state: 'error', message: t('Saving failed: {msg}. Your changes are still here — try again.', { msg: err.message }) };
    renderSavebar();
  }
}

function watchPublish(sha) {
  clearTimeout(pollTimer);
  const started = Date.now();
  const tick = async () => {
    let s;
    try { s = await store.repo.deployStatus(sha); } catch { s = 'unknown'; }
    if (publishState.sha !== sha) return; // a newer save took over
    if (s === 'live') {
      publishState = { state: 'live', at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    } else if (s === 'failed') {
      publishState = { state: 'failed' };
    } else if (s === 'unknown' || Date.now() - started > 8 * 60_000) {
      publishState = { state: 'saved' };
    } else {
      pollTimer = setTimeout(tick, 5000);
      return;
    }
    renderSavebar();
    refreshStorage();
  };
  pollTimer = setTimeout(tick, 4000);
}

async function discardAll() {
  if (!confirm(t('Throw away all unsaved changes?'))) return;
  await store.discard();
  editorDirty = false;
  publishState = { state: 'idle' };
  renderSavebar();
  location.hash = '#/people';
  route();
}

function changed() {
  publishState = publishState.state === 'saving' ? publishState : { state: 'idle' };
  renderSavebar();
}

// =====================================================================
// Storage meter
// =====================================================================

async function refreshStorage() {
  try { storageKB = await store.repo.sizeKB(); } catch { storageKB = null; }
  renderBanners();
}

function storageMeter() {
  if (storageKB == null) return null;
  const pct = Math.min(100, (storageKB / STORAGE_LIMIT_KB) * 100);
  const mb = storageKB / 1024;
  return h('div', { class: `meter${pct >= 70 ? ' meter-warn' : ''}` },
    h('div', { class: 'meter-label' },
      h('span', {}, t('Storage used')),
      h('span', {}, t('{used} of about 1 GB ({pct}%)', { used: mb < 1 ? `${Math.max(1, Math.round(storageKB))} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`, pct: pct.toFixed(pct < 1 ? 1 : 0) }))),
    h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill', style: `width:${Math.max(pct, 0.5)}%` })),
    h('p', { class: 'muted small' }, t('Includes the full history of every change. GitHub updates this number with some delay.')));
}

function renderBanners() {
  for (const el of banners.querySelectorAll('.storage-warn')) el.remove();
  if (storageKB != null && storageKB / STORAGE_LIMIT_KB >= 0.7) {
    banners.append(h('div', { class: 'notice notice-warn storage-warn' },
      h('p', {}, t('Storage is over 70% full. Before adding many more photos, read "Running out of space" in the Help page.'))));
  }
}

// =====================================================================
// Router
// =====================================================================

async function route() {
  const [, page, id] = (location.hash || '#/people').split('/');
  if (editorDirty && `${page}/${id}` !== currentEditRoute) {
    if (!confirm(t('Leave without keeping your edits?'))) {
      history.replaceState(null, '', `#/${currentEditRoute}`);
      return;
    }
    editorDirty = false;
  }
  const section = { person: 'people', new: 'people', photo: 'photos' }[page] || page || 'people';
  document.querySelectorAll('#admin-nav a[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === section));
  if (page === 'person' && id) await editorPage(decodeURIComponent(id));
  else if (page === 'photos') photosPage();
  else if (page === 'photo' && id) await photoEditorPage(decodeURIComponent(id));
  else if (page === 'new') await editorPage(null);
  else if (page === 'settings') settingsPage();
  else if (page === 'help') helpPage();
  else peoplePage();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// =====================================================================
// People list
// =====================================================================

let listFilter = 'all';
let listQuery = '';

function peoplePage() {
  const results = h('div', { class: 'admin-list' });
  const filters = {
    all: [t('All'), () => true],
    public: [t('Public'), (s) => s.privacy === 'public'],
    family: [t('Family only'), (s) => s.privacy === 'family'],
    living: [t('Living'), (s) => s.living],
    placeholder: [t('Placeholders'), (s) => s.placeholder],
  };
  const render = () => {
    const base = listQuery.trim()
      ? searchPeople(store.people, listQuery, 1000)
      : [...store.people.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const list = base.filter(filters[listFilter][1]);
    clear(results, list.length
      ? list.map((s) => h('a', { class: 'admin-row', href: `#/person/${s.id}` },
        h('span', { class: 'monogram small', 'aria-hidden': 'true' }, initials(s)),
        h('span', { class: 'admin-row-main' },
          h('strong', {}, displayName(s)),
          h('span', { class: 'muted small' }, lifespan(s))),
        h('span', { class: 'badges' },
          h('span', { class: `badge ${s.privacy === 'public' ? 'badge-public' : 'badge-family'}` }, s.privacy === 'public' ? t('Public') : t('Family')),
          s.living && h('span', { class: 'badge' }, t('Living')),
          s.placeholder && h('span', { class: 'badge badge-placeholder' }, t('Placeholder')),
          store.pending.has(s.id) && h('span', { class: 'badge badge-unsaved' }, t('Unsaved')))))
      : h('p', { class: 'muted' }, store.people.size ? t('No one matches.') : t('No people yet. Click "Add a person" to begin.')));
  };
  const search = h('input', {
    type: 'search', class: 'search-input', placeholder: t('Find a person…'), value: listQuery, autocomplete: 'off',
    oninput: debounce((e) => { listQuery = e.target.value; render(); }, 80),
  });
  render();
  clear(view,
    h('div', { class: 'admin-title' },
      h('h1', {}, t('People')),
      h('a', { class: 'btn btn-primary', href: '#/new' }, '+ ', t('Add a person'))),
    search,
    h('div', { class: 'filter-chips', role: 'group', 'aria-label': t('Show') }, Object.entries(filters).map(([k, [label]]) =>
      h('button', {
        class: `chip-btn${listFilter === k ? ' on' : ''}`, 'aria-pressed': String(listFilter === k),
        onclick: () => { listFilter = k; peoplePage(); },
      }, label))),
    h('p', { class: 'muted small' }, t('{n} people', { n: store.people.size })),
    results,
    h('div', { class: 'panel' }, storageMeter() || h('p', { class: 'muted small' }, t('Storage information is not available right now.'))));
}

// =====================================================================
// Person editor
// =====================================================================

let currentEditRoute = null;

/** Search-as-you-type box to pick a person (or create one). */
function personPicker({ label, excludeIds = [], extraPeople = () => [], onPick, allowCreate = true }) {
  const input = h('input', { type: 'search', autocomplete: 'off', placeholder: t('Type a name…'), 'aria-label': label });
  const list = h('ul', { class: 'picker-list', role: 'listbox', hidden: true });
  let items = [];
  let active = -1;
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = '';
    list.hidden = true;
    it.action();
  };
  const render = () => {
    const q = input.value.trim();
    if (!q) { list.hidden = true; return; }
    const pool = new Map([...store.people, ...extraPeople().map((s) => [s.id, s])]);
    const found = searchPeople(pool, q, 8).filter((s) => !excludeIds.includes(s.id));
    items = found.map((s) => ({ label: [displayName(s), h('span', { class: 'muted small' }, ` ${lifespan(s)}`)], action: () => onPick(s.id) }));
    if (allowCreate) {
      items.push({ label: [h('strong', {}, '+ '), t('Create a new person: “{q}”', { q })], action: () => onPick(null, { name: q }) });
      items.push({ label: [h('strong', {}, '? '), t('Add an unknown person (placeholder)')], action: () => onPick(null, { placeholder: true }) });
    }
    active = 0;
    clear(list, items.map((it, i) => h('li', {
      role: 'option', class: i === active ? 'active' : '',
      onmousedown: (e) => { e.preventDefault(); choose(i); },
    }, it.label)));
    list.hidden = false;
  };
  input.addEventListener('input', debounce(render, 60));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') { e.preventDefault(); choose(active); } else if (e.key === 'Escape') { list.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  return h('div', { class: 'picker' }, input, list);
}

function newPersonFrom({ name, placeholder }) {
  const p = emptyPerson();
  if (placeholder) {
    p.placeholder = true;
  } else {
    const parts = name.trim().split(/\s+/);
    const latin = /[A-Za-z]/.test(name);
    const script = latin ? 'latin' : /[԰-֏]/.test(name) ? 'armenian' : /[Ѐ-ӿ]/.test(name) ? 'cyrillic' : 'latin';
    p.names[script] = { first: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0], last: parts.length > 1 ? parts.at(-1) : '' };
  }
  return p;
}

/** Form fields that call touch() when changed. */
function fieldKit(touch) {
  const text = (label, get, set, opts = {}) => {
    const attrs = {
      value: get() || '', placeholder: opts.placeholder || '', lang: opts.lang,
      oninput: (e) => { set(e.target.value); touch(); opts.onchange?.(); },
    };
    const input = opts.multiline ? h('textarea', { ...attrs, rows: opts.rows || 6 }) : h('input', { type: opts.type || 'text', ...attrs });
    return h('label', { class: `field ${opts.class || ''}` }, h('span', {}, label), input, opts.hint && h('small', { class: 'muted' }, opts.hint));
  };
  const select = (label, options, get, set) => h('label', { class: 'field' }, h('span', {}, label),
    h('select', { value: get() || '', onchange: (e) => { set(e.target.value); touch(); } },
      Object.entries(options).map(([v, l]) => h('option', { value: v }, l))));
  const dateField = (label, get, set) => {
    const preview = h('small', { class: 'date-preview' });
    const show = (value) => {
      const r = parseDate(value);
      if (r.ok) {
        set(r.value);
        preview.className = 'date-preview ok';
        preview.textContent = r.value ? `✓ ${formatDate(r.value)}` : '';
      } else {
        preview.className = 'date-preview bad';
        preview.textContent = t('✗ I can’t read this date. {help}', { help: DATE_HELP });
      }
    };
    const input = h('input', {
      type: 'text', value: formatDate(get()), placeholder: t('e.g. about 1920'),
      oninput: (e) => { show(e.target.value); touch(); },
    });
    show(input.value);
    return h('label', { class: 'field' }, h('span', {}, label), input, preview);
  };
  const listField = (label, get, set, hint) => text(label, () => (get() || []).join(', '),
    (v) => set(v.split(',').map((x) => x.trim()).filter(Boolean)), { hint });

  return { text, select, dateField, listField };
}

async function editorPage(id) {
  clear(view, h('p', { class: 'loading' }, t('Loading…')));
  const isNew = !id || !store.people.has(id);
  if (id && isNew) {
    clear(view, h('h1', {}, t('Person not found')), h('a', { href: '#/people' }, t('Back to people')));
    return;
  }
  let person;
  try {
    person = isNew ? emptyPerson() : await store.getPerson(id);
  } catch (err) {
    clear(view, h('h1', {}, t('Could not open this person')), h('p', {}, err.message));
    return;
  }
  for (const k of ['names', 'birth', 'death']) person[k] = person[k] || {};
  for (const k of ['nicknames', 'languages', 'stories', 'events', 'sources']) person[k] = person[k] || [];
  for (const sc of SCRIPTS) person.names[sc] = person.names[sc] || {};

  currentEditRoute = `person/${person.id}`;
  if (isNew) history.replaceState(null, '', `#/person/${person.id}`);
  const draftRels = store.relsOf(person.id).map((r) => structuredClone(r));
  const newPeople = [];
  editorDirty = isNew;
  const touch = () => { editorDirty = true; };

  const lookup = (pid) => store.people.get(pid) || summarize(newPeople.find((p) => p.id === pid) || { id: pid });
  const nameOf = (pid) => displayName(lookup(pid));

  const { text, select, dateField, listField } = fieldKit(touch);

  /** A list of repeatable blocks (stories, events, sources). */
  const repeatable = (title, arr, makeItem, renderItem, addLabel) => {
    const box = h('div', { class: 'repeat' });
    const draw = () => clear(box,
      arr.map((item, i) => h('div', { class: 'repeat-item' },
        renderItem(item),
        h('button', {
          type: 'button', class: 'btn btn-quiet btn-small', onclick: () => {
            if (!confirm(t('Remove this item?'))) return;
            arr.splice(i, 1); touch(); draw();
          },
        }, t('Remove')))),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => { arr.push(makeItem()); touch(); draw(); } }, `+ ${addLabel}`));
    draw();
    return h('section', { class: 'panel' }, h('h2', {}, title), box);
  };

  // ----- status & privacy -----
  const privacyBox = h('div', {});
  const deathBox = h('div', {});
  const drawPrivacy = () => clear(privacyBox,
    h('fieldset', { class: 'radio-group' },
      h('legend', {}, t('Who can see this person?')),
      h('label', { class: 'check' }, h('input', {
        type: 'radio', name: 'privacy', value: 'family', checked: effectivePrivacy(person) === 'family',
        onchange: () => { person.privacy = 'family'; touch(); },
      }), h('span', {}, h('strong', {}, t('Family only')), ' — ', t('encrypted; visible only with the family password'))),
      h('label', { class: 'check' }, h('input', {
        type: 'radio', name: 'privacy', value: 'public', checked: effectivePrivacy(person) === 'public', disabled: person.living,
        onchange: (e) => {
          if (!confirm(t('Make this person PUBLIC?\n\nAnyone on the internet who finds the site can read a public person. Public information also stays in the archive history permanently, even if you change it back later.'))) {
            e.target.checked = false; privacyBox.querySelector('input[value=family]').checked = true; return;
          }
          person.privacy = 'public'; touch();
        },
      }), h('span', {}, h('strong', {}, t('Public')), ' — ', t('anyone with the link can read it'))),
      person.living && h('p', { class: 'muted small' }, t('Living people are always family-only, to protect their privacy.'))));
  const drawDeath = () => clear(deathBox, person.living ? null : h('div', { class: 'grid-2' },
    dateField(t('Date of death'), () => person.death.date, (v) => { person.death.date = v; }),
    text(t('Place of death'), () => person.death.place, (v) => { person.death.place = v; }, { placeholder: t('Town, country') })));
  drawPrivacy();
  drawDeath();

  // ----- names -----
  const nameBlocks = SCRIPTS.map((sc) => {
    const n = person.names[sc];
    const lang = { latin: 'en', armenian: 'hy', cyrillic: 'ru' }[sc];
    return h('fieldset', { class: 'name-block' },
      h('legend', {}, t(SCRIPT_LABELS[sc])),
      h('div', { class: 'grid-2' },
        text(t('First name'), () => n.first, (v) => { n.first = v; }, { lang }),
        text(t('Last name'), () => n.last, (v) => { n.last = v; }, { lang }),
        text(t('Patronymic (father’s name)'), () => n.patronymic, (v) => { n.patronymic = v; }, { lang }),
        text(t('Maiden name (birth surname)'), () => n.maiden, (v) => { n.maiden = v; }, { lang })));
  });

  // ----- relationships -----
  const relBox = h('div', {});
  const relProblems = h('div', { class: 'form-message', role: 'alert' });
  const addRelative = (role) => (pid, create) => {
    let otherId = pid;
    if (!otherId) {
      const np = newPersonFrom(create);
      newPeople.push(np);
      otherId = np.id;
    }
    if (role === 'parent') draftRels.push({ id: newId('r'), type: 'parent', parent: otherId, child: person.id, kind: 'birth' });
    if (role === 'child') draftRels.push({ id: newId('r'), type: 'parent', parent: person.id, child: otherId, kind: 'birth' });
    if (role === 'spouse') draftRels.push({ id: newId('r'), type: 'spouse', a: person.id, b: otherId });
    touch();
    drawRels();
  };
  const removeRel = (r) => {
    const i = draftRels.indexOf(r);
    if (i >= 0) draftRels.splice(i, 1);
    touch();
    drawRels();
  };
  const relRow = (r, otherId, extra) => h('div', { class: 'rel-row' },
    h('div', { class: 'rel-main' },
      h('span', { class: 'monogram small', 'aria-hidden': 'true' }, initials(lookup(otherId))),
      h('span', {}, h('strong', {}, nameOf(otherId)), ' ', h('span', { class: 'muted small' }, lifespan(lookup(otherId))),
        newPeople.some((p) => p.id === otherId) && h('span', { class: 'badge badge-unsaved' }, t('new')))),
    extra && h('div', { class: 'rel-extra' }, extra),
    h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => removeRel(r) }, t('Remove link')));
  const kindSelect = (r) => h('select', {
    'aria-label': t('Kind of parent'), value: r.kind || 'birth', class: 'compact-select',
    onchange: (e) => { r.kind = e.target.value; touch(); drawRels(); },
  }, PARENT_KINDS.map((k) => h('option', { value: k }, t({ birth: 'birth', adoptive: 'adoptive', step: 'step', foster: 'foster' }[k]))));
  const drawRels = () => {
    const parents = draftRels.filter((r) => r.type === 'parent' && r.child === person.id);
    const children = draftRels.filter((r) => r.type === 'parent' && r.parent === person.id);
    const spouses = draftRels.filter((r) => r.type === 'spouse');
    const linkedIds = [person.id, ...draftRels.flatMap(relPeople)];
    const extra = () => newPeople.map(summarize);
    const problems = store.checkEdit(person, draftRels);
    relProblems.textContent = problems.join(' ');
    clear(relBox,
      h('h3', {}, t('Parents')),
      parents.map((r) => relRow(r, r.parent, kindSelect(r))),
      parents.length < 2 || parents.some((p) => p.kind !== 'birth')
        ? personPicker({ label: t('Add a parent'), excludeIds: linkedIds, extraPeople: extra, onPick: addRelative('parent') }) : null,
      h('h3', {}, t('Spouses and partners')),
      spouses.map((r) => relRow(r, r.a === person.id ? r.b : r.a, h('div', { class: 'grid-2 spouse-extra' },
        dateField(t('Married'), () => r.start, (v) => { r.start = v; }),
        text(t('Place of marriage'), () => r.place, (v) => { r.place = v; }),
        dateField(t('Ended'), () => r.end, (v) => { r.end = v; }),
        select(t('How it ended'), { '': t('—'), death: t('death of a spouse'), divorce: t('divorce'), separation: t('separation') }, () => r.endReason, (v) => { r.endReason = v; })))),
      personPicker({ label: t('Add a spouse or partner'), excludeIds: [person.id], extraPeople: extra, onPick: addRelative('spouse') }),
      h('h3', {}, t('Children')),
      children.map((r) => relRow(r, r.child, kindSelect(r))),
      personPicker({ label: t('Add a child'), excludeIds: linkedIds, extraPeople: extra, onPick: addRelative('child') }),
      h('p', { class: 'muted small' }, t('Brothers, sisters and half-siblings are worked out automatically from parents.')));
  };
  drawRels();

  // ----- keep / cancel / delete -----
  const formMsg = h('p', { class: 'form-message', role: 'alert' });
  const keep = () => {
    const problems = [];
    const hasName = SCRIPTS.some((sc) => person.names[sc].first || person.names[sc].last) || person.nicknames.length;
    if (!hasName && !person.placeholder) problems.push(t('Please enter at least a first or last name, or tick "Unknown person (placeholder)".'));
    if (view.querySelector('.date-preview.bad')) problems.push(t('One of the dates could not be read. Please fix the dates marked with ✗.'));
    problems.push(...store.checkEdit(person, draftRels));
    if (problems.length) { formMsg.textContent = problems.join(' '); formMsg.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    // Drop empty spouse dates etc. so files stay tidy.
    for (const r of draftRels) for (const k of ['start', 'end', 'place', 'endReason']) if (!r[k]) delete r[k];
    store.applyPersonEdit(person, draftRels, newPeople);
    editorDirty = false;
    changed();
    toast(t('Kept. Click "Save & publish" when you are ready (you can make more changes first).'), 'ok');
    location.hash = '#/people';
  };
  const cancel = () => {
    if (editorDirty && !confirm(t('Throw away the edits to this person?'))) return;
    editorDirty = false;
    location.hash = '#/people';
  };
  const remove = () => {
    const links = draftRels.length;
    if (!confirm(t('Delete {name}? {n} family link(s) will also be removed. This takes effect when you click "Save & publish". (Earlier versions stay in the history, so this can be undone later.)', { name: displayName(summarize(person)), n: links }))) return;
    store.deletePerson(person.id);
    editorDirty = false;
    changed();
    location.hash = '#/people';
  };

  const statusChoice = h('div', { class: 'grid-3' },
    h('fieldset', { class: 'radio-group' }, h('legend', {}, t('Status')),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'living', checked: !person.living, onchange: () => { person.living = false; touch(); drawPrivacy(); drawDeath(); } }), t('Deceased')),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'living', checked: person.living, onchange: () => { person.living = true; touch(); drawPrivacy(); drawDeath(); } }), t('Living'))),
    select(t('Sex'), { unknown: t('Unknown'), female: t('Female'), male: t('Male') }, () => person.sex, (v) => { person.sex = v; }),
    h('label', { class: 'check placeholder-check' }, h('input', {
      type: 'checkbox', checked: !!person.placeholder, onchange: (e) => { person.placeholder = e.target.checked; touch(); },
    }), h('span', {}, h('strong', {}, t('Unknown person (placeholder)')), h('br'), h('small', { class: 'muted' }, t('Use for someone who must exist but is not known yet, so the gap is visible.')))));

  clear(view,
    h('nav', { class: 'crumbs' }, h('a', { href: '#/people' }, t('People')), ' / ', isNew ? t('New person') : displayName(summarize(person))),
    h('div', { class: 'admin-title' },
      h('h1', {}, isNew ? t('Add a person') : t('Edit {name}', { name: displayName(summarize(person)) })),
      !isNew && h('a', { class: 'btn btn-quiet btn-small', href: `../#/person/${person.id}`, target: '_blank', rel: 'noopener' }, t('View on site ↗'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Basics')), statusChoice, privacyBox),
    h('section', { class: 'panel' }, h('h2', {}, t('Names')),
      h('p', { class: 'muted small' }, t('Fill in whichever alphabets you know. Leave the rest empty.')),
      nameBlocks,
      listField(t('Nicknames'), () => person.nicknames, (v) => { person.nicknames = v; }, t('Separate several with commas'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Birth and death')),
      h('p', { class: 'muted small' }, DATE_HELP),
      h('div', { class: 'grid-2' },
        dateField(t('Date of birth'), () => person.birth.date, (v) => { person.birth.date = v; }),
        text(t('Place of birth'), () => person.birth.place, (v) => { person.birth.place = v; }, { placeholder: t('Town, country') })),
      deathBox),
    portraitSection(person, touch),
    h('section', { class: 'panel' }, h('h2', {}, t('Family links')), relBox, relProblems),
    h('section', { class: 'panel' }, h('h2', {}, t('Life')),
      h('div', { class: 'grid-2' },
        text(t('Occupation'), () => person.occupation, (v) => { person.occupation = v; }),
        text(t('Education'), () => person.education, (v) => { person.education = v; })),
      listField(t('Languages'), () => person.languages, (v) => { person.languages = v; }, t('Separate with commas, e.g. Armenian, Russian')),
      text(t('Biography'), () => person.bio, (v) => { person.bio = v; }, { multiline: true, rows: 8, hint: t('Leave an empty line between paragraphs.') })),
    repeatable(t('Stories'), person.stories, () => ({ title: '', text: '' }), (st) => h('div', {},
      text(t('Title'), () => st.title, (v) => { st.title = v; }),
      text(t('Story'), () => st.text, (v) => { st.text = v; }, { multiline: true })), t('Add a story')),
    repeatable(t('Life events'), person.events, () => ({ id: newId('e'), type: 'residence' }), (ev) => h('div', { class: 'grid-2' },
      select(t('What happened'), Object.fromEntries(Object.entries(EVENT_TYPES).map(([k, v]) => [k, t(v)])), () => ev.type, (v) => { ev.type = v; }),
      dateField(t('When'), () => ev.date, (v) => { ev.date = v; }),
      text(t('Where'), () => ev.place, (v) => { ev.place = v; }),
      text(t('Details'), () => ev.description, (v) => { ev.description = v; })), t('Add an event')),
    h('p', { class: 'muted small events-note' }, t('Birth, marriages, children and death are added to the timeline automatically.')),
    repeatable(t('Sources'), person.sources, () => ({ id: newId('s'), type: 'memory', confidence: 'medium' }), (src) => h('div', { class: 'grid-2' },
      text(t('Which fact?'), () => src.fact, (v) => { src.fact = v; }, { placeholder: t('e.g. Birth year') }),
      text(t('Source'), () => src.citation, (v) => { src.citation = v; }, { placeholder: t('e.g. Grandma Anna’s memory, 2024') }),
      select(t('Kind of source'), { memory: t('A relative’s memory'), document: t('Document'), photo: t('Photo'), record: t('Official record'), other: t('Other') }, () => src.type, (v) => { src.type = v; }),
      select(t('How sure are we?'), { high: t('high confidence'), medium: t('medium confidence'), low: t('low confidence') }, () => src.confidence, (v) => { src.confidence = v; })), t('Add a source')),
    h('div', { class: 'editor-actions' },
      formMsg,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: keep }, t('Keep these changes')),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, t('Cancel')),
        !isNew && h('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, t('Delete person'))),
      h('p', { class: 'muted small' }, t('"Keep" adds this to your list of changes. Nothing is published until you click "Save & publish" at the top.'))));
}

// =====================================================================
// Photos and documents
// =====================================================================

const blobCache = new BlobCache(300);
const pendingUrls = new WeakMap();

/** URL for a photo in the admin panel (new uploads come from memory). */
function adminImageURL(id, which = 'thumb') {
  const pend = store.pendingPhotos.get(id);
  const bytes = pend?.image ? (which === 'thumb' ? pend.thumb : pend.image) : null;
  if (bytes) {
    if (!pendingUrls.has(bytes)) pendingUrls.set(bytes, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    return Promise.resolve(pendingUrls.get(bytes));
  }
  const prev = store.prevPhotos.get(id);
  if (!prev) return Promise.resolve(null);
  return blobCache.get(mediaPath(prev, prev.privacy, which), () => store.getImageBytes(id, which));
}

const personName = (pid) => (store.people.has(pid) ? displayName(store.people.get(pid)) : t('(removed person)'));

function photoCard(ph) {
  const pending = store.pendingPhotos.has(ph.id);
  const tags = ph.tags || [];
  return h('a', { class: 'photo-card', href: `#/photo/${ph.id}` },
    h('span', { class: 'photo-thumb' }, lazyImage(() => adminImageURL(ph.id, 'thumb'), { alt: photoTitle(ph) })),
    h('span', { class: 'photo-card-text' },
      h('span', { class: 'photo-card-title' }, photoTitle(ph)),
      h('span', { class: 'muted small' }, [formatDate(ph.date), ph.place].filter(Boolean).join(' · ') || ' '),
      h('span', { class: 'badges' },
        h('span', { class: `badge ${ph.privacy === 'public' ? 'badge-public' : 'badge-family'}` }, ph.privacy === 'public' ? t('Public') : t('Family')),
        ph.kind === 'document' && h('span', { class: 'badge' }, t('Document')),
        tags.length ? h('span', { class: 'badge' }, t(tags.length === 1 ? '1 person' : '{n} people', { n: tags.length })) : h('span', { class: 'badge badge-placeholder' }, t('No one tagged')),
        pending && h('span', { class: 'badge badge-unsaved' }, t('Unsaved')))));
}

let photoFilter = 'all';
let photoQuery = '';
let lastBatch = [];
let uploadKind = 'photo';
let photoLimit = 120;

function photosPage() {
  const fileInput = h('input', {
    type: 'file', multiple: true, accept: ACCEPTED, hidden: true,
    onchange: (e) => { handleFiles([...e.target.files]); e.target.value = ''; },
  });
  const progress = h('div', { class: 'upload-progress', role: 'status', 'aria-live': 'polite' });
  const drop = h('div', {
    class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': t('Choose photos to upload'),
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); },
  },
  h('span', { class: 'dropzone-icon', 'aria-hidden': 'true' }, '⇪'),
  h('strong', {}, t('Drag photos or scans here, or click to choose')),
  h('span', { class: 'muted small' }, t('You can pick many at once. Each image is made smaller (about 300 KB) and hidden location data is removed before upload.')),
  h('span', { class: 'muted small' }, t('Keep your full-size originals somewhere safe too — an external drive and a cloud folder.')));

  async function handleFiles(files) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const skipped = files.length - images.length;
    if (!images.length) { toast(t('Those files are not images. PDFs and other files are not supported yet.'), 'error'); return; }
    if (images.length > 40 && !confirm(t('That is {n} images. Up to about 40 at a time works best; bigger batches still work, but saving may pause for a minute now and then while GitHub catches up. Continue?', { n: images.length }))) return;
    const batch = [];
    const errors = [];
    for (let i = 0; i < images.length; i++) {
      clear(progress, h('span', { class: 'spinner' }), ' ', t('Preparing {i} of {n}: {name}', { i: i + 1, n: images.length, name: images[i].name }));
      try {
        const result = await processImage(images[i], { kind: uploadKind });
        batch.push(store.addPhoto({ kind: uploadKind, choice: 'family', originalName: images[i].name }, result));
      } catch (err) {
        errors.push(err.message);
      }
    }
    lastBatch = batch;
    changed();
    photosPage();
    if (batch.length) toast(t('{n} added. Fill in the details below, then click “Save & publish”.', { n: batch.length }), 'ok');
    if (errors.length) alert(errors.join('\n\n'));
    if (skipped) toast(t('{n} file(s) were skipped because they are not images.', { n: skipped }));
  }

  // ----- details shared by the batch just uploaded -----
  const batchIds = lastBatch.filter((id) => store.photos.has(id) && store.pendingPhotos.has(id));
  let batchPanel = null;
  if (batchIds.length) {
    const shared = { date: undefined, place: '', choice: 'family' };
    const fields = fieldKit(() => {});
    batchPanel = h('section', { class: 'panel batch-panel' },
      h('h2', {}, t('You just added {n}. What do they have in common?', { n: batchIds.length })),
      h('p', { class: 'muted small' }, t('Leave a box empty to keep each photo as it is. You can change each one separately afterwards.')),
      h('div', { class: 'grid-2' },
        fields.dateField(t('Approximate date'), () => shared.date, (v) => { shared.date = v; }),
        fields.text(t('Place'), () => shared.place, (v) => { shared.place = v; }, { placeholder: t('Town, country') })),
      privacyChoice('batch-privacy', () => shared.choice, (v) => { shared.choice = v; }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            if (document.querySelector('.batch-panel .date-preview.bad')) { toast(t('Please fix the date first.'), 'error'); return; }
            for (const id of batchIds) {
              const details = await store.getPhotoDetails(id);
              const cur = { ...store.photos.get(id), ...details, choice: shared.choice };
              if (shared.date) cur.date = shared.date;
              if (shared.place.trim()) cur.place = shared.place.trim();
              store.updatePhoto(cur);
            }
            lastBatch = [];
            changed();
            toast(t('Applied. Now click each photo to give it a title and tag the people in it.'), 'ok');
            photosPage();
          },
        }, t('Apply to all {n}', { n: batchIds.length })),
        h('button', { class: 'btn btn-quiet', onclick: () => { lastBatch = []; photosPage(); } }, t('Skip'))));
  }

  // ----- the grid -----
  const filters = {
    all: [t('All'), () => true],
    unsaved: [t('Unsaved'), (p) => store.pendingPhotos.has(p.id)],
    untagged: [t('No one tagged'), (p) => !p.tags?.length],
    family: [t('Family only'), (p) => p.privacy === 'family'],
    public: [t('Public'), (p) => p.privacy === 'public'],
    document: [t('Documents'), (p) => p.kind === 'document'],
  };
  const grid = h('div', { class: 'photo-grid' });
  const more = h('div', {});
  const drawGrid = () => {
    const q = normalizeText(photoQuery).trim();
    const all = [...store.photos.values()];
    let list = all.filter(filters[photoFilter][1]).filter((p) => !q || normalizeText(
      [p.title, p.place, formatDate(p.date), ...(p.tags || []).map((tg) => personName(tg.person))].join(' '),
    ).includes(q));
    // Unsaved first, then oldest to newest.
    const unsaved = list.filter((p) => store.pendingPhotos.has(p.id));
    list = [...unsaved, ...sortPhotos(list.filter((p) => !store.pendingPhotos.has(p.id)))];
    clear(grid, list.slice(0, photoLimit).map(photoCard));
    clear(more, list.length > photoLimit
      ? h('button', { class: 'btn btn-quiet', onclick: () => { photoLimit += 120; drawGrid(); } }, t('Show more ({n} left)', { n: list.length - photoLimit }))
      : null);
    if (!list.length) clear(grid, h('p', { class: 'muted' }, all.length ? t('No photos match.') : t('No photos yet. Add some above.')));
  };
  drawGrid();

  clear(view,
    h('div', { class: 'admin-title' }, h('h1', {}, t('Photos and documents'))),
    h('fieldset', { class: 'radio-group kind-choice' },
      h('legend', {}, t('What are you adding?')),
      Object.entries({ photo: t('Photos'), document: t('Scanned documents (letters, certificates…)') }).map(([k, label]) =>
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'upload-kind', checked: uploadKind === k, onchange: () => { uploadKind = k; } }), label))),
    drop, fileInput, progress,
    batchPanel,
    h('input', {
      type: 'search', class: 'search-input', placeholder: t('Find by title, place, year or person…'), value: photoQuery,
      oninput: debounce((e) => { photoQuery = e.target.value; photoLimit = 120; drawGrid(); }, 100),
    }),
    h('div', { class: 'filter-chips' }, Object.entries(filters).map(([k, [label]]) => h('button', {
      class: `chip-btn${photoFilter === k ? ' on' : ''}`, 'aria-pressed': String(photoFilter === k),
      onclick: () => { photoFilter = k; photoLimit = 120; photosPage(); },
    }, label))),
    h('p', { class: 'muted small' }, t('{n} photos and documents', { n: store.photos.size })),
    grid, more);
}

/** Public / family radio buttons for a photo. */
function privacyChoice(name, get, set) {
  return h('fieldset', { class: 'radio-group' },
    h('legend', {}, t('Who can see it?')),
    h('label', { class: 'check' }, h('input', { type: 'radio', name, checked: get() !== 'public', onchange: () => set('family') }),
      h('span', {}, h('strong', {}, t('Family only')), ' — ', t('encrypted; visible only with the family password'))),
    h('label', { class: 'check' }, h('input', {
      type: 'radio', name, checked: get() === 'public',
      onchange: (e) => {
        if (!confirm(t('Make this PUBLIC?\n\nAnyone who finds the site can see public photos, and they stay in the history permanently. Photos showing living or family-only people stay family-only automatically.'))) {
          e.target.checked = false;
          e.target.closest('fieldset').querySelector('input').checked = true;
          return;
        }
        set('public');
      },
    }), h('span', {}, h('strong', {}, t('Public')), ' — ', t('only if everyone tagged in it is public'))));
}

async function photoEditorPage(id) {
  const original = store.photos.get(id);
  if (!original) { clear(view, h('h1', {}, t('Photo not found')), h('a', { href: '#/photos' }, t('Back to photos'))); return; }
  clear(view, h('p', { class: 'loading' }, t('Loading…')));
  const details = await store.getPhotoDetails(id);
  const draft = { ...structuredClone(original), ...structuredClone(details), tags: structuredClone(original.tags || []) };
  const startText = JSON.stringify(draft);
  let newImage = null; // { image, thumb, w, h } after rotate/replace
  const portraits = new Set(); // people who should get this as profile photo
  currentEditRoute = `photo/${id}`;
  editorDirty = false;
  const touch = () => { editorDirty = true; };
  const { text, select, dateField } = fieldKit(touch);
  const isSaved = store.prevPhotos.has(id);

  // ----- image with name tags -----
  const stage = h('div', { class: 'photo-stage' });
  const tagList = h('div', { class: 'tag-list' });
  const privacyNote = h('p', { class: 'muted small' });
  let imgURL = null;

  const imageURL = async () => {
    if (newImage) {
      if (!pendingUrls.has(newImage.image)) pendingUrls.set(newImage.image, URL.createObjectURL(new Blob([newImage.image], { type: 'image/jpeg' })));
      return pendingUrls.get(newImage.image);
    }
    return adminImageURL(id, 'full');
  };

  const drawStage = async (taggerAt) => {
    imgURL = await imageURL();
    const img = h('img', { class: 'photo-full', src: imgURL, alt: photoTitle(draft), draggable: 'false' });
    const frame = h('div', { class: 'photo-frame tagging' }, img,
      tagLayer(draft.tags, { nameOf: personName, onClickTag: (tag) => { tagList.querySelector(`[data-person="${tag.person}"]`)?.focus(); } }));
    img.addEventListener('click', (e) => drawStage(clickPosition(e, img)));
    if (taggerAt) {
      frame.append(h('span', { class: 'tag tag-new', style: `left:${taggerAt.x * 100}%;top:${taggerAt.y * 100}%` }, h('span', { class: 'tag-dot' })));
      const picker = personPicker({
        label: t('Who is this?'),
        excludeIds: draft.tags.map((tg) => tg.person),
        onPick: (pid, create) => {
          if (!pid) {
            const np = newPersonFrom(create);
            store.applyPersonEdit(np, []);
            changed();
            pid = np.id;
          }
          draft.tags.push({ person: pid, x: taggerAt.x, y: taggerAt.y });
          touch();
          drawStage();
          drawTags();
        },
      });
      const box = h('div', { class: 'tagger', style: `left:${Math.min(Math.max(taggerAt.x * 100, 15), 85)}%;top:${taggerAt.y * 100}%` },
        h('strong', {}, t('Who is this?')), picker,
        h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => drawStage() }, t('Cancel')));
      frame.append(box);
      setTimeout(() => picker.querySelector('input').focus(), 0);
    }
    clear(stage, frame,
      h('p', { class: 'muted small' }, draft.tags.length ? t('Click on another face to tag more people.') : t('Click on a person’s face in the picture to tag them.')));
  };

  const drawTags = () => {
    const eff = effectivePhotoPrivacy(draft, store.people);
    const blockers = draft.tags.filter((tg) => store.people.get(tg.person)?.privacy !== 'public').map((tg) => personName(tg.person));
    privacyNote.textContent = draft.choice === 'public' && eff !== 'public'
      ? t('This photo will stay family-only because it shows: {names}.', { names: blockers.join(', ') }) : '';
    clear(tagList, draft.tags.length ? draft.tags.map((tg) => {
      const isPortrait = store.people.get(tg.person)?.photo === id || portraits.has(tg.person);
      return h('div', { class: 'rel-row', tabindex: '-1', 'data-person': tg.person },
        h('div', { class: 'rel-main' },
          h('span', { class: 'monogram small', 'aria-hidden': 'true' }, initials(store.people.get(tg.person) || {})),
          h('a', { href: `#/person/${tg.person}` }, personName(tg.person))),
        isPortrait
          ? h('span', { class: 'badge badge-public' }, '✓ ', t('Profile photo'))
          : h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => { portraits.add(tg.person); touch(); drawTags(); } }, t('Use as profile photo')),
        h('button', {
          type: 'button', class: 'btn btn-quiet btn-small',
          onclick: () => { draft.tags = draft.tags.filter((x) => x !== tg); portraits.delete(tg.person); touch(); drawStage(); drawTags(); },
        }, t('Remove tag')));
    }) : h('p', { class: 'muted' }, t('No one tagged yet.')));
  };

  // ----- image changes -----
  const confirmReplace = () => {
    if (!isSaved || newImage) return true;
    const size = store.replacedBytes(id);
    return confirm(t('The current image ({size}) stays in the history and keeps using storage. Replace it?', { size: formatBytes(size) }));
  };
  const rotate = async (deg) => {
    if (!confirmReplace()) return;
    const bytes = newImage?.image || await store.getImageBytes(id, 'full');
    newImage = await rotateImage(bytes, deg, draft.kind);
    // Keep name tags on the same faces.
    draft.tags = draft.tags.map((tg) => (deg === 90 ? { ...tg, x: +(1 - tg.y).toFixed(3), y: tg.x } : { ...tg, x: tg.y, y: +(1 - tg.x).toFixed(3) }));
    touch();
    drawStage();
  };
  const replaceInput = h('input', {
    type: 'file', accept: ACCEPTED, hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !confirmReplace()) return;
      try {
        newImage = await processImage(file, { kind: draft.kind });
        touch();
        drawStage();
        toast(t('New image ready. Check the name tags are still on the right faces.'));
      } catch (err) { alert(err.message); }
    },
  });

  const formMsg = h('p', { class: 'form-message', role: 'alert' });
  const keep = () => {
    if (view.querySelector('.date-preview.bad')) { formMsg.textContent = t('The date could not be read. Please fix it.'); return; }
    if (newImage) store.replacePhotoImage(id, newImage);
    if (JSON.stringify(draft) !== startText || newImage) store.updatePhoto(draft);
    for (const pid of portraits) store.setPortrait(pid, id);
    editorDirty = false;
    changed();
    toast(t('Kept. Click "Save & publish" when you are ready.'), 'ok');
    location.hash = '#/photos';
  };
  const cancel = () => {
    if (editorDirty && !confirm(t('Throw away the edits to this photo?'))) return;
    editorDirty = false;
    location.hash = '#/photos';
  };
  const remove = () => {
    const msg = isSaved
      ? t('Delete this photo? It disappears from the site when you Save & publish. (The old file stays in the history, so deleting does not free up storage.)')
      : t('Remove this new photo? It has not been saved yet.');
    if (!confirm(msg)) return;
    store.deletePhoto(id);
    editorDirty = false;
    changed();
    location.hash = '#/photos';
  };
  const download = async () => {
    const a = h('a', { href: await imageURL(), download: `${(draft.title || draft.originalName || id).replace(/[^\w\- ]+/g, '').trim() || id}.jpg` });
    document.body.append(a); a.click(); a.remove();
  };

  clear(view,
    h('nav', { class: 'crumbs' }, h('a', { href: '#/photos' }, t('Photos')), ' / ', photoTitle(draft)),
    h('div', { class: 'admin-title' }, h('h1', {}, photoTitle(draft)),
      isSaved && h('a', { class: 'btn btn-quiet btn-small', href: `../#/photo/${id}`, target: '_blank', rel: 'noopener' }, t('View on site ↗'))),
    h('div', { class: 'photo-editor' },
      h('div', {},
        stage,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => rotate(-90) }, '↺ ', t('Rotate left')),
          h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => rotate(90) }, '↻ ', t('Rotate right')),
          h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => replaceInput.click() }, t('Replace image…')),
          h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: download }, t('Download')),
          replaceInput),
        h('p', { class: 'muted small' }, [
          draft.w && `${draft.w} × ${draft.h} px`, draft.bytes && formatBytes(draft.bytes), draft.originalName && t('from “{name}”', { name: draft.originalName }),
        ].filter(Boolean).join(' · '))),
      h('div', {},
        h('section', { class: 'panel' }, h('h2', {}, t('People in this photo')), tagList),
        h('section', { class: 'panel' }, h('h2', {}, t('About this photo')),
          text(t('Title'), () => draft.title, (v) => { draft.title = v; }, { placeholder: t('e.g. Grandmother’s 50th birthday') }),
          select(t('Kind'), Object.fromEntries(Object.entries(PHOTO_KINDS).map(([k, v]) => [k, t(v)])), () => draft.kind || 'photo', (v) => { draft.kind = v; }),
          h('div', { class: 'grid-2' },
            dateField(t('Approximate date'), () => draft.date, (v) => { draft.date = v; }),
            text(t('Place'), () => draft.place, (v) => { draft.place = v; }, { placeholder: t('Town, country') })),
          text(t('Description'), () => draft.description, (v) => { draft.description = v; }, { multiline: true, rows: 3, placeholder: t('Who, what, where — what you see in the picture') }),
          text(t('The story behind it'), () => draft.story, (v) => { draft.story = v; }, { multiline: true, rows: 6 })),
        h('section', { class: 'panel' }, h('h2', {}, t('Privacy')),
          privacyChoice('photo-privacy', () => draft.choice, (v) => { draft.choice = v; touch(); drawTags(); }),
          privacyNote))),
    h('div', { class: 'editor-actions' },
      formMsg,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: keep }, t('Keep these changes')),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: cancel }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, isSaved ? t('Delete photo') : t('Remove'))),
      h('p', { class: 'muted small' }, t('"Keep" adds this to your list of changes. Nothing is published until you click "Save & publish" at the top.'))));
  drawStage();
  drawTags();
}

/** On a person's page in the admin: choose their profile photo. */
function portraitSection(person, touch) {
  const photos = sortPhotos(store.photosOf(person.id));
  const box = h('div', { class: 'portrait-choices' });
  const draw = () => clear(box,
    h('label', { class: `portrait-choice none${!person.photo ? ' on' : ''}` },
      h('input', { type: 'radio', name: 'portrait', checked: !person.photo, onchange: () => { delete person.photo; touch(); draw(); } }),
      h('span', { class: 'portrait-none' }, initials(summarize(person))), h('span', { class: 'small' }, t('No photo'))),
    photos.map((ph) => {
      const tag = ph.tags.find((tg) => tg.person === person.id);
      const img = lazyImage(() => adminImageURL(ph.id, 'thumb'), { alt: photoTitle(ph) });
      img.style.objectPosition = `${tag.x * 100}% ${tag.y * 100}%`;
      return h('label', { class: `portrait-choice${person.photo === ph.id ? ' on' : ''}` },
        h('input', { type: 'radio', name: 'portrait', checked: person.photo === ph.id, onchange: () => { person.photo = ph.id; touch(); draw(); } }),
        img, h('span', { class: 'small' }, photoTitle(ph)));
    }));
  draw();
  return h('section', { class: 'panel' }, h('h2', {}, t('Photos')),
    photos.length
      ? [h('p', { class: 'muted small' }, t('Photos this person is tagged in. Choose one as their profile photo:')), box]
      : h('p', { class: 'muted' }, t('No photos of this person yet. In '), h('a', { href: '#/photos' }, t('Photos')), t(', open a photo and click on their face to tag them.')));
}

// =====================================================================
// Settings
// =====================================================================

function settingsPage() {
  const title = h('input', { type: 'text', value: store.config.siteTitle || '' });
  const email = h('input', { type: 'email', value: store.familySettings.correctionEmail || '', placeholder: 'name@example.com' });
  const pw1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const full = h('input', { type: 'checkbox' });
  const pwMsg = h('p', { class: 'form-message', role: 'alert' });

  clear(view,
    h('h1', {}, t('Settings')),
    h('section', { class: 'panel' }, h('h2', {}, t('Site')),
      h('label', { class: 'field' }, h('span', {}, t('Archive title (public)')), title),
      h('button', {
        class: 'btn', onclick: () => {
          if (title.value.trim() === (store.config.siteTitle || '')) return;
          store.setConfig({ siteTitle: title.value.trim() }); changed(); toast(t('Kept. Remember to Save & publish.'));
        },
      }, t('Keep'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Corrections from relatives')),
      h('p', {}, t('Each profile gets a "Suggest a correction" button that opens an email to this address. It is shown only to visitors who entered the family password, and it is stored encrypted.')),
      h('label', { class: 'field' }, h('span', {}, t('Your email address')), email),
      h('button', {
        class: 'btn', onclick: () => {
          if (email.value.trim() === (store.familySettings.correctionEmail || '')) return;
          store.setFamilySettings({ correctionEmail: email.value.trim() }); changed(); toast(t('Kept. Remember to Save & publish.'));
        },
      }, t('Keep'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Family password')),
      h('p', {}, t('Change the password relatives use to see family-only information. Tell them the new one afterwards.')),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', {}, t('New family password')), pw1),
        h('label', { class: 'field' }, h('span', {}, t('Type it again')), pw2)),
      h('label', { class: 'check' }, full, h('span', {}, h('strong', {}, t('Full re-lock')), ' — ',
        t('only needed if you think the OLD password reached someone who should not have it. It re-encrypts every family file, which uses extra storage (later, with photos, a lot).'))),
      pwMsg,
      h('button', {
        class: 'btn btn-primary', onclick: async (e) => {
          if (pw1.value.length < 10) { pwMsg.textContent = t('Please use at least 10 characters.'); return; }
          if (pw1.value !== pw2.value) { pwMsg.textContent = t('The two passwords are different.'); return; }
          if (store.pendingCount) { pwMsg.textContent = t('Save or discard your other changes first.'); return; }
          if (!confirm(t('Change the family password now? Everyone will need the new password.'))) return;
          e.target.disabled = true;
          pwMsg.textContent = t('Changing the password… please keep this page open.');
          try {
            const result = await store.changePassword(pw1.value, { full: full.checked });
            safeStorage.set('localStorage', FAMILY_KEY, await exportKey(store.key));
            pwMsg.textContent = '';
            pw1.value = ''; pw2.value = '';
            toast(t('Family password changed.'), 'ok');
            publishState = { state: 'publishing', sha: result.sha };
            renderSavebar();
            watchPublish(result.sha);
          } catch (err) {
            pwMsg.textContent = t('Could not change the password: {msg}', { msg: err.message });
          } finally {
            e.target.disabled = false;
          }
        },
      }, t('Change family password'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Storage')), storageMeter() || h('p', { class: 'muted' }, t('Not available right now.'))),
    h('section', { class: 'panel' }, h('h2', {}, t('This device')),
      h('p', {}, t('Use this on a shared or borrowed computer when you are done: it removes your GitHub token and the family key from this browser.')),
      h('button', {
        class: 'btn btn-danger', onclick: () => {
          if (store.pendingCount && !confirm(t('You have unsaved changes. Sign out anyway and lose them?'))) return;
          safeStorage.remove('localStorage', TOKEN_KEY);
          safeStorage.remove('localStorage', FAMILY_KEY);
          safeStorage.remove('sessionStorage', FAMILY_KEY);
          store.ops = [];
          location.href = '../';
        },
      }, t('Sign out of this device'))));
}

// =====================================================================
// Help
// =====================================================================

function helpPage() {
  const item = (q, ...a) => h('details', { class: 'help-box' }, h('summary', {}, q), ...a);
  clear(view,
    h('h1', {}, t('Help')),
    item(t('How does saving work?'),
      h('p', {}, t('1. Edit a person and click "Keep these changes". 2. Make as many edits as you like. 3. Click "Save & publish" at the top. All your edits are saved together, then the site updates itself in about a minute.'))),
    item(t('What does "Saved, but the site was not updated" mean?'),
      h('p', {}, t('Your changes ARE safely saved. Before every update, automatic safety checks run; if one fails, the site keeps showing the previous version instead of a broken one. Usually this means something in the site’s code needs fixing, not your data. Open the "Actions" tab of the repository on GitHub to see which check failed, and ask for help.'))),
    item(t('Public or family-only?'),
      h('p', {}, t('Family-only people are encrypted with the family password before they leave your computer. Public people can be read by anyone with the link, and anything that was ever public stays in the history. Living people are always family-only. When unsure, choose family-only.'))),
    item(t('Adding photos'),
      h('p', {}, t('Go to Photos, drag pictures onto the dotted box, then click "Save & publish". Up to about 40 at a time works best. Click a photo to give it a title and date, and click on faces to tag people. Photos showing living or family-only people always stay family-only.'))),
    item(t('Running out of space'),
      h('p', {}, t('GitHub suggests keeping the archive under about 1 GB. Old versions of changed files are kept forever in the history, so replacing big files uses extra space. Keep your full-resolution originals elsewhere (an external drive and a cloud folder); the archive keeps smaller copies.'))),
    item(t('My token expired or stopped working'),
      h('p', {}, t('Make a new token (the steps are below) and paste it when the admin panel asks.')), tokenHelp()),
    item(t('I forgot the family password'),
      h('p', {}, t('If you are still signed in on a device with "Remember" ticked, go to Settings and set a new password there. Otherwise family-only information cannot be recovered — that is what keeps it private.'))),
    h('p', {}, h('a', { href: 'https://github.com/' + (store.repo.owner ? `${store.repo.owner}/${store.repo.repo}#readme` : ''), target: '_blank', rel: 'noopener' }, t('Read the full guide (README) ↗'))));
}

start().catch((err) => {
  console.error(err);
  clear(view, h('div', { class: 'panel' }, h('h1', {}, t('Something went wrong')), h('p', {}, err.message)));
});
