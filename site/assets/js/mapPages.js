// The family map (journeys and "where everyone lived" by year) and the page for each place.
import { h, clear } from './lib/dom.js';
import { t } from './lib/i18n.js';
import { displayName } from './lib/model.js';
import { formatDate, estimateYear, sortKey } from './lib/dates.js';
import { lifespan } from './lib/timeline.js';
import {
  placeLabel, placeNameAt, countryAt, allPlaceNames, hasCoords, whoWhereIn, yearRange,
  placeConnections, branchOf, branchColors, MOVE_REASONS,
} from './lib/places.js';
import { curvePoints, bendFor, routeKey, screenAngle } from './lib/geo.js';
import { loadLeaflet, baseTiles } from './lib/leaflet.js';

const ROLE_TEXT = {
  born: 'Born here', died: 'Died here', lived: 'Lived here', arrived: 'Moved here', left: 'Moved away',
  married: 'Married here', mentioned: 'Other connection',
};

export function createMapPages({ archive, personChip, photoTile, lockedNotice, link }) {
  let map = null;
  let timer = null;

  function leave() {
    clearInterval(timer);
    timer = null;
    if (map) { map.remove(); map = null; }
  }

  const branchColor = (() => {
    let cache = null;
    let key = null;
    return (personId) => {
      if (key !== archive.people) { cache = branchColors(archive.people).colors; key = archive.people; }
      return cache.get(branchOf(archive.people.get(personId))) || '#5c6b73';
    };
  })();

  // ---------- side panel contents ----------

  function connectionsList(placeId) {
    const conns = placeConnections(placeId, {
      people: archive.people, rels: archive.rels, photos: archive.photos, moves: archive.moves,
    });
    const byRole = new Map();
    for (const c of conns) {
      if (!c.personId) continue;
      if (!byRole.has(c.role)) byRole.set(c.role, new Map());
      const seen = byRole.get(c.role);
      if (!seen.has(c.personId)) seen.set(c.personId, c);
    }
    const photos = conns.filter((c) => c.photoId).map((c) => archive.photos.get(c.photoId)).filter(Boolean);
    const groups = Object.keys(ROLE_TEXT).filter((r) => byRole.has(r)).map((role) => {
      const items = [...byRole.get(role).values()].sort((a, b) => (sortKey(a.date) ?? 1e9) - (sortKey(b.date) ?? 1e9));
      return h('div', { class: 'family-group' }, h('h3', {}, t(ROLE_TEXT[role])),
        h('div', { class: 'chips' }, items.map((c) => personChip(c.personId, formatDate(c.date)))));
    });
    return { groups, photos, count: new Set(conns.filter((c) => c.personId).map((c) => c.personId)).size };
  }

  function placeHistory(pl) {
    const older = (pl.names || []).filter((n) => n.name && n.name !== pl.name);
    const span = (r) => [r.from, r.to].some((x) => x != null) ? ` (${r.from ?? '…'}–${r.to ?? t('today')})` : '';
    return [
      older.length ? h('p', { class: 'muted' }, t('Also known as'), ' ', older.map((n, i) => [i ? ', ' : '', h('strong', {}, n.name), span(n)])) : null,
      pl.countries?.length ? h('ul', { class: 'country-list' }, pl.countries.map((c) => h('li', {}, c.country, h('span', { class: 'muted' }, span(c))))) : null,
      pl.note ? h('p', { class: 'prose' }, pl.note) : null,
    ];
  }

  function placePanel(placeId, year) {
    const pl = archive.places.get(placeId);
    if (!pl) return null;
    const { groups, photos, count } = connectionsList(placeId);
    const here = year != null ? (whoWhereIn(archive.people, archive.moves, year).get(placeId) || []) : null;
    return [
      h('h2', {}, year != null ? placeNameAt(pl, year) : pl.name),
      h('p', { class: 'muted small' }, year != null ? [countryAt(pl, year) || '', ` · ${year}`] : countryAt(pl)),
      here ? h('div', { class: 'family-group' },
        h('h3', {}, t(here.length === 1 ? '1 person here in {year}' : '{n} people here in {year}', { n: here.length, year })),
        h('div', { class: 'chips' }, here.map((pid) => {
          const s = archive.people.get(pid);
          const b = estimateYear(s.birth?.date);
          return personChip(pid, b != null ? t('age about {n}', { n: year - b }) : '');
        }))) : null,
      !here && groups,
      !here && photos.length ? h('div', { class: 'photo-tiles small-tiles' }, photos.slice(0, 6).map((ph) => photoTile(ph))) : null,
      h('p', {}, h('a', { class: 'btn btn-quiet btn-small', href: `#/place/${placeId}` }, t('Everything about {name} ({n} people) →', { name: pl.name, n: count }))),
    ];
  }

  function movePanel(m) {
    const from = archive.places.get(m.from);
    const to = archive.places.get(m.to);
    const y = estimateYear(m.date);
    return [
      h('h2', {}, [from ? placeNameAt(from, y) : '?', ' → ', to ? placeNameAt(to, y) : '?']),
      h('p', { class: 'muted' }, [formatDate(m.date), m.reason && t(MOVE_REASONS[m.reason] || m.reason)].filter(Boolean).join(' · ')),
      h('div', { class: 'chips' }, m.people.filter((pid) => archive.people.has(pid)).map((pid) => personChip(pid))),
      m.story ? h('p', { class: 'prose' }, m.story) : null,
    ];
  }

  // ---------- the map page ----------

  function mapPage(query) {
    leave();
    const mode = query.mode === 'year' ? 'year' : 'journeys';
    const person = query.person && archive.people.has(query.person) ? query.person : '';
    const range = yearRange(archive.people, archive.moves);
    let year = Number(query.year) || (range ? Math.min(range.max, Math.max(range.min, 1925)) : null);
    if (range) year = Math.min(range.max, Math.max(range.min, year));

    const mapBox = h('div', { class: 'family-map' });
    const panel = h('aside', { class: 'map-panel panel' },
      h('p', { class: 'muted' }, mode === 'year'
        ? t('Move the slider to see where everyone lived in that year. Click a circle to see who was there.')
        : t('Arrows show who moved where. Click an arrow or a place for details.')));
    const legend = h('div', { class: 'map-legend' });
    const setQuery = (patch) => {
      const next = { ...query, ...patch };
      for (const k of Object.keys(next)) if (next[k] === '' || next[k] == null) delete next[k];
      const qs = new URLSearchParams(next).toString();
      location.hash = `#/map${qs ? `?${qs}` : ''}`;
    };

    // People who appear on the map, for the "Show" filter.
    const onMap = [...archive.people.values()].filter((s) => s.birth?.placeId || s.death?.placeId || s.lived?.length
      || [...archive.moves.values()].some((m) => m.people.includes(s.id)))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

    const yearLabel = h('output', { class: 'year-label' }, year ?? '');
    const slider = range ? h('input', {
      type: 'range', min: String(range.min), max: String(range.max), value: String(year), step: '1', 'aria-label': t('Year'),
      oninput: (e) => { year = Number(e.target.value); yearLabel.textContent = year; drawYear(); },
      onchange: () => history.replaceState(null, '', `#/map?${new URLSearchParams({ ...query, mode: 'year', year })}`),
    }) : null;
    const playBtn = h('button', {
      type: 'button', class: 'btn btn-small',
      onclick: () => {
        if (timer) { clearInterval(timer); timer = null; playBtn.textContent = `▶ ${t('Play')}`; return; }
        if (year >= range.max) year = range.min;
        playBtn.textContent = `❚❚ ${t('Pause')}`;
        timer = setInterval(() => {
          year = Math.min(range.max, year + 1);
          slider.value = String(year); yearLabel.textContent = year; drawYear();
          if (year >= range.max) { clearInterval(timer); timer = null; playBtn.textContent = `▶ ${t('Play')}`; }
        }, 450);
      },
    }, `▶ ${t('Play')}`);

    const controls = h('div', { class: 'map-controls' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': t('Map view') },
        h('button', { type: 'button', class: mode === 'journeys' ? 'on' : '', onclick: () => setQuery({ mode: '' }) }, t('Journeys')),
        h('button', { type: 'button', class: mode === 'year' ? 'on' : '', onclick: () => setQuery({ mode: 'year', year }) }, t('Where everyone lived'))),
      h('label', { class: 'gen-select' }, t('Show'), ' ',
        h('select', { value: person, onchange: (e) => setQuery({ person: e.target.value }) },
          h('option', { value: '' }, t('Everyone')),
          onMap.map((s) => h('option', { value: s.id }, `${displayName(s)} ${lifespan(s) ? `(${lifespan(s)})` : ''}`)))));

    const yearBar = mode === 'year' && range ? h('div', { class: 'year-bar' }, playBtn, slider, yearLabel) : null;

    // Leaflet layers
    let placeLayer;
    let moveLayer;
    let yearLayer;

    function showPanel(content) {
      clear(panel, h('button', { type: 'button', class: 'btn btn-quiet btn-small panel-close', 'aria-label': t('Close'), onclick: () => clear(panel) }, '✕'), content);
      if (window.innerWidth < 860) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function drawLegend(personIds) {
      const { order } = branchColors(new Map([...personIds].map((id) => [id, archive.people.get(id)]).filter(([, s]) => s)));
      clear(legend, order.length ? [h('span', { class: 'muted small' }, t('Family branches:')),
        order.slice(0, 8).map((b) => h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: `background:${b.color}` }), b.branch))] : null);
      // Use the same colours as the map (computed over everyone).
      for (const el of legend.querySelectorAll('.legend-item')) {
        const name = el.textContent;
        const anyone = [...personIds].find((id) => branchOf(archive.people.get(id)) === name);
        if (anyone) el.firstChild.style.background = branchColor(anyone);
      }
    }

    function drawPlaces(L, counts) {
      placeLayer?.remove();
      placeLayer = L.layerGroup();
      for (const pl of archive.places.values()) {
        if (!hasCoords(pl)) continue;
        const n = counts.get(pl.id) || 0;
        if (person && !n) continue;
        const m = L.circleMarker([pl.lat, pl.lng], {
          radius: 5 + Math.min(10, Math.sqrt(n) * 2), color: '#1f2a2e', weight: 1.5, fillColor: '#ffffff', fillOpacity: 0.95,
        });
        m.bindTooltip(pl.name, { direction: 'top', offset: [0, -6] });
        m.on('click', () => showPanel(placePanel(pl.id)));
        placeLayer.addLayer(m);
      }
      placeLayer.addTo(map);
    }

    function drawJourneys(L) {
      moveLayer?.remove();
      moveLayer = L.layerGroup();
      const routes = new Map();
      const shown = new Set();
      const moves = [...archive.moves.values()]
        .filter((m) => !person || m.people.includes(person))
        .sort((a, b) => (sortKey(a.date) ?? 1e9) - (sortKey(b.date) ?? 1e9));
      for (const m of moves) {
        const a = archive.places.get(m.from);
        const b = archive.places.get(m.to);
        if (!hasCoords(a) || !hasCoords(b) || a.id === b.id) continue;
        const key = routeKey(a.id, b.id);
        const i = routes.get(key) || 0;
        routes.set(key, i + 1);
        const pts = curvePoints([a.lat, a.lng], [b.lat, b.lng], bendFor(i));
        const color = branchColor(m.people[0]);
        m.people.forEach((pid) => shown.add(pid));
        const names = m.people.filter((pid) => archive.people.has(pid)).map((pid) => displayName(archive.people.get(pid)));
        const tip = `${names.join(', ')} · ${a.name} → ${b.name}${m.date ? ` · ${formatDate(m.date)}` : ''}`;
        const line = L.polyline(pts, { color, weight: 3.5, opacity: 0.85, lineCap: 'round' }).bindTooltip(tip, { sticky: true });
        // Wider invisible line makes it easier to tap on phones.
        const hit = L.polyline(pts, { color, weight: 18, opacity: 0 }).bindTooltip(tip, { sticky: true });
        // Arrowhead near the end, turned along the curve.
        const k = Math.floor(pts.length * 0.8);
        const p1 = map.project(pts[k - 1]);
        const p2 = map.project(pts[k + 1]);
        const angle = screenAngle(p1, p2);
        const arrow = L.marker(pts[k], {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'move-arrow', html: `<span style="transform:rotate(${angle}deg);border-left-color:${color}"></span>`, iconSize: [18, 18] }),
        });
        for (const layer of [line, hit]) layer.on('click', () => showPanel(movePanel(m)));
        moveLayer.addLayer(line).addLayer(hit).addLayer(arrow);
      }
      moveLayer.addTo(map);
      return shown;
    }

    function drawYear() {
      const L = globalThis.L;
      if (!L || !map) return;
      yearLayer?.remove();
      yearLayer = L.layerGroup();
      const where = whoWhereIn(archive.people, archive.moves, year);
      const everyone = new Set();
      for (const [placeId, ids] of where) {
        const pl = archive.places.get(placeId);
        if (!hasCoords(pl)) continue;
        const list = person ? ids.filter((id) => id === person) : ids;
        if (!list.length) continue;
        list.forEach((id) => everyone.add(id));
        // Colour by the biggest branch among the people there.
        const tally = new Map();
        for (const id of list) { const c = branchColor(id); tally.set(c, (tally.get(c) || 0) + 1); }
        const color = [...tally].sort((x, y) => y[1] - x[1])[0][0];
        const size = 26 + Math.min(26, Math.sqrt(list.length) * 6);
        const marker = L.marker([pl.lat, pl.lng], {
          icon: L.divIcon({
            className: 'people-bubble', iconSize: [size, size],
            html: `<span style="background:${color}">${list.length}</span>`,
          }),
          title: `${placeNameAt(pl, year)}: ${list.length}`,
        });
        marker.bindTooltip(`${placeNameAt(pl, year)} · ${list.length}`, { direction: 'top', offset: [0, -size / 2] });
        marker.on('click', () => showPanel(placePanel(placeId, year)));
        yearLayer.addLayer(marker);
      }
      yearLayer.addTo(map);
      drawLegend(everyone);
    }

    // Build after the page is on screen.
    queueMicrotask(async () => {
      try {
        const L = await loadLeaflet('');
        if (!mapBox.isConnected) return;
        map = L.map(mapBox, { worldCopyJump: true, zoomSnap: 0.5 });
        baseTiles(L).addTo(map);
        const located = [...archive.places.values()].filter(hasCoords);
        if (!located.length) {
          map.setView([41, 42], 4);
          showPanel(h('p', {}, t('No places with a map location yet.')));
          return;
        }
        // Count connections per place (for marker size).
        const counts = new Map();
        for (const pl of located) {
          const ids = new Set(placeConnections(pl.id, { people: archive.people, rels: archive.rels, moves: archive.moves })
            .filter((c) => c.personId && (!person || c.personId === person)).map((c) => c.personId));
          counts.set(pl.id, ids.size);
        }
        const focus = located.filter((pl) => !person || counts.get(pl.id));
        map.fitBounds(L.latLngBounds((focus.length ? focus : located).map((pl) => [pl.lat, pl.lng])).pad(0.25), { maxZoom: 8 });
        if (mode === 'year') {
          drawPlaces(L, new Map());
          placeLayer.eachLayer((l) => l.setStyle({ radius: 3, fillColor: '#c9c2b3', color: '#8d969a', weight: 1 }));
          drawYear();
        } else {
          drawPlaces(L, counts);
          const shown = drawJourneys(L);
          drawLegend(shown.size ? shown : new Set(archive.people.keys()));
          if (!archive.moves.size) showPanel(h('p', {}, t('No moves recorded yet. Places are shown as circles.')));
        }
      } catch (err) {
        clear(mapBox, h('p', { class: 'form-message' }, err.message));
      }
    });

    return [
      h('div', { class: 'tree-head' }, h('h1', {}, t('Map')), controls),
      lockedNotice(),
      yearBar,
      h('div', { class: 'map-layout' }, mapBox, panel),
      legend,
      h('p', { class: 'muted small' }, t('Map © OpenStreetMap contributors. Place names follow the year: old names and countries are shown for the time.')),
    ];
  }

  // ---------- a place's own page ----------

  function placePage(id) {
    leave();
    const pl = archive.places.get(id);
    if (!pl) {
      return [h('h1', {}, t('Place not found')),
        h('p', {}, archive.unlocked || !archive.hasFamilyData ? t('This place is not in the archive.') : t('This place may be private to the family.')),
        lockedNotice()];
    }
    const { groups, photos, count } = connectionsList(id);
    const mini = h('div', { class: 'mini-map' });
    if (hasCoords(pl)) {
      queueMicrotask(async () => {
        try {
          const L = await loadLeaflet('');
          if (!mini.isConnected) return;
          map = L.map(mini, { scrollWheelZoom: false }).setView([pl.lat, pl.lng], 9);
          baseTiles(L).addTo(map);
          L.circleMarker([pl.lat, pl.lng], { radius: 9, color: '#1f2a2e', weight: 2, fillColor: '#2f5d50', fillOpacity: 0.9 }).addTo(map);
        } catch (err) { clear(mini, h('p', { class: 'muted' }, err.message)); }
      });
    }
    const names = allPlaceNames(pl);
    return [
      h('nav', { class: 'crumbs' }, h('a', { href: '#/map' }, t('Map')), ' / ', pl.name),
      h('div', { class: 'profile-grid' },
        h('div', { class: 'profile-main' },
          h('h1', {}, pl.name),
          h('p', { class: 'lifespan' }, [countryAt(pl), names.length > 1 ? names.filter((n) => n !== pl.name).join(' · ') : ''].filter(Boolean).join(' — ')),
          h('section', { class: 'panel' }, h('h2', {}, t('People connected to {name}', { name: pl.name })),
            groups.length ? groups : h('p', { class: 'muted' }, t('No one yet.'))),
          photos.length ? h('section', { class: 'panel' }, h('h2', {}, t('Photos taken here')),
            h('div', { class: 'photo-tiles' }, photos.map((ph) => photoTile(ph)))) : null),
        h('aside', { class: 'profile-side' },
          hasCoords(pl) ? h('section', { class: 'panel map-card' }, mini,
            h('a', { class: 'btn btn-quiet btn-small', href: '#/map' }, t('Open the family map →'))) : null,
          h('section', { class: 'panel' }, h('h2', {}, t('History')), placeHistory(pl),
            h('p', { class: 'muted small' }, t('{n} people connected', { n: count }))))),
    ];
  }

  return { mapPage, placePage, leave };
}
