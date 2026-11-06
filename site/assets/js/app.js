// The public website: home, search, people, profiles, tree.
import { Archive } from './lib/archive.js';
import { h, clear, debounce, paragraphs, safeStorage, scopedKey, toast } from './lib/dom.js';
import { t, loadLanguage } from './lib/i18n.js';
import {
  displayName, otherNames, maidenName, initials, searchPeople, SCRIPTS, SCRIPT_LABELS,
} from './lib/model.js';
import { formatDate, sortKey } from './lib/dates.js';
import { siblings } from './lib/relations.js';
import { buildTimeline, lifespan, EVENT_TYPES } from './lib/timeline.js';
import { WrongPasswordError } from './lib/crypto.js';
import { renderTree } from './tree.js';

const archive = new Archive('');
const view = document.getElementById('view');
let treeState = { up: 3, down: 3 };
let currentTree = null;

// ---------- small pieces ----------

const link = (id, text) => h('a', { href: `#/person/${id}` }, text ?? displayName(archive.people.get(id)));

function personChip(id, extra) {
  const s = archive.people.get(id);
  if (!s) return null;
  return h('a', { class: `chip${s.placeholder ? ' chip-placeholder' : ''}`, href: `#/person/${id}` },
    h('span', { class: 'monogram small', 'aria-hidden': 'true' }, initials(s)),
    h('span', { class: 'chip-text' },
      h('span', { class: 'chip-name' }, displayName(s)),
      h('span', { class: 'chip-dates' }, [lifespan(s), extra].filter(Boolean).join(' · '))));
}

function badges(s) {
  return h('span', { class: 'badges' },
    s.privacy === 'family' && h('span', { class: 'badge badge-family', title: t('Only visible with the family password') }, t('Family only')),
    s.living && h('span', { class: 'badge' }, t('Living')),
    s.placeholder && h('span', { class: 'badge badge-placeholder' }, t('Unknown — placeholder')));
}

function personCard(s) {
  return h('a', { class: `person-card${s.placeholder ? ' is-placeholder' : ''}`, href: `#/person/${s.id}` },
    h('span', { class: 'monogram', 'aria-hidden': 'true' }, initials(s)),
    h('span', { class: 'person-card-text' },
      h('span', { class: 'person-card-name' }, displayName(s)),
      h('span', { class: 'person-card-dates' }, lifespan(s) || ' '),
      badges(s)));
}

function lockedNotice() {
  if (archive.unlocked || !archive.hasFamilyData) return null;
  return h('div', { class: 'notice' },
    h('p', {}, t('Part of this archive is private to the family. Enter the family password to see everyone.')),
    h('button', { class: 'btn', onclick: openUnlock }, t('Enter family password')));
}

function searchBox(onResults, { autofocus = false, placeholder } = {}) {
  const input = h('input', {
    type: 'search', class: 'search-input', autocomplete: 'off', spellcheck: 'false',
    placeholder: placeholder || t('Search by name, in any alphabet…'),
    'aria-label': t('Search people'),
  });
  input.addEventListener('input', debounce(() => onResults(input.value), 80));
  if (autofocus) setTimeout(() => input.focus(), 0);
  return input;
}

// ---------- pages ----------

function homePage() {
  const results = h('div', { class: 'results' });
  const all = [...archive.people.values()].filter((s) => !s.placeholder);
  const earliest = all
    .filter((s) => sortKey(s.birth?.date) != null)
    .sort((a, b) => sortKey(a.birth.date) - sortKey(b.birth.date))
    .slice(0, 8);
  const showResults = (q) => {
    const found = searchPeople(archive.people, q, 12);
    clear(results, q.trim() && (found.length ? h('div', { class: 'card-grid' }, found.map(personCard))
      : h('p', { class: 'muted' }, t('No one found with that name.'))));
  };
  return [
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, t('A family archive')),
      h('h1', {}, archive.config.siteTitle || t('Our Family Archive')),
      h('p', { class: 'lead' }, t('So we remember who we are and where we come from.')),
      searchBox(showResults),
      results,
      h('p', { class: 'muted small' }, t('{n} people in the archive', { n: all.length }))),
    lockedNotice(),
    earliest.length && h('section', {},
      h('h2', { class: 'section-title' }, t('Begin with the earliest generations')),
      h('div', { class: 'card-grid' }, earliest.map(personCard)),
      h('p', {}, h('a', { href: '#/people', class: 'btn btn-quiet' }, t('See everyone →')))),
  ];
}

