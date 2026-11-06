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
import {
  searchPlaces, placeText, placeLabel, hasCoords, allPlaceNames, countryAt, MOVE_REASONS,
} from './lib/places.js';
import { loadLeaflet, baseTiles, geocode } from './lib/leaflet.js';
import { buildBackup, gatherPeople } from './lib/backup.js';
import { suggestName } from './lib/transliterate.js';
import { exportGedcom, importGedcom } from './lib/gedcom.js';
import { parseDate, formatDate, DATE_HELP, sortKey as sortKeyOf } from './lib/dates.js';
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
        if (!(await repo.canWrite())) {
          clear(msg, tokenWriteFix());
          return;
        }
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

const TOKEN_EDIT_URL = 'https://github.com/settings/personal-access-tokens';

/** The fix when a token can read the archive but not save to it. */
function tokenWriteFix() {
  return h('div', { class: 'notice notice-warn token-fix' },
    h('p', {}, h('strong', {}, t('This token can read the archive but is not allowed to save changes.')), ' ',
      t('Usually “Repository access” was left on “Public repositories”, which only allows reading. You can fix the same token — no need to make a new one:')),
    h('ol', {},
      h('li', {}, t('Open '), h('a', { href: TOKEN_EDIT_URL, target: '_blank', rel: 'noopener' }, t('your fine-grained tokens on GitHub')), t(' and click the token’s name, then “Edit”.')),
      h('li', {}, t('Repository access: choose “Only select repositories” and pick '), h('strong', {}, store?.repo?.repo || 'family-archive'), '.'),
      h('li', {}, t('Repository permissions: set “Contents” to “Read and write” and “Actions” to “Read-only”.')),
      h('li', {}, t('Click “Update”, come back here and try again.'))));
}

/** Turn GitHub's technical errors into something useful. */
function friendlyError(err) {
  if (err?.status === 403 && /not accessible|permission|forbidden/i.test(err.message)) return tokenWriteFix();
  if (err?.status === 401) return h('p', {}, t('GitHub did not accept your token (it may have expired). Go to Settings → “Sign out of this device”, then paste a new token.'));
  return h('p', {}, err?.message || String(err));
}

function tokenHelp() {
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const prefill = `https://github.com/settings/personal-access-tokens/new?name=Family+archive+admin&description=Lets+the+family+archive+admin+panel+save+changes&expires_in=366${owner ? `&target_name=${owner}` : ''}&contents=write&actions=read`;
  return h('details', { class: 'help-box' },
    h('summary', {}, t('How do I get a token? (step by step)')),
    h('ol', {},
      h('li', {}, t('Open '), h('a', { href: prefill, target: '_blank', rel: 'noopener' }, t('GitHub → New fine-grained token')), t(' (sign in if asked).')),
      h('li', {}, t('Token name: "Family archive admin". Expiration: 1 year (put a reminder in your calendar to make a new one).')),
      h('li', {}, h('strong', {}, t('Important — Repository access: choose "Only select repositories" and pick ')), h('strong', {}, 'family-archive'), '. ', t('(The default, "Public repositories", can only read and will not be able to save.)')),
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
  // A saved token that can only read would fail on the first save: explain now.
  if (!PRACTICE) {
    let writable = true;
    try { writable = await repo.canWrite(); } catch { writable = true; }
    if (!writable) {
      return clear(view, h('div', { class: 'panel narrow' },
        h('h1', {}, t('One setting to fix on GitHub')),
        tokenWriteFix(),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary', onclick: () => openStore(repo) }, t('I fixed it — try again')),
          h('button', {
            class: 'btn btn-quiet',
            onclick: () => { safeStorage.remove('localStorage', TOKEN_KEY); tokenScreen(); },
          }, t('Use a different token')))));
    }
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
      } catch (err) {
        // Nothing was saved: start again cleanly once the problem is fixed.
        store.config.crypto = undefined;
        store.key = null;
        store.clearPending();
        clear(msg, friendlyError(err));
      }
    },
  },
  h('h1', {}, t('Choose a family password')),
  h('p', {}, t('This password locks all family-only information. Share it only with relatives. Tip: a few random words are easy to remember and hard to guess, e.g. "plum garden violin 72".')),
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
    'publish-failed': h('span', { class: 'status status-bad' }, '⚠ ', t('Saved, but GitHub’s publishing service was too slow this time. Your changes are safe; they will appear with your next save, or ask for help.')),
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
    for (const el of banners.querySelectorAll('.save-error')) el.remove();
    if (!result) { publishState = { state: 'idle' }; renderSavebar(); return; }
    publishState = { state: 'publishing', sha: result.sha };
    renderSavebar();
    toast(t('Saved to GitHub. The site will update in about a minute.'), 'ok');
    watchPublish(result.sha);
    if (!editorDirty) route();
  } catch (err) {
    publishState = { state: 'error', message: t('Saving failed — your changes are still here. See the message below.') };
    renderSavebar();
    for (const el of banners.querySelectorAll('.save-error')) el.remove();
    banners.append(h('div', { class: 'save-error' }, friendlyError(err)));
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
    } else if (s === 'failed' || s === 'publish-failed') {
      publishState = { state: s };
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
  for (const el of banners.querySelectorAll('.storage-warn, .backup-reminder')) el.remove();
  const last = safeStorage.get('localStorage', scopedKey('lastBackup'));
  const days = last ? (Date.now() - Date.parse(last)) / 86_400_000 : Infinity;
  if (store && store.people.size >= 15 && days > 90) {
    banners.append(h('div', { class: 'notice backup-reminder' },
      h('p', {}, last ? t('Your last full backup on this device was {n} days ago.', { n: Math.round(days) }) : t('You haven’t downloaded a full backup on this device yet.')),
      h('a', { class: 'btn btn-small', href: '#/backup' }, t('Make a backup'))));
  }
  if (storageKB != null && storageKB / STORAGE_LIMIT_KB >= 0.7) {
    banners.append(h('div', { class: 'notice notice-warn storage-warn' },
      h('p', {}, t('Storage is over 70% full. Before adding many more photos, read "Running out of space" in the Help page.'))));
  }
}

