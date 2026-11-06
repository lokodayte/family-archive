// Runs during publishing (not on your computer): adds ?v=<version> to every
// script and stylesheet link, so browsers never mix old and new code after an update.
// Usage: node tools/stamp-version.mjs <version>
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = (process.argv[2] || Date.now().toString(36)).slice(0, 12);
const runningDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['data', 'media'].includes(e.name)) yield* walk(p); } else yield p;
  }
}

export function stamp(text, v) {
  return text
    // JavaScript: import ... from './x.js'
    .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${v}$3`)
    .replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${v}$3`)
    // HTML: <script src="..."> and <link href="....css">
    .replace(/(<script[^>]*\bsrc=")([^"?:]+\.js)(")/g, `$1$2?v=${v}$3`)
    .replace(/(<link[^>]*\bhref=")([^"?:]+\.css)(")/g, `$1$2?v=${v}$3`);
}

// Only on GitHub's servers while publishing (it changes files in place).
if (runningDirectly && !process.env.GITHUB_ACTIONS && !process.argv.includes('--force')) {
  console.error('This only runs while publishing on GitHub. (Use --force to run it anyway.)');
  process.exit(1);
}

let count = 0;
for await (const file of (runningDirectly ? walk(site) : [])) {
  if (!/\.(js|html)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  const out = stamp(text, version);
  if (out !== text) { await writeFile(file, out); count++; }
}
console.log(`Stamped ${count} files with version ${version}`);