function peoplePage() {
  const list = h('div', {});
  const lastName = (s) => {
    for (const sc of SCRIPTS) if (s.names?.[sc]?.last) return s.names[sc].last;
    return displayName(s);
  };
  const render = (q) => {
    const people = q?.trim()
      ? searchPeople(archive.people, q, 500)
      : [...archive.people.values()].sort((a, b) =>
        lastName(a).localeCompare(lastName(b)) || displayName(a).localeCompare(displayName(b)));
    if (!people.length) return clear(list, h('p', { class: 'muted' }, t('No one found with that name.')));
    if (q?.trim()) return clear(list, h('div', { class: 'card-grid' }, people.map(personCard)));
    const groups = new Map();
    for (const s of people) {
      const letter = s.placeholder ? '?' : (lastName(s)[0] || '?').toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(s);
    }
    clear(list, [...groups].map(([letter, ps]) => h('section', { class: 'letter-group' },
      h('h2', { class: 'letter' }, letter),
      h('div', { class: 'card-grid' }, ps.map(personCard)))));
  };
  render('');
  return [
    h('h1', {}, t('Everyone')),
    searchBox(render, { autofocus: true }),
    lockedNotice(),
    list,
  ];
}

function factRow(label, value) {
  if (!value || (Array.isArray(value) && !value.length)) return null;
  return h('div', { class: 'fact' }, h('dt', {}, label), h('dd', {}, value));
}