// =====================================================================
// Router
// =====================================================================

async function route() {
  const [path, query = ''] = (location.hash || '#/people').split('?');
  const [, page, id] = path.split('/');
  const params = new URLSearchParams(query);
  if (editorDirty && `${page}/${id}` !== currentEditRoute) {
    if (!confirm(t('Leave without keeping your edits?'))) {
      history.replaceState(null, '', `#/${currentEditRoute}`);
      return;
    }
    editorDirty = false;
  }
  const section = { person: 'people', new: 'people', photo: 'photos', place: 'places', move: 'moves' }[page] || page || 'people';
  if (page !== 'history') historyPageNo = 1;
  document.querySelectorAll('#admin-nav a[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === section));
  document.querySelector('#admin-nav a.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  if (page === 'person' && id) await editorPage(decodeURIComponent(id));
  else if (page === 'photos') photosPage();
  else if (page === 'photo' && id) await photoEditorPage(decodeURIComponent(id));
  else if (page === 'places') placesPage();
  else if (page === 'place' && id) await placeEditorPage(decodeURIComponent(id));
  else if (page === 'moves') movesPage();
  else if (page === 'history') await historyPage();
  else if (page === 'backup') backupPage();
  else if (page === 'move' && id) moveEditorPage(decodeURIComponent(id), params);
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

  /**
   * A place: pick a saved place (searchable by old names too), save a new one, or keep plain text.
   * obj gets { place: text, placeId } (or, with idKey and no textKey, only an id).
   */
  const placeField = (label, obj, { idKey = 'placeId', textKey = 'place', requireSaved = false, hint } = {}) => {
    const current = () => {
      const saved = obj[idKey] && store.places.get(obj[idKey]);
      return saved ? saved.name : (textKey ? obj[textKey] || '' : '');
    };
    const input = h('input', { type: 'text', value: current(), autocomplete: 'off', placeholder: t('Start typing a town or village…') });
    const list = h('ul', { class: 'picker-list', role: 'listbox', hidden: true });
    const status = h('small', { class: 'place-status' });
    let items = [];
    let active = 0;
    const showStatus = () => {
      const saved = obj[idKey] && store.places.get(obj[idKey]);
      if (saved) {
        const c = countryAt(saved);
        status.className = 'place-status ok';
        status.textContent = `📍 ${[saved.name, c].filter(Boolean).join(', ')} — ${hasCoords(saved) ? t('saved place, shown on the map') : t('saved place without a map location yet (add it under Places)')}`;
      } else if (textKey && obj[textKey]) {
        status.className = 'place-status';
        status.textContent = t('Plain text only. Pick or save it as a place to show it on the map.');
      } else {
        status.className = 'place-status';
        status.textContent = requireSaved ? t('Choose a saved place, or type a name and save it as a new place.') : '';
      }
    };
    const link = (id) => {
      const pl = store.places.get(id);
      obj[idKey] = id;
      if (textKey) obj[textKey] = pl.name;
      input.value = pl.name;
      list.hidden = true;
      touch();
      showStatus();
    };
    const choose = (i) => items[i]?.action();
    const render = () => {
      const q = input.value.trim();
      if (!q) { list.hidden = true; return; }
      const found = searchPlaces(store.places, q, 6);
      items = found.map((pl) => {
        const older = allPlaceNames(pl).filter((n) => n !== pl.name);
        return {
          label: [h('strong', {}, pl.name), h('span', { class: 'muted small' },
            [older.length ? ` (${older.join(', ')})` : '', countryAt(pl) ? ` · ${countryAt(pl)}` : '', hasCoords(pl) ? '' : ` · ${t('no map location')}`].join(''))],
          action: () => link(pl.id),
        };
      });
      if (!found.some((pl) => allPlaceNames(pl).some((n) => n.toLowerCase() === q.toLowerCase()))) {
        items.push({
          label: [h('strong', {}, '+ '), t('Save “{q}” as a new place', { q })],
          action: () => { const id = store.savePlace({ name: q }); changed(); link(id); toast(t('Place saved. Add its map location later under Places.')); },
        });
      }
      if (textKey && !requireSaved) {
        items.push({ label: [h('strong', {}, '✎ '), t('Keep “{q}” as plain text', { q })], action: () => { list.hidden = true; } });
      }
      active = 0;
      clear(list, items.map((it, i) => h('li', {
        role: 'option', class: i === active ? 'active' : '',
        onmousedown: (e) => { e.preventDefault(); choose(i); },
      }, it.label)));
      list.hidden = false;
    };
    input.addEventListener('input', () => {
      delete obj[idKey];
      if (textKey) obj[textKey] = input.value;
      touch();
      showStatus();
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
      } else if (e.key === 'Enter') { e.preventDefault(); choose(active); } else if (e.key === 'Escape') list.hidden = true;
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    showStatus();
    return h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'picker' }, input, list), status, hint && h('small', { class: 'muted' }, hint));
  };

  return { text, select, dateField, listField, placeField };
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

  const { text, select, dateField, listField, placeField } = fieldKit(touch);

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
    placeField(t('Place of death'), person.death)));
  drawPrivacy();
  drawDeath();

  // ----- names -----
  // Names: typing in English fills in Armenian and Russian when fairly sure,
  // otherwise offers guesses to click. Anything you type yourself is never overwritten.
  const NAME_PARTS_UI = [
    ['first', t('First name')], ['last', t('Last name')],
    ['patronymic', t('Patronymic (father’s name)')], ['maiden', t('Maiden name (birth surname)')],
  ];
  const nameInputs = {};
  const autoFilled = new Set();
  const setName = (sc, part, value, auto) => {
    const key = `${sc}.${part}`;
    person.names[sc][part] = value;
    nameInputs[key].input.value = value;
    if (auto) autoFilled.add(key); else autoFilled.delete(key);
    touch();
  };
  const showHint = (sc, part, auto, options) => {
    const key = `${sc}.${part}`;
    const { hint } = nameInputs[key];
    const chip = (text) => h('button', {
      type: 'button', class: 'guess-chip', lang: sc === 'armenian' ? 'hy' : 'ru',
      onclick: () => { setName(sc, part, text, false); clear(hint); },
    }, text);
    if (auto) {
      clear(hint, h('span', { class: 'muted small' }, '✓ ', t('Filled in automatically — please check.')),
        options.length ? [' ', h('span', { class: 'muted small' }, t('Or:')), ' ', options.map(chip)] : null);
    } else if (options.length) {
      clear(hint, h('span', { class: 'muted small' }, t('Guesses — click one:')), ' ', options.map(chip));
    } else clear(hint);
  };
  const suggestFrom = (part, { fill = true } = {}) => {
    const latin = person.names.latin[part] || '';
    for (const sc of ['armenian', 'cyrillic']) {
      const key = `${sc}.${part}`;
      const current = person.names[sc][part] || '';
      if (current && !autoFilled.has(key)) { clear(nameInputs[key].hint); continue; } // your own text: leave it
      if (!latin.trim()) {
        if (autoFilled.has(key)) setName(sc, part, '', false);
        clear(nameInputs[key].hint);
        continue;
      }
      const { auto, options } = suggestName(latin, sc, part, { sex: person.sex });
      if (!fill) { showHint(sc, part, null, [auto, ...options].filter(Boolean)); continue; }
      if (auto) setName(sc, part, auto, true);
      else if (autoFilled.has(key)) setName(sc, part, '', false);
      showHint(sc, part, auto, options);
    }
  };
  const suggestSoon = Object.fromEntries(NAME_PARTS_UI.map(([part]) => [part, debounce(() => suggestFrom(part), 300)]));
  const nameBlocks = SCRIPTS.map((sc) => {
    const n = person.names[sc];
    const lang = { latin: 'en', armenian: 'hy', cyrillic: 'ru' }[sc];
    return h('fieldset', { class: 'name-block' },
      h('legend', {}, t(SCRIPT_LABELS[sc])),
      sc === 'latin' ? h('p', { class: 'muted small name-tip' }, t('Type the names in English first: the Armenian and Russian boxes below fill in by themselves, or show guesses to choose from.')) : null,
      h('div', { class: 'grid-2' }, NAME_PARTS_UI.map(([part, label]) => {
        const key = `${sc}.${part}`;
        const input = h('input', {
          type: 'text', value: n[part] || '', lang,
          oninput: (e) => {
            n[part] = e.target.value;
            touch();
            if (sc === 'latin') suggestSoon[part]();
            else { autoFilled.delete(key); clear(nameInputs[key].hint); }
          },
        });
        const hint = h('div', { class: 'name-hint' });
        nameInputs[key] = { input, hint };
        return h('label', { class: 'field' }, h('span', {}, label), input, hint);
      })));
  });
  // Show guesses for empty boxes when opening someone already typed in English.
  queueMicrotask(() => { for (const [part] of NAME_PARTS_UI) if (person.names.latin[part]) suggestFrom(part, { fill: false }); });

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
        placeField(t('Place of marriage'), r),
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
    for (const r of draftRels) for (const k of ['start', 'end', 'place', 'placeId', 'endReason']) if (!r[k]) delete r[k];
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
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'living', checked: person.living, onchange: () => { person.living = true; touch(); drawPrivacy(); drawDeath(); } }), t('Living')),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'living', checked: !person.living, onchange: () => { person.living = false; touch(); drawPrivacy(); drawDeath(); } }), t('Deceased'))),
    select(t('Sex'), { unknown: t('Unknown'), female: t('Female'), male: t('Male') }, () => person.sex, (v) => { person.sex = v; suggestFrom('patronymic'); }),
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
        placeField(t('Place of birth'), person.birth)),
      deathBox),
    portraitSection(person, touch),
    h('section', { class: 'panel' }, h('h2', {}, t('Family links')), relBox, relProblems),
    personMovesSection(person, isNew),
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
      placeField(t('Where'), ev),
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
      h('span', { class: 'muted small' }, [formatDate(ph.date), placeText(ph, store.places, ph.date)].filter(Boolean).join(' · ') || ' '),
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
        fields.placeField(t('Place'), shared)),
      privacyChoice('batch-privacy', () => shared.choice, (v) => { shared.choice = v; }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            if (document.querySelector('.batch-panel .date-preview.bad')) { toast(t('Please fix the date first.'), 'error'); return; }
            for (const id of batchIds) {
              const details = await store.getPhotoDetails(id);
              const cur = { ...store.photos.get(id), ...details, choice: shared.choice };
              if (shared.date) cur.date = shared.date;
              if (shared.place?.trim()) {
                cur.place = shared.place.trim();
                if (shared.placeId) cur.placeId = shared.placeId; else delete cur.placeId;
              }
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
  const { text, select, dateField, placeField } = fieldKit(touch);
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
            placeField(t('Place'), draft)),
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
// Places
// =====================================================================

let placeQuery = '';
let placeFilter = 'all';

function placesPage() {
  const list = h('div', { class: 'admin-list' });
  const usageCount = (id) => {
    const u = store.placeUsage(id);
    return u.people.length + u.moves.length + u.photos.length + u.rels.length;
  };
  const filters = {
    all: [t('All'), () => true],
    nomap: [t('No map location'), (pl) => !hasCoords(pl)],
    unused: [t('Not used'), (pl) => usageCount(pl.id) === 0],
  };
  const draw = () => {
    const all = [...store.places.values()];
    const items = (placeQuery.trim() ? searchPlaces(all, placeQuery, 1000) : all.sort((a, b) => a.name.localeCompare(b.name)))
      .filter(filters[placeFilter][1]);
    clear(list, items.length ? items.map((pl) => {
      const n = usageCount(pl.id);
      const older = allPlaceNames(pl).filter((x) => x !== pl.name);
      return h('a', { class: 'admin-row', href: `#/place/${pl.id}` },
        h('span', { class: 'place-pin', 'aria-hidden': 'true' }, hasCoords(pl) ? '📍' : '❔'),
        h('span', { class: 'admin-row-main' },
          h('strong', {}, pl.name, older.length ? h('span', { class: 'muted' }, ` (${older.join(', ')})`) : null),
          h('span', { class: 'muted small' }, [countryAt(pl), t(n === 1 ? 'used once' : 'used {n} times', { n })].filter(Boolean).join(' · '))),
        h('span', { class: 'badges' },
          !hasCoords(pl) && h('span', { class: 'badge badge-unsaved' }, t('No map location'))));
    }) : h('p', { class: 'muted' }, all.length ? t('No places match.') : t('No places yet.')));
  };
  draw();
  const missing = [...store.places.values()].filter((pl) => !hasCoords(pl)).length;
  clear(view,
    h('div', { class: 'admin-title' }, h('h1', {}, t('Places')),
      h('a', { class: 'btn btn-primary', href: '#/place/new' }, '+ ', t('Add a place'))),
    h('p', { class: 'muted' }, t('Each town or village is saved once and reused everywhere: births, deaths, moves, photos. A place can have older names and belong to different countries over time.')),
    missing ? h('div', { class: 'notice' }, h('p', {}, t('{n} place(s) have no map location yet, so they can’t appear on the map. Open them to add one.', { n: missing }))) : null,
    h('input', {
      type: 'search', class: 'search-input', placeholder: t('Find a place (old names work too)…'), value: placeQuery,
      oninput: debounce((e) => { placeQuery = e.target.value; draw(); }, 80),
    }),
    h('div', { class: 'filter-chips' }, Object.entries(filters).map(([k, [label]]) => h('button', {
      class: `chip-btn${placeFilter === k ? ' on' : ''}`, onclick: () => { placeFilter = k; placesPage(); },
    }, label))),
    list);
}

async function placeEditorPage(id) {
  const isNew = id === 'new' || !store.places.has(id);
  if (!isNew && !store.places.has(id)) { clear(view, h('h1', {}, t('Place not found'))); return; }
  const draft = isNew ? { name: '', names: [], countries: [] } : structuredClone(store.places.get(id));
  draft.names ||= [];
  draft.countries ||= [];
  currentEditRoute = `place/${id}`;
  editorDirty = false;
  const touch = () => { editorDirty = true; };
  const { text } = fieldKit(touch);
  const msg = h('p', { class: 'form-message', role: 'alert' });

  // ----- map: search, click or drag to set the location -----
  const mapBox = h('div', { class: 'place-map' });
  const coordText = h('p', { class: 'muted small' });
  const results = h('div', { class: 'geo-results' });
  const search = h('input', { type: 'search', placeholder: t('Search the world map, e.g. “Kars, Turkey”'), value: draft.name || '' });
  let map;
  let marker;
  const showCoords = () => {
    coordText.textContent = hasCoords(draft)
      ? t('Map location: {lat}, {lng}. Drag the pin or click the map to adjust.', { lat: draft.lat.toFixed(4), lng: draft.lng.toFixed(4) })
      : t('No map location yet. Search above, or click on the map.');
  };
  const setPoint = (lat, lng, zoom) => {
    draft.lat = lat; draft.lng = lng;
    touch();
    if (marker) marker.setLatLng([lat, lng]);
    else {
      marker = globalThis.L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => { const ll = marker.getLatLng(); draft.lat = ll.lat; draft.lng = ll.lng; touch(); showCoords(); });
    }
    if (zoom) map.setView([lat, lng], zoom);
    showCoords();
  };
  const runSearch = async () => {
    const q = search.value.trim();
    if (!q) return;
    clear(results, h('p', { class: 'muted small' }, t('Searching…')));
    try {
      const found = await geocode(q);
      clear(results, found.length ? found.map((r) => h('button', {
        type: 'button', class: 'geo-result',
        onclick: () => {
          setPoint(r.lat, r.lng, 11);
          if (!draft.name.trim()) { draft.name = r.name; nameInput.value = r.name; }
          if (r.country && !draft.countries.length) { draft.countries.push({ country: r.country }); drawCountries(); }
          clear(results);
        },
      }, r.label)) : h('p', { class: 'muted small' }, t('Nothing found. Try another spelling, or click on the map.')));
    } catch (err) {
      clear(results, h('p', { class: 'form-message' }, err.message));
    }
  };
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });

  // ----- older names and countries over time -----
  const yearInput = (obj, key, placeholder) => h('input', {
    type: 'number', inputmode: 'numeric', min: '100', max: '2200', placeholder, value: obj[key] ?? '', class: 'year-input',
    oninput: (e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) obj[key] = v; else delete obj[key]; touch(); },
  });
  const periodRows = (arr, key, label, ph) => {
    const box = h('div', { class: 'period-rows' });
    const draw = () => clear(box,
      arr.map((row, i) => h('div', { class: 'period-row' },
        h('input', { type: 'text', value: row[key] || '', placeholder: ph, 'aria-label': label, oninput: (e) => { row[key] = e.target.value; touch(); } }),
        h('span', { class: 'muted small' }, t('from')), yearInput(row, 'from', t('year')),
        h('span', { class: 'muted small' }, t('to')), yearInput(row, 'to', t('year')),
        h('button', { type: 'button', class: 'btn btn-quiet btn-small', 'aria-label': t('Remove'), onclick: () => { arr.splice(i, 1); touch(); draw(); } }, '✕'))),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => { arr.push({}); touch(); draw(); } }, '+ ', t('Add')));
    draw();
    return { box, draw };
  };
  const namesRows = periodRows(draft.names, 'name', t('Older name'), t('e.g. Alexandropol'));
  const countryRows = periodRows(draft.countries, 'country', t('Country'), t('e.g. Russian Empire'));
  const drawCountries = countryRows.draw;
  const nameInput = h('input', { type: 'text', value: draft.name, placeholder: t('Today’s name, e.g. Gyumri'), oninput: (e) => { draft.name = e.target.value; touch(); } });

  const usage = isNew ? null : store.placeUsage(id);
  const keep = () => {
    if (!draft.name.trim()) { msg.textContent = t('Please give the place a name.'); return; }
    draft.names = draft.names.filter((n) => n.name?.trim());
    draft.countries = draft.countries.filter((c) => c.country?.trim());
    const savedId = store.savePlace(isNew ? { ...draft, id: undefined } : draft);
    editorDirty = false;
    changed();
    toast(t('Kept. Click "Save & publish" when you are ready.'), 'ok');
    location.hash = '#/places';
    return savedId;
  };
  const remove = () => {
    try {
      const n = usage.people.length + usage.photos.length + usage.rels.length;
      if (!confirm(n
        ? t('Delete this place? {n} people/photos mention it; they will keep the name as plain text and disappear from the map.', { n })
        : t('Delete this place?'))) return;
      store.deletePlace(id);
      editorDirty = false;
      changed();
      location.hash = '#/places';
    } catch (err) { msg.textContent = err.message; }
  };

  clear(view,
    h('nav', { class: 'crumbs' }, h('a', { href: '#/places' }, t('Places')), ' / ', isNew ? t('New place') : draft.name),
    h('h1', {}, isNew ? t('Add a place') : draft.name),
    h('section', { class: 'panel' }, h('h2', {}, t('Name')),
      h('label', { class: 'field' }, h('span', {}, t('Name used today')), nameInput)),
    h('section', { class: 'panel' }, h('h2', {}, t('Where is it?')),
      h('div', { class: 'geo-search' }, search, h('button', { type: 'button', class: 'btn', onclick: runSearch }, t('Search'))),
      results, mapBox, coordText,
      h('p', { class: 'muted small' }, t('Search uses OpenStreetMap. For villages that no longer exist, zoom in and click roughly where it was.'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Older names')),
      h('p', { class: 'muted small' }, t('Names it had in the past, with the years they were used (leave a year empty if unsure). The site shows the right name for each date.')),
      namesRows.box),
    h('section', { class: 'panel' }, h('h2', {}, t('Country over time')),
      h('p', { class: 'muted small' }, t('Which country (or empire) it belonged to, and when. Leave "to" empty for today.')),
      countryRows.box),
    h('section', { class: 'panel' }, h('h2', {}, t('Notes')),
      text(t('Notes about this place'), () => draft.note, (v) => { draft.note = v; }, { multiline: true, rows: 3 })),
    usage && h('section', { class: 'panel' }, h('h2', {}, t('Used by')),
      h('p', {}, t('{p} people, {m} moves, {f} photos, {r} marriages', { p: usage.people.length, m: usage.moves.length, f: usage.photos.length, r: usage.rels.length }))),
    h('div', { class: 'editor-actions' }, msg,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: keep }, t('Keep these changes')),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { if (!editorDirty || confirm(t('Throw away your edits?'))) { editorDirty = false; location.hash = '#/places'; } } }, t('Cancel')),
        !isNew && h('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, t('Delete place')))));
  showCoords();

  try {
    const L = await loadLeaflet('../');
    map = L.map(mapBox, { worldCopyJump: true }).setView(hasCoords(draft) ? [draft.lat, draft.lng] : [41, 42], hasCoords(draft) ? 10 : 4);
    baseTiles(L).addTo(map);
    for (const pl of store.places.values()) {
      if (pl.id !== draft.id && hasCoords(pl)) L.circleMarker([pl.lat, pl.lng], { radius: 4, color: '#8d969a', weight: 1, fillOpacity: 0.5 }).bindTooltip(pl.name).addTo(map);
    }
    if (hasCoords(draft)) setPoint(draft.lat, draft.lng);
    editorDirty = false;
    map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));
  } catch (err) {
    clear(mapBox, h('p', { class: 'form-message' }, err.message));
  }
}

