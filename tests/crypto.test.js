import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeyring, unlockKeyring, wrapKey, encryptJSON, decryptJSON, encryptBytes, decryptBytes,
  exportKey, importKey, generateDataKey, WrongPasswordError, DEFAULT_ITERATIONS,
} from '../site/assets/js/lib/crypto.js';

const FAST = 1000; // fewer rounds so tests run quickly

test('the real setting uses strong password stretching', () => {
  assert.ok(DEFAULT_ITERATIONS >= 600_000);
});

test('lock and unlock data with the family password', async () => {
  const { key, keyring } = await createKeyring('correct horse', FAST);
  const secret = { name: 'Елена Демова', note: 'Հովհաննես' };
  const box = await encryptJSON(key, secret);
  assert.ok(!box.includes('Демова'), 'ciphertext must not contain the plain text');
  const key2 = await unlockKeyring(keyring, 'correct horse');
  assert.deepEqual(await decryptJSON(key2, box), secret);
});

test('wrong password is refused', async () => {
  const { keyring } = await createKeyring('right', FAST);
  await assert.rejects(unlockKeyring(keyring, 'wrong'), WrongPasswordError);
});

test('wrong key cannot read data', async () => {
  const a = await generateDataKey();
  const b = await generateDataKey();
  const box = await encryptJSON(a, { x: 1 });
  await assert.rejects(decryptJSON(b, box), WrongPasswordError);
});

test('quick password change keeps the same data key', async () => {
  const { key, keyring } = await createKeyring('old', FAST);
  const box = await encryptJSON(key, { ok: true });
  const newRing = await wrapKey(key, 'new', FAST);
  await assert.rejects(unlockKeyring(newRing, 'old'), WrongPasswordError);
  const k = await unlockKeyring(newRing, 'new');
  assert.deepEqual(await decryptJSON(k, box), { ok: true });
  assert.notEqual(newRing.kdf.salt, keyring.kdf.salt);
});

test('binary files (photos) round-trip and are tamper-proof', async () => {
  const key = await generateDataKey();
  const bytes = new Uint8Array(5000).map((_, i) => i % 251);
  const locked = await encryptBytes(key, bytes);
  assert.deepEqual(await decryptBytes(key, locked), bytes);
  locked[100] ^= 1;
  await assert.rejects(decryptBytes(key, locked));
});

test('remembered key works after export/import', async () => {
  const key = await generateDataKey();
  const box = await encryptJSON(key, [1, 2, 3]);
  const again = await importKey(await exportKey(key));
  assert.deepEqual(await decryptJSON(again, box), [1, 2, 3]);
});

test('each encryption looks different (random IV)', async () => {
  const key = await generateDataKey();
  assert.notEqual(await encryptJSON(key, { a: 1 }), await encryptJSON(key, { a: 1 }));
});
