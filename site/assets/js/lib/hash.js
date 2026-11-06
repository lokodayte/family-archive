// Git identifies every file by a "blob id": SHA-1 of "blob <size>\0" + the bytes.
// Comparing ids tells us whether a copy of a file (e.g. from the published site)
// is exactly the latest version, without downloading it from GitHub again.

export async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header, 0);
  all.set(bytes, header.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