// =====================================================================
// Moves (migrations)
// =====================================================================

let moveQuery = '';

function moveSummary(m) {
  const names = m.people.map(personName).join(', ');
  const from = m.from ? placeText({ placeId: m.from }, store.places, m.date) : '?';
  const to = m.to ? placeText({ placeId: m.to }, store.places, m.date) : '?';
  return { names, route: `${from} → ${to}` };
}

function movesPage() {
  const list = h('div', { class: 'admin-list' });
  const draw = () => {
    const q = normalizeText(moveQuery).trim();
    const all = [...store.moves.values()].sort((a, b) => (sortKeyOf(a.date) ?? 1e9) - (sortKeyOf(b.date) ?? 1e9));
    const items = all.filter((m) => {
      if (!q) return true;
      const { names, route } = moveSummary(m);
      return normalizeText(`${names} ${route} ${formatDate(m.date)}`).includes(q);
    });
    clear(list, items.length ? items.map((m) => {
      const { names, route } = moveSummary(m);
      return h('a', { class: 'admin-row', href: `#/move/${m.id}` },
        h('span', { class: 'place-pin', 'aria-hidden': 'true' }, '➜'),
        h('span', { class: 'admin-row-main' },
          h('strong', {}, route),
          h('span', { class: 'muted small' }, [formatDate(m.date), names, m.reason && t(MOVE_REASONS[m.reason] || m.reason)].filter(Boolean).join(' · '))));
    }) : h('p', { class: 'muted' }, all.length ? t('No moves match.') : t('No moves yet. Record when someone moved from one place to another.')));
  };
  draw();
  clear(view,
    h('div', { class: 'admin-title' }, h('h1', {}, t('Moves')),
      h('a', { class: 'btn btn-primary', href: '#/move/new' }, '+ ', t('Add a move'))),
    h('p', { class: 'muted' }, t('A move is a journey from one place to another: who went, when, and why. Moves draw the arrows on the map.')),
    h('input', {
      type: 'search', class: 'search-input', placeholder: t('Find by person, place or year…'), value: moveQuery,
      oninput: debounce((e) => { moveQuery = e.target.value; draw(); }, 80),
    }),
    list);
}

