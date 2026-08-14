import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./config.js";

// AES-256-GCM: cifra + autenticação num único passo. Usada para guardar
// credenciais de canal (tokens, senhas de app, API keys) em repouso.
// A chave-mestra vem de env (CREDENTIALS_ENCRYPTION_KEY, base64 de 32 bytes)
// e nunca deve ser commitada — em produção vive num secrets manager.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getMasterKey(): Buffer {
  const key = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY deve decodificar para exatamente 32 bytes (gere com: openssl rand -base64 32)",
    );
  }
  return key;
}

/**
 * Criptografa uma string arbitrária (normalmente JSON.stringify de credenciais)
 * e retorna um payload único em base64: iv || authTag || ciphertext.
 */
export function encryptCredentials(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptCredentials(payload: string): string {
  const key = getMasterKey();
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + 16);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
