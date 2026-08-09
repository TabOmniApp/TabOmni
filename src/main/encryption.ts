import { safeStorage } from "electron"

/**
 * Encrypts a connection password for storage in `manifest.json`.
 *
 * `safeStorage` is OS-backed (Keychain, DPAPI, libsecret) but the result is
 * kept inline in our own file rather than in a separate keychain entry — one
 * file to back up, and no per-password OS prompt to manage. A prefix records
 * which path produced the value, so `decrypt` never has to guess.
 */
export function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // No OS-backed store on this machine (some Linux setups with no keyring).
    // Storing it in the clear would be worse than saying so plainly, so the
    // prefix that would otherwise mean "encrypted" is deliberately not used.
    return `plain:${Buffer.from(plain, "utf8").toString("base64")}`
  }
  return `enc:${safeStorage.encryptString(plain).toString("base64")}`
}

/** Reverses `encrypt`. Falls back to reading `stored` as plaintext for anything unrecognised. */
export function decrypt(stored: string): string {
  if (stored.startsWith("enc:")) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"))
  }
  if (stored.startsWith("plain:")) {
    return Buffer.from(stored.slice(6), "base64").toString("utf8")
  }
  return stored
}