function moveEditorPage(id, params) {
  const isNew = id === 'new' || !store.moves.has(id);
  const draft = isNew ? { people: params.get('person') ? [params.get('person')] : [], reason: 'work' } : structuredClone(store.moves.get(id));
  currentEditRoute = `move/${id}`;
  const backTo = params.get('person') ? `#/person/${params.get('person')}` : '#/moves';
  editorDirty = false;
  const touch = () => { editorDirty = true; };
  const { text, select, dateField, placeField } = fieldKit(touch);
  const msg = h('p', { class: 'form-message', role: 'alert' });
  const peopleBox = h('div', {});
  const privacyNote = h('p', { class: 'muted small' });
  const drawPeople = () => {
    const fam = draft.people.filter((pid) => store.people.get(pid)?.privacy !== 'public');
    privacyNote.textContent = fam.length
      ? t('Family-only, because it includes: {names}.', { names: fam.map(personName).join(', ') })
      : draft.people.length ? t('Public, because everyone in it is public.') : '';
    clear(peopleBox,
      draft.people.map((pid) => h('div', { class: 'rel-row' },
        h('div', { class: 'rel-main' },
          h('span', { class: 'monogram small', 'aria-hidden': 'true' }, initials(store.people.get(pid) || {})),
          h('strong', {}, personName(pid))),
        h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => { draft.people = draft.people.filter((x) => x !== pid); touch(); drawPeople(); } }, t('Remove')))),
      personPicker({
        label: t('Add a person who moved'), excludeIds: draft.people, allowCreate: false,
        onPick: (pid) => { draft.people.push(pid); touch(); drawPeople(); },
      }),
      privacyNote);
  };
  drawPeople();

  const keep = () => {
    if (view.querySelector('.date-preview.bad')) { msg.textContent = t('The date could not be read. Please fix it.'); return; }
    try {
      store.saveMove(isNew ? { ...draft, id: undefined } : draft);
    } catch (err) { msg.textContent = err.message; return; }
    editorDirty = false;
    changed();
    toast(t('Kept. Click "Save & publish" when you are ready.'), 'ok');
    location.hash = backTo;
  };

  clear(view,
    h('nav', { class: 'crumbs' }, h('a', { href: '#/moves' }, t('Moves')), ' / ', isNew ? t('New move') : moveSummary(draft).route),
    h('h1', {}, isNew ? t('Add a move') : t('Edit move')),
    h('section', { class: 'panel' }, h('h2', {}, t('Who moved?')),
      h('p', { class: 'muted small' }, t('Add everyone who travelled together, e.g. the whole family.')), peopleBox),
    h('section', { class: 'panel' }, h('h2', {}, t('Where and when?')),
      h('div', { class: 'grid-2' },
        placeField(t('From'), draft, { idKey: 'from', textKey: null, requireSaved: true }),
        placeField(t('To'), draft, { idKey: 'to', textKey: null, requireSaved: true })),
      h('div', { class: 'grid-2' },
        dateField(t('When'), () => draft.date, (v) => { draft.date = v; }),
        select(t('Why'), Object.fromEntries(Object.entries(MOVE_REASONS).map(([k, v]) => [k, t(v)])), () => draft.reason, (v) => { draft.reason = v; }))),
    h('section', { class: 'panel' }, h('h2', {}, t('The story')),
      text(t('What happened?'), () => draft.story, (v) => { draft.story = v; }, { multiline: true, rows: 6, placeholder: t('How did they travel? What did they take? Who helped?') })),
    h('div', { class: 'editor-actions' }, msg,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: keep }, t('Keep these changes')),
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { if (!editorDirty || confirm(t('Throw away your edits?'))) { editorDirty = false; location.hash = backTo; } } }, t('Cancel')),
        !isNew && h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: () => { if (!confirm(t('Delete this move?'))) return; store.deleteMove(id); editorDirty = false; changed(); location.hash = '#/moves'; },
        }, t('Delete move')))));
}

