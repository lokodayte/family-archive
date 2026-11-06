// Encryption for family-only data. Runs entirely in the browser (and in Node for tests).
//
// How it works, in plain words:
// - There is one random "data key" that locks all family files (AES-256-GCM).
// - The family password is turned into a second key (PBKDF2, 600,000 rounds),
//   which locks the data key. The locked data key is stored in config.json.
// - Quick password change = lock the same data key with the new password.
// - Full re-lock = make a brand-new data key and re-lock every family file.

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DEFAULT_ITERATIONS = 600_000;

export class WrongPasswordError extends Error {
  constructor() { super('Wrong family password'); this.name = 'WrongPasswordError'; }
}

// ---------- base64 ----------
export function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
export function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---------- gzip (makes encrypted files much smaller) ----------
async function streamThrough(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (bytes) => streamThrough(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => streamThrough(bytes, new DecompressionStream('gzip'));

// ---------- keys ----------
async function deriveWrappingKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateDataKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Lock a data key with a password. Returns the "keyring" object stored in config.json. */
export async function wrapKey(dataKey, password, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapping = await deriveWrappingKey(password, salt, iterations);
  const raw = new Uint8Array(await subtle.exportKey('raw', dataKey));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, wrapping, raw));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    wrapped: { iv: toBase64(iv), ct: toBase64(ct) },
  };
}

/** First-time setup: make a data key and lock it with the password. */
export async function createKeyring(password, iterations = DEFAULT_ITERATIONS) {
  const key = await generateDataKey();
  const keyring = await wrapKey(key, password, iterations);
  return { key, keyring };
}

/** Unlock the data key with the family password. Throws WrongPasswordError. */
export async function unlockKeyring(keyring, password) {
  const wrapping = await deriveWrappingKey(password, fromBase64(keyring.kdf.salt), keyring.kdf.iterations);
  let raw;
  try {
    raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(keyring.wrapped.iv) }, wrapping, fromBase64(keyring.wrapped.ct));
  } catch {
    throw new WrongPasswordError();
  }
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** For "remember on this device": the unlocked key as text. */
export async function exportKey(key) {
  return toBase64(new Uint8Array(await subtle.exportKey('raw', key)));
}
export async function importKey(b64) {
  return subtle.importKey('raw', fromBase64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---------- data ----------
const MAGIC = [0x46, 0x41, 0x31]; // "FA1"

/** Encrypt raw bytes (used for photos). Output: "FA1" + 12-byte IV + ciphertext. */
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(3 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 3);
  out.set(ct, 15);
  return out;
}

export async function decryptBytes(key, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2]) {
    throw new Error('Not an encrypted archive file');
  }
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(3, 15) }, key, bytes.subarray(15)));
  } catch {
    throw new WrongPasswordError();
  }
}

/** Encrypt any JSON value into a text file's contents. */
export async function encryptJSON(key, value) {
  const iv = randomBytes(12);
  const packed = await gzip(encoder.encode(JSON.stringify(value)));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, packed));
  return JSON.stringify({ v: 1, z: 1, iv: toBase64(iv), ct: toBase64(ct) });
}

export async function decryptJSON(key, text) {
  const box = typeof text === 'string' ? JSON.parse(text) : text;
  let plain;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.ct)));
  } catch {
    throw new WrongPasswordError();
  }
  if (box.z) plain = await gunzip(plain);
  return JSON.parse(decoder.decode(plain));
}
