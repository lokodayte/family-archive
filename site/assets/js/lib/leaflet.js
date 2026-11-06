// Map helpers: loads the Leaflet library (kept inside this project), the free
// OpenStreetMap background, and place search through OpenStreetMap's Nominatim.
// No account or API key is needed for either.

const LEAFLET_DIR = 'assets/vendor/leaflet-1.9.4/';
let loading = null;

/** Load Leaflet once. base = path from the current page to the site root ('' or '../'). */
export function loadLeaflet(base = '') {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  loading ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${base}${LEAFLET_DIR}leaflet.css`;
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${base}${LEAFLET_DIR}leaflet.js`;
    js.onload = () => resolve(globalThis.L);
    js.onerror = () => { loading = null; reject(new Error('The map could not be loaded. Check your internet connection.')); };
    document.head.append(js);
  });
  return loading;
}

/** The OpenStreetMap background map. */
export function baseTiles(L) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    // OpenStreetMap asks to know which website is using its maps (only the site address is sent).
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
}

/**
 * Find a place by name. Returns [{ label, name, country, lat, lng }].
 * Uses OpenStreetMap's free search; please only call it when someone clicks "Search".
 */
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { referrerPolicy: 'strict-origin-when-cross-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search is not available right now (${res.status}).`);
  const data = await res.json();
  return data.map((r) => ({
    label: r.display_name,
    name: r.name || r.address?.city || r.address?.town || r.address?.village || r.display_name.split(',')[0],
    country: r.address?.country || '',
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}