/** On a person's admin page: their moves. */
function personMovesSection(person, isNew) {
  const moves = store.movesOf(person.id).sort((a, b) => (sortKeyOf(a.date) ?? 1e9) - (sortKeyOf(b.date) ?? 1e9));
  return h('section', { class: 'panel' }, h('h2', {}, t('Moves')),
    moves.length ? moves.map((m) => {
      const { route, names } = moveSummary(m);
      return h('a', { class: 'admin-row', href: `#/move/${m.id}` },
        h('span', { class: 'admin-row-main' }, h('strong', {}, route),
          h('span', { class: 'muted small' }, [formatDate(m.date), m.people.length > 1 ? t('with {names}', { names }) : ''].filter(Boolean).join(' · '))));
    }) : h('p', { class: 'muted' }, t('No moves recorded.')),
    isNew
      ? h('p', { class: 'muted small' }, t('Keep this person first, then you can add their moves.'))
      : h('a', { class: 'btn btn-quiet btn-small', href: `#/move/new?person=${person.id}` }, '+ ', t('Add a move for this person')));
}

// =====================================================================
// History (recent changes) and undo
// =====================================================================

let historyPageNo = 1;

function describeCommit(c) {
  const first = c.message.split('\n')[0];
  if (first.startsWith('Archive: ')) return { kind: 'archive', text: first.slice(9) };
  if (/family password/i.test(first)) return { kind: 'password', text: first };
  return { kind: 'website', text: t('Website update (changes to how the site works, not to your data)') };
}

