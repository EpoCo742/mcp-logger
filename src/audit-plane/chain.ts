import { sha256Hex } from "../shared/canonical.js";

/** entry_hash links each stored record to its predecessor in the stream. */
export function entryHash(prevHash: string, payloadHash: string, storedPayloadHash: string, eventId: string, occurredAt: string): string {
  return sha256Hex(`${prevHash}|${payloadHash}|${storedPayloadHash}|${eventId}|${occurredAt}`);
}

export const GENESIS = "0".repeat(64);

function pair(a: string, b: string): string {
  return sha256Hex(`${a}${b}`);
}

/** Merkle root over the leaves (odd leaf is paired with itself, as in RFC 6962-style POCs). */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return GENESIS;
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(pair(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}

export type ProofStep = { hash: string; side: "left" | "right" };

/** Inclusion proof for leaves[index]: the sibling path up to the root. */
export function merkleProof(leaves: string[], index: number): ProofStep[] {
  const proof: ProofStep[] = [];
  let level = [...leaves];
  let i = index;
  while (level.length > 1) {
    const isRight = i % 2 === 1;
    const sibling = isRight ? level[i - 1] : (level[i + 1] ?? level[i]);
    proof.push({ hash: sibling, side: isRight ? "left" : "right" });
    const next: string[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(pair(level[j], level[j + 1] ?? level[j]));
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: string, proof: ProofStep[], root: string): boolean {
  let h = leaf;
  for (const step of proof) h = step.side === "left" ? pair(step.hash, h) : pair(h, step.hash);
  return h === root;
}