function dateAndPlace(x) {
  if (!x) return null;
  const parts = [formatDate(x.date), x.place].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function familySection(id) {
  const g = archive.graph;
  const parents = g.parentsOf(id);
  const spouses = g.spousesOf(id);
  const children = g.childrenOf(id);
  const sib = siblings(g, id);
  const kindNote = (k) => (k && k !== 'birth' ? t(k) : '');
  const group = (title, items) => items.length
    ? h('div', { class: 'family-group' }, h('h3', {}, title), h('div', { class: 'chips' }, items))
    : null;
  const spouseNote = (rel) => {
    const bits = [];
    if (rel.start) bits.push(t('married {date}', { date: formatDate(rel.start) }));
    if (rel.end && rel.endReason === 'divorce') bits.push(t('divorced {date}', { date: formatDate(rel.end) }));
    return bits.join(', ');
  };
  const content = [
    group(t('Parents'), parents.map((p) => personChip(p.id, kindNote(p.kind)))),
    group(t('Spouses'), spouses.map((sp) => personChip(sp.id, spouseNote(sp.rel)))),
    group(t('Children'), children.map((c) => personChip(c.id, kindNote(c.kind)))),
    group(t('Brothers and sisters'), sib.full.map((x) => personChip(x))),
    group(t('Half-brothers and half-sisters'), sib.half.map((x) => personChip(x))),
  ].filter(Boolean);
  return content.length ? h('section', { class: 'panel' }, h('h2', {}, t('Family')), content) : null;
}

function timelineSection(person) {
  const items = buildTimeline(person, { graph: archive.graph, people: archive.people });
  if (!items.length) return null;
  const label = (it) => {
    const who = it.personId ? link(it.personId) : null;
    switch (it.type) {
      case 'birth': return [t('Born')];
      case 'death': return [t('Died')];
      case 'marriage': return [t('Married'), ' ', who];
      case 'divorce': return [t('Divorced'), ' ', who];
      case 'child': return [t('Child born:'), ' ', who];
      default: return [t(EVENT_TYPES[it.type] || EVENT_TYPES.other)];
    }
  };
  return h('section', { class: 'panel' },
    h('h2', {}, t('Life timeline')),
    h('ol', { class: 'timeline' }, items.map((it) => h('li', { class: `tl-item tl-${it.type}` },
      h('span', { class: 'tl-date' }, formatDate(it.date) || '—'),
      h('span', { class: 'tl-body' },
        h('span', { class: 'tl-label' }, label(it)),
        it.place && h('span', { class: 'tl-place' }, ` · ${it.place}`),
        it.text && h('span', { class: 'tl-text' }, it.text))))));
}

function correctionLink(person) {
  const email = archive.familySettings?.correctionEmail;
  if (!email) return null;
  const name = displayName(person);
  const body = [
    `${t('Person')}: ${name} (${person.id})`,
    `${t('Page')}: ${location.href}`,
    '',
    `${t('What should be corrected or added?')}`,
    '',
    '',
    `${t('How do you know? (your memory, a relative, a document…)')}`,
    '',
    '',
    `${t('Your name')}:`,
  ].join('\n');
  const href = `mailto:${email}?subject=${encodeURIComponent(t('Family archive correction: {name}', { name }))}&body=${encodeURIComponent(body)}`;
  return h('a', { class: 'btn btn-quiet', href }, '✉ ', t('Suggest a correction'));
}

async function profilePage(id) {
  const s = archive.people.get(id);
  if (!s) {
    return [h('h1', {}, t('Person not found')),
      h('p', {}, archive.unlocked || !archive.hasFamilyData
        ? t('This person is not in the archive (they may have been removed).')
        : t('This person may be private to the family.')),
      lockedNotice()];
  }
  const p = await archive.getPerson(id);
  const others = otherNames(p);
  const maiden = maidenName(p);
  const hasAdmin = !!safeStorage.get('localStorage', scopedKey('ghToken'));

  const nameTable = SCRIPTS.filter((sc) => p.names?.[sc] && Object.keys(p.names[sc]).length).map((sc) => {
    const n = p.names[sc];
    return h('tr', {}, h('th', {}, t(SCRIPT_LABELS[sc])),
      h('td', {}, [n.first, n.patronymic, n.last].filter(Boolean).join(' '),
        n.maiden ? h('span', { class: 'muted' }, ` (${t('née')} ${n.maiden})`) : null));
  });

  return [
    h('nav', { class: 'crumbs' }, h('a', { href: '#/people' }, t('Everyone')), ' / ', displayName(p)),
    h('header', { class: 'profile-head' },
      h('div', { class: 'portrait', 'aria-hidden': 'true' }, h('span', {}, initials(p))),
      h('div', {},
        h('h1', {}, displayName(p)),
        others.length ? h('p', { class: 'other-names' }, others.join(' · ')) : null,
        maiden ? h('p', { class: 'muted' }, `${t('née')} ${maiden}`) : null,
        p.nicknames?.length ? h('p', { class: 'muted' }, `${t('Also called')} “${p.nicknames.join('”, “')}”`) : null,
        h('p', { class: 'lifespan' }, lifespan(p)),
        badges(p),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: `#/tree/${id}` }, '🌳 ', t('See in family tree')),
          correctionLink(p),
          hasAdmin && h('a', { class: 'btn btn-quiet', href: `admin/#/person/${id}` }, '✎ ', t('Edit'))))),
    h('div', { class: 'profile-grid' },
      h('div', { class: 'profile-main' },
        p.bio ? h('section', { class: 'panel prose-panel' }, h('h2', {}, t('Biography')), paragraphs(p.bio)) : null,
        p.stories?.length ? h('section', { class: 'panel prose-panel' }, h('h2', {}, t('Stories')),
          p.stories.map((st) => h('article', { class: 'story' }, st.title && h('h3', {}, st.title), paragraphs(st.text)))) : null,
        timelineSection(p)),
      h('aside', { class: 'profile-side' },
        h('section', { class: 'panel' }, h('h2', {}, t('Facts')),
          h('dl', { class: 'facts' },
            factRow(t('Born'), dateAndPlace(p.birth)),
            !p.living && factRow(t('Died'), dateAndPlace(p.death)),
            factRow(t('Occupation'), p.occupation),
            factRow(t('Education'), p.education),
            factRow(t('Languages'), p.languages?.join(', ')))),
        nameTable.length > 1 ? h('section', { class: 'panel' }, h('h2', {}, t('Names')), h('table', { class: 'names-table' }, nameTable)) : null,
        familySection(id),
        p.sources?.length ? h('section', { class: 'panel' }, h('h2', {}, t('Sources')),
          h('ul', { class: 'sources' }, p.sources.map((src) => h('li', {},
            src.fact && h('strong', {}, `${src.fact}: `),
            src.citation,
            src.confidence && h('span', { class: `confidence conf-${src.confidence}` }, ` ${t(`${src.confidence} confidence`)}`))))) : null)),
  ];
}