async function historyPage() {
  const list = h('div', { class: 'history-list' });
  clear(view,
    h('h1', {}, t('Recent changes')),
    h('p', { class: 'muted' }, t('Every save is kept. "Undo" puts back what that change altered — except things that were changed again since, which are left alone and listed.')),
    store.pendingCount ? h('div', { class: 'notice' }, h('p', {}, t('Save or discard your unsaved changes before undoing anything.'))) : null,
    list);
  clear(list, h('p', { class: 'loading' }, t('Loading…')));
  let commits;
  try {
    commits = [];
    for (let pg = 1; pg <= historyPageNo; pg++) commits.push(...await store.repo.listCommits({ page: pg, perPage: 30 }));
  } catch (err) {
    clear(list, h('p', { class: 'form-message' }, t('Could not load the history: {msg}', { msg: err.message })));
    return;
  }
  const rows = commits.map((c) => {
    const d = describeCommit(c);
    const when = new Date(c.date);
    const details = h('ul', { class: 'history-ops' });
    const changeId = c.message.match(/Change-Id: (\w+)/)?.[1];
    if (changeId) {
      store.readChangeNote(changeId).then((note) => {
        if (note?.ops?.length) clear(details, note.ops.map((op) => h('li', {}, op)));
      }).catch(() => {});
    }
    const canUndo = d.kind === 'archive' && !!c.parent && !store.pendingCount;
    const undoBtn = d.kind === 'archive' ? h('button', {
      class: 'btn btn-quiet btn-small', disabled: !canUndo,
      onclick: async (e) => {
        if (!confirm(t('Undo this change?\n\n“{text}”\n\nThis is saved as a new change, so it can itself be undone.', { text: d.text }))) return;
        e.target.disabled = true;
        e.target.textContent = t('Undoing…');
        try {
          const r = await store.undoCommit(c.sha);
          if (!r.undone) {
            alert(t('Nothing was undone: everything in that change has been changed again since ({items}).', { items: r.skipped.join(', ') }));
          } else {
            if (r.skipped.length) alert(t('Undone. These were changed again later, so they were left as they are now: {items}.', { items: r.skipped.join(', ') }));
            else toast(t('Undone. The site updates in about a minute.'), 'ok');
            publishState = { state: 'publishing', sha: r.sha };
            renderSavebar();
            watchPublish(r.sha);
          }
        } catch (err) {
          alert(err.message);
        }
        historyPage();
      },
    }, '↶ ', t('Undo')) : null;
    return h('div', { class: `history-row history-${d.kind}` },
      h('div', { class: 'history-when' },
        h('strong', {}, when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })),
        h('span', { class: 'muted small' }, when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'history-what' },
        h('span', {}, d.text), details,
        c.author && h('span', { class: 'muted small' }, t('by {name}', { name: c.author }))),
      undoBtn);
  });
  clear(list, rows.length ? rows : h('p', { class: 'muted' }, t('No changes yet.')),
    commits.length >= historyPageNo * 30 ? h('button', { class: 'btn btn-quiet', onclick: () => { historyPageNo++; historyPage(); } }, t('Show older changes')) : null);
}

