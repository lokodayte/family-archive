// Adds a few clearly fake sample photos to the sample archive (macOS only: uses `sips`).
// Usage: SAMPLE_PASSWORD=... node tools/make-sample-photos.mjs
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AdminStore } from '../site/assets/js/lib/adminStore.js';
import { MemoryRepo } from '../site/assets/js/lib/memoryRepo.js';
import { parseDate } from '../site/assets/js/lib/dates.js';

const password = process.env.SAMPLE_PASSWORD;
if (!password) { console.error('Set SAMPLE_PASSWORD'); process.exit(1); }
const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const tmp = await mkdtemp(join(tmpdir(), 'fa-sample-'));

/** Draw a simple sepia "photo" with silhouettes as a 24-bit BMP. */
function bmp(w, h, figures, hue) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  const [r0, g0, b0] = hue;
  for (let y = 0; y < h; y++) {
    const yy = h - 1 - y; // BMP rows go bottom-up
    const shade = 0.55 + 0.45 * (1 - yy / h);
    for (let x = 0; x < w; x++) {
      let k = shade * (0.97 + 0.03 * Math.sin(x * 0.7 + yy * 1.3));
      for (const f of figures) {
        const cx = f * w, cy = h * 0.42, r = h * 0.09;
        const head = (x - cx) ** 2 + (yy - cy) ** 2 < r * r;
        const body = Math.abs(x - cx) < h * 0.12 && yy > cy + h * 0.11 && yy < cy + h * 0.56;
        if (head || body) k = 0.32;
      }
      const o = 54 + y * row + x * 3;
      buf[o] = Math.min(255, b0 * k); buf[o + 1] = Math.min(255, g0 * k); buf[o + 2] = Math.min(255, r0 * k);
    }
  }
  return buf;
}

async function jpeg(name, w, h, figures, hue, quality) {
  const src = join(tmp, `${name}.bmp`);
  const out = join(tmp, `${name}.jpg`);
  await writeFile(src, bmp(w, h, figures, hue));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), src, '--out', out], { stdio: 'ignore' });
  return new Uint8Array(await readFile(out));
}

async function picture(name, w, h, figures, hue) {
  const scale = 420 / Math.max(w, h);
  return {
    image: await jpeg(name, w, h, figures, hue, 70),
    thumb: await jpeg(`${name}-t`, Math.round(w * scale), Math.round(h * scale), figures, hue, 70),
    w, h,
  };
}

const repo = new MemoryRepo({}, {
  loader: async (path) => { try { return new Uint8Array(await readFile(join(siteDir, path))); } catch { return null; } },
});
const store = new AdminStore(repo);
await store.load();
await store.unlock(password);
const d = (s) => parseDate(s).value;

const forge = store.addPhoto({
  title: 'At the forge (sample)', choice: 'public', date: d('about 1925'), place: 'Yerevan',
  description: 'SAMPLE PHOTO — a made-up picture for trying out the archive.',
  story: 'A made-up story: Hovhannes and his son Grigor in front of the forge.',
  tags: [{ person: 'psample0001', x: 0.35, y: 0.42 }, { person: 'psample0004', x: 0.65, y: 0.42 }],
}, await picture('forge', 1600, 1200, [0.35, 0.65], [214, 190, 160]));
store.addPhoto({
  title: 'Anahit and Lusine (sample)', choice: 'public', date: d('between 1925 and 1929'), place: 'Yerevan',
  tags: [{ person: 'psample0003', x: 0.4, y: 0.42 }, { person: 'psample0005', x: 0.6, y: 0.42 }],
}, await picture('mother-daughter', 1500, 1100, [0.4, 0.6], [200, 205, 190]));
store.addPhoto({
  title: 'Wedding of Grigor and Elena (sample)', choice: 'public', date: d('1938'), place: 'Yerevan',
  description: 'Marked public, but stays family-only automatically because Elena is family-only.',
  tags: [{ person: 'psample0004', x: 0.4, y: 0.42 }, { person: 'psample0006', x: 0.6, y: 0.42 }],
}, await picture('wedding', 1500, 1100, [0.4, 0.6], [225, 215, 200]));
store.addPhoto({
  kind: 'document', title: 'A letter (sample document)', choice: 'family', date: d('about 1950'),
  tags: [{ person: 'psample0007', x: 0.5, y: 0.42 }],
}, await picture('letter', 1100, 1500, [], [236, 228, 205]));
store.setPortrait('psample0001', forge);
store.setPortrait('psample0004', forge);
await store.save();

for (const c of repo.commits.at(-1).changes) {
  const full = join(siteDir, c.path);
  if (c.delete) { await rm(full, { force: true }); console.log('deleted', c.path); continue; }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, c.bytes || c.content);
  console.log('wrote', c.path, c.bytes ? `${Math.round(c.bytes.length / 1024)} KB` : '');
}
await rm(tmp, { recursive: true, force: true });