function defaultFocus() {
  if (archive.config.homePerson && archive.people.has(archive.config.homePerson)) return archive.config.homePerson;
  const all = [...archive.people.values()].filter((s) => !s.placeholder);
  // Start from someone with the most relatives around them.
  let best = all[0];
  let bestScore = -1;
  for (const s of all) {
    const score = archive.graph.parentsOf(s.id).length + archive.graph.childrenOf(s.id).length * 1.5 + archive.graph.spousesOf(s.id).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best?.id;
}

function treePage(id) {
  const focus = id && archive.people.has(id) ? id : defaultFocus();
  if (!focus) return [h('h1', {}, t('Family tree')), h('p', {}, t('No people yet.')), lockedNotice()];
  const s = archive.people.get(focus);
  const stage = h('div', { class: 'tree-stage' });
  const genSelect = (label, key) => h('label', { class: 'gen-select' }, label, ' ',
    h('select', {
      value: String(treeState[key]),
      onchange: (e) => { treeState[key] = Number(e.target.value); route(); },
    }, [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, String(n)))));
  const panel = h('div', { class: 'tree-panel' },
    h('div', {},
      h('strong', {}, displayName(s)), ' ', h('span', { class: 'muted' }, lifespan(s))),
    h('a', { class: 'btn', href: `#/person/${focus}` }, t('Open profile')));

  queueMicrotask(() => {
    currentTree?.destroy();
    currentTree = renderTree(stage, {
      graph: archive.graph, people: archive.people, focus,
      up: treeState.up, down: treeState.down,
      onSelect: (pid) => { location.hash = `#/tree/${pid}`; },
    });
  });

  return [
    h('div', { class: 'tree-head' },
      h('h1', {}, t('Family tree')),
      h('div', { class: 'tree-controls' },
        genSelect(t('Generations up'), 'up'),
        genSelect(t('Generations down'), 'down'),
        h('span', { class: 'zoom-buttons' },
          h('button', { class: 'btn btn-icon', 'aria-label': t('Zoom in'), onclick: () => currentTree?.zoomBy(0.8) }, '+'),
          h('button', { class: 'btn btn-icon', 'aria-label': t('Zoom out'), onclick: () => currentTree?.zoomBy(1.25) }, '−'),
          h('button', { class: 'btn btn-quiet', onclick: () => currentTree?.fit() }, t('Fit'))))),
    h('p', { class: 'muted small tree-help' }, t('Drag to move, scroll or pinch to zoom. Click a person to put them in the centre. Small arrows mean there are more relatives beyond the edge.')),
    lockedNotice(),
    stage,
    panel,
  ];
}

// ---------- unlock ----------

function openUnlock() {
  const dlg = document.getElementById('unlock-dialog');
  const form = dlg.querySelector('form');
  const msg = dlg.querySelector('.form-message');
  msg.textContent = '';
  form.reset();
  dlg.showModal();
  dlg.querySelector('input[type=password]').focus();
}

function setupUnlockDialog() {
  const dlg = document.getElementById('unlock-dialog');
  const form = dlg.querySelector('form');
  const msg = dlg.querySelector('.form-message');
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = form.password.value;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    msg.textContent = t('Unlocking…');
    try {
      await archive.unlock(pw, form.remember.checked);
      dlg.close();
      toast(t('Welcome! Family pages are now visible.'), 'ok');
      updateHeader();
      route();
    } catch (err) {
      msg.textContent = err instanceof WrongPasswordError ? t('That password is not right. Please try again.') : t('Something went wrong: {msg}', { msg: err.message });
    } finally {
      btn.disabled = false;
    }
  });
}

function updateHeader() {
  const slot = document.getElementById('lock-slot');
  if (!archive.hasFamilyData) return clear(slot);
  clear(slot, archive.unlocked
    ? h('button', {
      class: 'btn btn-quiet btn-small', onclick: () => { archive.lock(); updateHeader(); route(); toast(t('Locked. Family pages are hidden again.')); },
    }, '🔓 ', t('Lock'))
    : h('button', { class: 'btn btn-small', onclick: openUnlock }, '🔒 ', t('Family password')));
  document.querySelector('.brand-title').textContent = archive.config.siteTitle || t('Our Family Archive');
}

// ---------- router ----------

async function route() {
  const [, page, id] = (location.hash || '#/').split('/');
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === (page || 'home')));
  let content;
  try {
    if (page === 'person' && id) content = await profilePage(decodeURIComponent(id));
    else if (page === 'people') content = peoplePage();
    else if (page === 'tree') content = treePage(id && decodeURIComponent(id));
    else content = homePage();
  } catch (err) {
    console.error(err);
    content = [h('h1', {}, t('Something went wrong')), h('p', {}, err.message)];
  }
  if (page !== 'tree') { currentTree?.destroy(); currentTree = null; }
  clear(view, content);
  view.classList.toggle('wide', page === 'tree');
  const title = archive.config.siteTitle || t('Our Family Archive');
  const heading = view.querySelector('h1')?.textContent;
  document.title = heading && heading !== title ? `${heading} — ${title}` : title;
  if (!page || page !== 'tree') window.scrollTo(0, 0);
}

async function start() {
  await loadLanguage('');
  try {
    await archive.load();
  } catch (err) {
    clear(view, h('h1', {}, t('The archive could not be loaded')), h('p', {}, err.message));
    return;
  }
  setupUnlockDialog();
  updateHeader();
  window.addEventListener('hashchange', route);
  route();
}

start();