// =====================================================================
// Backup and GEDCOM
// =====================================================================

const BACKUP_KEY = scopedKey('lastBackup');

function download(parts, filename, type) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

function backupPage() {
  const status = h('p', { class: 'upload-progress', role: 'status', 'aria-live': 'polite' });
  const photoBytes = [...store.photos.values()].reduce((n, p) => n + (p.bytes || 0), 0);
  const last = safeStorage.get('localStorage', BACKUP_KEY);
  const busy = (on) => view.querySelectorAll('.backup-actions button').forEach((b) => { b.disabled = on; });

  const runBackup = async (withPhotos) => {
    if (store.pendingCount) { alert(t('Please Save & publish (or discard) your changes first.')); return; }
    busy(true);
    try {
      const { parts, filename, counts } = await buildBackup(store, {
        withPhotos,
        onProgress: ({ step, done, total }) => clear(status, h('span', { class: 'spinner' }), ' ',
          step === 'packing' ? t('Packing the ZIP file…') : t(step === 'people' ? 'Reading people: {done} of {total}' : 'Reading photos: {done} of {total}', { done, total })),
      });
      download(parts, filename, 'application/zip');
      safeStorage.set('localStorage', BACKUP_KEY, new Date().toISOString());
      clear(status, '✓ ', t('Backup ready: {people} people, {photos} photos. Check your Downloads folder.', { people: counts.people, photos: counts.images }));
      renderBanners();
    } catch (err) {
      clear(status, h('span', { class: 'form-message' }, err.message));
    } finally { busy(false); }
  };

  const exportGed = async () => {
    busy(true);
    try {
      clear(status, h('span', { class: 'spinner' }), ' ', t('Preparing the GEDCOM file…'));
      const { people } = await gatherPeople(store);
      const { text, warnings } = exportGedcom({ people, rels: store.rels, places: store.places, moves: store.moves, title: store.config.siteTitle });
      download([text], `family-archive-${new Date().toISOString().slice(0, 10)}.ged`, 'text/plain;charset=utf-8');
      clear(status, '✓ ', t('GEDCOM file ready ({n} people).', { n: people.size }), warnings.length ? h('span', { class: 'muted small' }, ` ${warnings.join(' ')}`) : null);
    } catch (err) {
      clear(status, h('span', { class: 'form-message' }, err.message));
    } finally { busy(false); }
  };

  const preview = h('div', {});
  const gedInput = h('input', {
    type: 'file', accept: '.ged,.GED,text/plain', hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let result;
      try {
        result = importGedcom(await file.text());
      } catch (err) { alert(t('This file could not be read as GEDCOM: {msg}', { msg: err.message })); return; }
      const dups = store.likelyDuplicates(result.people);
      clear(preview, h('div', { class: 'panel batch-panel' },
        h('h3', {}, t('Ready to import “{name}”', { name: file.name })),
        h('p', {}, t('{p} people, {f} families, {l} places. Everyone is added as family-only; you can make people public afterwards.', { p: result.stats.people, f: result.stats.families, l: result.stats.places })),
        dups.length ? h('div', { class: 'notice' }, h('p', {}, t('{n} of them look like people already in the archive (same name and birth year), e.g. {names}. Importing will create duplicates of them.', {
          n: dups.length, names: dups.slice(0, 5).map((p) => displayName(p)).join(', '),
        }))) : null,
        result.warnings.length ? h('details', {}, h('summary', {}, t('{n} notes about the file', { n: result.warnings.length })), h('ul', {}, result.warnings.map((w) => h('li', { class: 'small' }, w)))) : null,
        h('div', { class: 'actions' },
          h('button', {
            class: 'btn btn-primary', onclick: () => {
              store.importBatch(result, `Imported from ${file.name}`);
              changed();
              clear(preview);
              toast(t('Added. Look them over under People, then click "Save & publish".'), 'ok');
            },
          }, t('Add {n} people', { n: result.people.length })),
          h('button', { class: 'btn btn-quiet', onclick: () => clear(preview) }, t('Cancel')))));
    },
  });

  const repoZip = store.repo.owner ? `https://github.com/${store.repo.owner}/${store.repo.repo}/archive/refs/heads/${store.repo.branch}.zip` : null;
  clear(view,
    h('h1', {}, t('Backup')),
    h('section', { class: 'panel' }, h('h2', {}, t('Download a full backup')),
      h('p', {}, t('One ZIP file with everything in readable form: all people (including family-only information), family links, places, moves, photo details, a GEDCOM file and the photos.')),
      h('p', { class: 'notice notice-warn' }, t('The backup is NOT encrypted. Keep it somewhere private, such as an external drive that stays at home.')),
      h('div', { class: 'actions backup-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => runBackup(true) }, '⬇ ', t('With photos (about {size})', { size: formatBytes(photoBytes * 0.92 + 200_000) })),
        h('button', { class: 'btn', onclick: () => runBackup(false) }, '⬇ ', t('Without photos (small)'))),
      status,
      h('p', { class: 'muted small' }, last ? t('Last backup on this device: {date}.', { date: new Date(last).toLocaleDateString() }) : t('No backup made on this device yet.'))),
    h('section', { class: 'panel' }, h('h2', {}, t('Keep your originals safe')),
      h('ul', {},
        h('li', {}, t('The archive keeps smaller copies of photos. Keep the full-size originals and scans on an external drive AND in a cloud folder.')),
        h('li', {}, t('Make a full backup a few times a year, and store it in a different place from the originals.')),
        h('li', {}, t('Every change is also kept in the history on GitHub (see Recent changes).')),
        repoZip ? h('li', {}, t('An exact copy of the archive as stored on GitHub (family data still encrypted): '), h('a', { href: repoZip }, t('download the repository ZIP'))) : null)),
    h('section', { class: 'panel' }, h('h2', {}, t('GEDCOM (other genealogy programs)')),
      h('p', {}, t('GEDCOM is the standard file that genealogy programs use to exchange family trees (Gramps, MyHeritage, Ancestry, RootsMagic, FamilySearch…).')),
      h('div', { class: 'actions backup-actions' },
        h('button', { class: 'btn', onclick: exportGed }, '⬇ ', t('Export GEDCOM file')),
        h('button', { class: 'btn', onclick: () => gedInput.click() }, '⬆ ', t('Import a GEDCOM file…')),
        gedInput),
      h('p', { class: 'muted small' }, t('Photos are not part of GEDCOM files. Imported people come in as family-only and are added to your unsaved changes for you to review first.')),
      preview));
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
            clear(pwMsg, friendlyError(err));
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
    item(t('Places and moves'),
      h('p', {}, t('Save each town once under Places (search the world map to put it on the map), with its older names and countries over time. Then pick it in any place box. Under Moves, record who moved from where to where, when and why; moves draw the arrows on the website’s map.'))),
    item(t('Undoing a mistake'),
      h('p', {}, t('Open History, find the change and click Undo. Only what that change altered is put back; anything changed again since is left alone and listed. An undo is itself a change, so it can be undone too.'))),
    item(t('Backups and other genealogy programs'),
      h('p', {}, t('Backup → "With photos" downloads everything in readable form (people, family links, places, moves, photos and a GEDCOM file). Keep it somewhere private. GEDCOM export/import lets you exchange the tree with programs like Gramps, MyHeritage or Ancestry.'))),
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
