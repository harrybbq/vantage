/**
 * Passphrase encryption for the "export my data" file.
 *
 * The export used to be `JSON.stringify(S)` straight to a download —
 * about a megabyte of weight history, every meal, savings goals and
 * habits, sitting in the Downloads folder in the clear. A playtester
 * flagged it and he was right: this is the most personal data in the
 * app and it leaves the app the least protected.
 *
 * Nothing here is bespoke. PBKDF2-SHA256 to turn a passphrase into a
 * key, AES-GCM to encrypt, both from WebCrypto — no dependency, no
 * hand-rolled crypto, and the envelope records every parameter so a
 * future version can still open an old file.
 *
 * The passphrase never leaves the device and is not stored. That is the
 * point of it, and it is also why the UI has to say plainly that a lost
 * passphrase means a lost file.
 */

export const EXPORT_FORMAT = 'vantage-export';
export const EXPORT_VERSION = 1;

/**
 * OWASP's current floor for PBKDF2-SHA256. It costs roughly half a
 * second on a laptop and a second or two on a phone — which is the
 * whole idea, since the same cost applies to anyone guessing.
 */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;   // AES-GCM standard nonce length

function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('This browser cannot encrypt exports. Use the plain-text option instead.');
  }
  return c.subtle;
}

function toB64(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  // Chunked — String.fromCharCode(...a) blows the argument limit on a
  // megabyte of ciphertext.
  for (let i = 0; i < a.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await subtle().importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * @param payload    any JSON-serialisable value (the export envelope)
 * @param passphrase user's chosen passphrase
 * @returns an object safe to JSON.stringify into the downloaded file
 */
export async function encryptExport(payload, passphrase) {
  if (!passphrase) throw new Error('A passphrase is required.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    encrypted: true,
    // Everything needed to open it again, so the file is self-describing.
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    ciphertext: toB64(ciphertext),
  };
}

/**
 * Reverse of the above. Throws a message worth showing the user rather
 * than the browser's own opaque `OperationError`, because "wrong
 * passphrase" and "corrupt file" are indistinguishable to AES-GCM and
 * the first is overwhelmingly more likely.
 */
export async function decryptExport(envelope, passphrase) {
  if (!envelope || envelope.format !== EXPORT_FORMAT) {
    throw new Error('That does not look like a Vantage export.');
  }
  if (!envelope.encrypted) return envelope.data ?? envelope;
  if (!passphrase) throw new Error('A passphrase is required.');
  const { kdf, cipher, ciphertext } = envelope;
  if (kdf?.name !== 'PBKDF2' || cipher?.name !== 'AES-GCM') {
    throw new Error('This file uses a format this version cannot open.');
  }
  const key = await deriveKey(passphrase, fromB64(kdf.salt), kdf.iterations || PBKDF2_ITERATIONS);
  let plaintext;
  try {
    plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(cipher.iv) }, key, fromB64(ciphertext),
    );
  } catch {
    throw new Error('Wrong passphrase, or the file has been altered.');
  }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * A rough strength read for the passphrase field. Deliberately not a
 * gate — refusing to export someone's own data because a meter
 * disapproved would be worse than the weak passphrase.
 */
export function passphraseStrength(p = '') {
  if (!p) return { score: 0, label: '' };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 14) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const label = score <= 1 ? 'Weak' : score <= 3 ? 'Fair' : 'Strong';
  return { score: Math.min(4, score), label };
}
