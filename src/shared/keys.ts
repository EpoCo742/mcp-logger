import { generateKeyPairSync, sign, verify, KeyObject, createPublicKey } from "node:crypto";

export type KeyPair = { keyId: string; privateKey: KeyObject; publicKey: KeyObject; publicPem: string };

/** Ed25519 keypair held in memory for the life of the process (an HSM / SVID stands in for this in production). */
export function makeKeyPair(keyId: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { keyId, privateKey, publicKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

export function signHex(kp: KeyPair, data: string): string {
  return sign(null, Buffer.from(data), kp.privateKey).toString("hex");
}

export function verifyHex(publicPem: string, data: string, sigHex: string): boolean {
  try {
    return verify(null, Buffer.from(data), createPublicKey(publicPem), Buffer.from(sigHex, "hex"));
  } catch {
    return false;
  }
}
