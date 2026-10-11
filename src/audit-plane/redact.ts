import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Classify-and-redact stage. Regulated fields are replaced by deterministic
 * tokens (same value -> same token, so investigators can still correlate) and the
 * originals are sealed in an encrypted vault blob stored beside the event.
 * Reveal needs dual control (see store.reveal).
 */
const TOKEN_KEY = randomBytes(32);
const VAULT_KEY = randomBytes(32);
export const VAULT_KEY_ID = "vault-k1";

type Rule = { cls: string; pattern: RegExp };
const STRING_RULES: Rule[] = [
  { cls: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { cls: "email", pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi },
  { cls: "phone", pattern: /\+1-\d{3}-\d{3}-\d{4}/g },
];
const KEY_RULES: Record<string, string> = { date_of_birth: "dob", ssn: "ssn", email: "email", phone: "phone" };

export type ManifestEntry = { path: string; class: string; token: string; key_id: string };

function tokenFor(cls: string, value: string): string {
  const mac = createHmac("sha256", TOKEN_KEY).update(`${cls}:${value}`).digest("hex").slice(0, 8);
  return `tok_${cls}_${mac}`;
}

export function redact(payload: Record<string, unknown>): { payload: Record<string, unknown>; manifest: ManifestEntry[]; originals: Record<string, string> } {
  const manifest: ManifestEntry[] = [];
  const originals: Record<string, string> = {};

  const walk = (value: unknown, path: string, keyName?: string): unknown => {
    if (typeof value === "string") {
      let out = value;
      const keyCls = keyName ? KEY_RULES[keyName] : undefined;
      if (keyCls && out.length > 0) {
        const token = tokenFor(keyCls, out);
        manifest.push({ path, class: keyCls, token, key_id: VAULT_KEY_ID });
        originals[token] = out;
        return token;
      }
      for (const rule of STRING_RULES) {
        out = out.replace(rule.pattern, (m) => {
          const token = tokenFor(rule.cls, m);
          manifest.push({ path, class: rule.cls, token, key_id: VAULT_KEY_ID });
          originals[token] = m;
          return token;
        });
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = walk(v, `${path}.${k}`, k);
      return o;
    }
    return value;
  };

  return { payload: walk(payload, "payload") as Record<string, unknown>, manifest, originals };
}

export function sealVault(originals: Record<string, string>): string | undefined {
  if (Object.keys(originals).length === 0) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", VAULT_KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(originals), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function openVault(blob: string): Record<string, string> {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", VAULT_KEY, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
}

/** Highest data classification present, used to tag the event. */
export function classify(manifest: ManifestEntry[], declared: string): string {
  if (manifest.some((m) => m.class === "ssn" || m.class === "dob")) return "restricted";
  return declared;
}
