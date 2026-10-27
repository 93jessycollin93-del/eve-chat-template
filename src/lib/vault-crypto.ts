import { base64ToBytes, bytesToBase64, toArrayBuffer, utf8Decode, utf8Encode } from "./bytes";

/**
 * Vault encryption: PBKDF2-SHA256 turns the passphrase into an AES-GCM-256 key.
 * Each item gets a fresh random 96-bit IV. The key is non-extractable and only
 * ever lives in memory while the vault is unlocked.
 */

export const DEFAULT_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
const CHECK_PLAINTEXT = "sovereign-foundry-vault-check";

export interface Sealed {
  iv: string;
  ct: string;
}

export interface VaultMeta {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  cipher: "AES-GCM-256";
  check: Sealed;
  created: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(utf8Encode(passphrase)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(utf8Encode(plaintext)));
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function unseal(key: CryptoKey, sealed: Sealed): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(sealed.iv)) },
    key,
    toArrayBuffer(base64ToBytes(sealed.ct)),
  );
  return utf8Decode(new Uint8Array(pt));
}

export async function createVaultMeta(
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, iterations);
  const meta: VaultMeta = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    cipher: "AES-GCM-256",
    check: await seal(key, CHECK_PLAINTEXT),
    created: new Date().toISOString(),
  };
  return { meta, key };
}

/** Derives the key and proves it is right by decrypting the check value. */
export async function unlockVault(meta: VaultMeta, passphrase: string): Promise<CryptoKey> {
  const key = await deriveKey(passphrase, base64ToBytes(meta.salt), meta.iterations);
  try {
    if ((await unseal(key, meta.check)) !== CHECK_PLAINTEXT) throw new WrongPassphraseError();
  } catch {
    throw new WrongPassphraseError();
  }
  return key;
}

export function isVaultMeta(value: unknown): value is VaultMeta {
  const v = value as VaultMeta | null;
  return !!v && v.v === 1 && v.kdf === "PBKDF2-SHA256" && typeof v.salt === "string" && !!v.check;
}

/** Rough strength estimate in bits, for the setup screen. */
export function passphraseBits(p: string): number {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  const unique = new Set(p).size;
  return Math.round(Math.log2(Math.max(pool, 2)) * Math.min(p.length, unique * 2));
}
