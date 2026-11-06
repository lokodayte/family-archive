// Writes the made-up sample family into site/data/.
// Usage: SAMPLE_PASSWORD=... node tools/make-sample.mjs
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSampleArchive } from './buildSample.js';

const password = process.env.SAMPLE_PASSWORD;
if (!password) { console.error('Set SAMPLE_PASSWORD'); process.exit(1); }

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const { repo } = await buildSampleArchive(password, { settings: { correctionEmail: process.env.SAMPLE_EMAIL || '' } });
await rm(join(siteDir, 'data'), { recursive: true, force: true });
for (const [path, content] of Object.entries(repo.snapshot())) {
  const full = join(siteDir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  console.log('wrote', path);
}
