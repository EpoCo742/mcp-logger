import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashOf, nowIso, shortId } from "../shared/canonical.js";
import { CHECKPOINT_MAX_EVENTS, DATA_DIR } from "../shared/config.js";
import { makeKeyPair, signHex, verifyHex } from "../shared/keys.js";
import { AIAuditEvent } from "../shared/types.js";
import { GENESIS, entryHash, merkleProof, merkleRoot, verifyProof, type ProofStep } from "./chain.js";
import { classify, openVault, redact, sealVault } from "./redact.js";

export type StoredEvent = AIAuditEvent & {
  record: "event";
  stored_payload_hash: string;
  signature_verified: boolean;
  vault?: string;
};

export type CheckpointRecord = {
  record: "checkpoint";
  checkpoint_id: string;
  stream_id: string;
  from_seq: number;
  to_seq: number;
  leaf_count: number;
  root: string;
  prev_root: string;
  created_at: string;
  signature: { key_id: string; alg: "Ed25519"; sig: string };
  anchor: { tsa: string; key_id: string; timestamp: string; token: string };
};

type StreamState = {
  stream_id: string;
  seq: number;
  lastHash: string;
  lastRoot: string;
  pending: string[];
  pendingFrom: number;
  checkpoints: CheckpointRecord[];
};

export type InteractionSummary = {
  interaction_id: string;
  surface: string;
  consumer_org?: string;
  consumer_system?: string;
  operator?: string;
  principal?: string;
  started_at: string;
  completed_at?: string;
  outcome?: string;
  request_summary?: string;
  retention_class?: string;
  steps: number;
  tool_calls: number;
  model_calls: number;
  denied: number;
  approvals: number;
  guardrails: number;
  gaps: number;
  events: number;
};

const ARCHIVE_DIR = join(DATA_DIR, "archive");

/**
 * The Audit Plane store: validate -> verify producer signature -> classify and
 * redact -> hash-chain per stream -> append to WORM-style archive -> hot index.
 * Checkpoints batch entry hashes into a Merkle tree, sign the root and anchor it
 * with a (simulated) RFC 3161 timestamp authority.
 */
export class AuditStore {
  readonly auditKey = makeKeyPair("audit-plane-hsm-k1");
  readonly tsaKey = makeKeyPair("poc-tsa-k1");
  readonly producerKeys = new Map<string, { public_pem: string; point: string }>();
  outage = false;
  readonly ingestedTotal = { accepted: 0, rejected: 0 };
  readonly rejections: { at: string; error: string; event_type?: string; key_id?: string }[] = [];

  private streams = new Map<string, StreamState>();
  private hot: StoredEvent[] = [];
  private byInteraction = new Map<string, StoredEvent[]>();
  private byEventId = new Map<string, StoredEvent>();
  private accessLog: StoredEvent[] = [];

  constructor(fresh = true) {
    if (fresh && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  registerKey(keyId: string, publicPem: string, point: string) {
    this.producerKeys.set(keyId, { public_pem: publicPem, point });
  }

  private streamIdFor(ev: AIAuditEvent): string {
    return `${ev.identity.consumer_org ?? "platform"}:${ev.occurred_at.slice(0, 10)}`;
  }

  private archivePath(streamId: string): string {
    return join(ARCHIVE_DIR, `${streamId.replace(/[^a-zA-Z0-9_.-]/g, "_")}.jsonl`);
  }

  private stream(streamId: string): StreamState {
    let s = this.streams.get(streamId);
    if (!s) {
      s = { stream_id: streamId, seq: 0, lastHash: GENESIS, lastRoot: GENESIS, pending: [], pendingFrom: 1, checkpoints: [] };
      this.streams.set(streamId, s);
    }
    return s;
  }

  /** Verify the producer signature over the event as the producer built it. */
  private verifyProducerSignature(ev: AIAuditEvent): boolean {
    const key = this.producerKeys.get(ev.producer_signature.key_id);
    if (!key) return false;
    const { producer_signature, stream_id: _a, seq: _b, prev_hash: _c, entry_hash: _d, ingested_at: _e, redaction_manifest: _f, retention_class: _g, ...base } = ev;
    return verifyHex(key.public_pem, hashOf(base), producer_signature.sig);
  }

  ingest(raw: unknown): { ok: true; event: StoredEvent } | { ok: false; status: number; error: string } {
    const r = this.ingestInner(raw);
    if (!r.ok && r.status !== 503) {
      const e = raw as { event_type?: string; producer_signature?: { key_id?: string } } | undefined;
      this.rejections.push({ at: nowIso(), error: r.error, event_type: e?.event_type, key_id: e?.producer_signature?.key_id });
      if (this.rejections.length > 20) this.rejections.shift();
    }
    return r;
  }

  private ingestInner(raw: unknown): { ok: true; event: StoredEvent } | { ok: false; status: number; error: string } {
    if (this.outage) return { ok: false, status: 503, error: "audit plane outage (simulated)" };
    const parsed = AIAuditEvent.safeParse(raw);
    if (!parsed.success) {
      this.ingestedTotal.rejected++;
      return { ok: false, status: 400, error: `schema: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}` };
    }
    const ev = parsed.data;
    if (this.byEventId.has(ev.event_id)) return { ok: true, event: this.byEventId.get(ev.event_id)! }; // idempotent replay
    if (hashOf(ev.payload) !== ev.payload_hash) {
      this.ingestedTotal.rejected++;
      return { ok: false, status: 400, error: "payload_hash does not match payload" };
    }
    const signature_verified = this.verifyProducerSignature(ev);
    if (!signature_verified) {
      this.ingestedTotal.rejected++;
      return { ok: false, status: 401, error: `producer signature invalid or key unknown (${ev.producer_signature.key_id})` };
    }

    const { payload, manifest, originals } = redact(ev.payload);
    const stored_payload_hash = hashOf(payload);
    const streamId = this.streamIdFor(ev);
    const s = this.stream(streamId);
    s.seq += 1;
    const entry = entryHash(s.lastHash, ev.payload_hash, stored_payload_hash, ev.event_id, ev.occurred_at);
    const stored: StoredEvent = {
      ...ev,
      record: "event",
      payload,
      data_classification: classify(manifest, ev.data_classification) as AIAuditEvent["data_classification"],
      redaction_manifest: manifest,
      stream_id: streamId,
      seq: s.seq,
      prev_hash: s.lastHash,
      entry_hash: entry,
      ingested_at: nowIso(),
      stored_payload_hash,
      signature_verified,
      vault: sealVault(originals),
    };
    if (ev.event_type === "interaction.completed" && typeof ev.payload.retention_class === "string") {
      stored.retention_class = ev.payload.retention_class;
      for (const e of this.byInteraction.get(ev.spine.interaction_id) ?? []) e.retention_class = stored.retention_class;
    }
    appendFileSync(this.archivePath(streamId), JSON.stringify(stored) + "\n");
    s.lastHash = entry;
    s.pending.push(entry);
    this.index(stored);
    this.ingestedTotal.accepted++;
    if (s.pending.length >= CHECKPOINT_MAX_EVENTS) this.checkpoint(streamId);
    return { ok: true, event: stored };
  }

  private index(stored: StoredEvent) {
    this.hot.push(stored);
    this.byEventId.set(stored.event_id, stored);
    const list = this.byInteraction.get(stored.spine.interaction_id) ?? [];
    list.push(stored);
    this.byInteraction.set(stored.spine.interaction_id, list);
  }

  /** Batch pending entry hashes into a signed, anchored checkpoint. */
  checkpoint(streamId: string): CheckpointRecord | undefined {
    const s = this.streams.get(streamId);
    if (!s || s.pending.length === 0) return undefined;
    const root = merkleRoot(s.pending);
    const created_at = nowIso();
    const to_seq = s.seq;
    const from_seq = s.pendingFrom;
    const signedBody = `${streamId}|${from_seq}|${to_seq}|${root}|${s.lastRoot}`;
    const anchorTime = nowIso();
    const cp: CheckpointRecord = {
      record: "checkpoint",
      checkpoint_id: shortId("cp"),
      stream_id: streamId,
      from_seq,
      to_seq,
      leaf_count: s.pending.length,
      root,
      prev_root: s.lastRoot,
      created_at,
      signature: { key_id: this.auditKey.keyId, alg: "Ed25519", sig: signHex(this.auditKey, signedBody) },
      anchor: { tsa: "poc-timestamp-authority", key_id: this.tsaKey.keyId, timestamp: anchorTime, token: signHex(this.tsaKey, `${root}|${anchorTime}`) },
    };
    appendFileSync(this.archivePath(streamId), JSON.stringify(cp) + "\n");
    s.checkpoints.push(cp);
    s.lastRoot = root;
    s.pending = [];
    s.pendingFrom = to_seq + 1;
    return cp;
  }

  checkpointAll(): CheckpointRecord[] {
    return [...this.streams.keys()].map((id) => this.checkpoint(id)).filter((c): c is CheckpointRecord => !!c);
  }

  checkpoints(): CheckpointRecord[] {
    return [...this.streams.values()].flatMap((s) => s.checkpoints);
  }

  streamsInfo() {
    return [...this.streams.values()].map((s) => ({ stream_id: s.stream_id, events: s.seq, checkpoints: s.checkpoints.length, pending: s.pending.length, head: s.lastHash }));
  }

  // ---- hot index reads (redacted view) ----

  private strip(e: StoredEvent): Omit<StoredEvent, "vault"> {
    const { vault: _v, ...rest } = e;
    return rest;
  }

  recent(limit = 200) {
    return this.hot.slice(-limit).reverse().map((e) => this.strip(e));
  }

  interaction(id: string) {
    return (this.byInteraction.get(id) ?? []).map((e) => this.strip(e));
  }

  event(id: string) {
    const e = this.byEventId.get(id);
    return e ? this.strip(e) : undefined;
  }

  summaries(): InteractionSummary[] {
    const out: InteractionSummary[] = [];
    for (const [id, events] of this.byInteraction) {
      const first = events[0];
      const started = events.find((e) => e.event_type === "interaction.started");
      const completed = events.find((e) => e.event_type === "interaction.completed");
      const pick = (k: "consumer_org" | "consumer_system" | "operator" | "principal") => events.map((e) => e.identity[k]).find((v) => !!v);
      out.push({
        interaction_id: id,
        surface: first.surface,
        consumer_org: pick("consumer_org"),
        consumer_system: pick("consumer_system"),
        operator: pick("operator"),
        principal: pick("principal"),
        started_at: started?.occurred_at ?? first.occurred_at,
        completed_at: completed?.occurred_at,
        outcome: completed ? String(completed.payload.outcome ?? "") : undefined,
        request_summary: started ? String(started.payload.request_summary ?? "") : undefined,
        retention_class: completed?.retention_class ?? events.find((e) => e.retention_class)?.retention_class,
        steps: Math.max(0, ...events.map((e) => e.spine.step_seq)),
        tool_calls: events.filter((e) => e.event_type === "tool.called").length,
        model_calls: events.filter((e) => e.event_type === "model.called").length,
        denied: events.filter((e) => e.event_type === "tool.called" && (e.payload.policy as { decision?: string } | undefined)?.decision === "deny").length,
        approvals: events.filter((e) => e.event_type === "approval.requested").length,
        guardrails: events.filter((e) => e.event_type === "guardrail.triggered").length,
        gaps: events.filter((e) => e.event_type === "audit.gap").length,
        events: events.length,
      });
    }
    return out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  }

  // ---- integrity ----

  private readArchive(streamId: string): (StoredEvent | CheckpointRecord)[] {
    const p = this.archivePath(streamId);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }

  /** The continuous verification job: walk every archive, recompute the chain, check every checkpoint and anchor. */
  verify() {
    const results = [] as {
      stream_id: string;
      ok: boolean;
      events: number;
      checkpoints: number;
      anchored_through_seq: number;
      problems: { seq?: number; event_id?: string; checkpoint_id?: string; kind: string; detail: string }[];
    }[];
    for (const file of readdirSync(ARCHIVE_DIR)) {
      const streamIdGuess = file.replace(/\.jsonl$/, "");
      const records = this.readArchive(streamIdGuess);
      const problems: (typeof results)[number]["problems"] = [];
      let prev = GENESIS;
      let prevRoot = GENESIS;
      let leaves: string[] = [];
      let anchoredThrough = 0;
      let streamId = streamIdGuess;
      let events = 0;
      let checkpoints = 0;
      for (const rec of records) {
        if (rec.record === "event") {
          events++;
          streamId = rec.stream_id ?? streamId;
          const storedHash = hashOf(rec.payload);
          if (storedHash !== rec.stored_payload_hash) problems.push({ seq: rec.seq, event_id: rec.event_id, kind: "payload_modified", detail: `stored payload hash ${storedHash.slice(0, 12)} != recorded ${rec.stored_payload_hash.slice(0, 12)}` });
          if (rec.prev_hash !== prev) problems.push({ seq: rec.seq, event_id: rec.event_id, kind: "chain_break", detail: `prev_hash does not match previous entry (missing or reordered record)` });
          const expect = entryHash(rec.prev_hash ?? "", rec.payload_hash, storedHash, rec.event_id, rec.occurred_at);
          if (expect !== rec.entry_hash) problems.push({ seq: rec.seq, event_id: rec.event_id, kind: "entry_hash_mismatch", detail: `recomputed entry hash differs` });
          prev = rec.entry_hash ?? prev;
          leaves.push(expect); // recomputed, so a modified record also breaks the Merkle root
        } else {
          checkpoints++;
          const root = merkleRoot(leaves);
          if (root !== rec.root) problems.push({ checkpoint_id: rec.checkpoint_id, kind: "merkle_root_mismatch", detail: `recomputed root over seq ${rec.from_seq}-${rec.to_seq} differs from signed root` });
          const body = `${rec.stream_id}|${rec.from_seq}|${rec.to_seq}|${rec.root}|${rec.prev_root}`;
          if (!verifyHex(this.auditKey.publicPem, body, rec.signature.sig)) problems.push({ checkpoint_id: rec.checkpoint_id, kind: "checkpoint_signature_invalid", detail: "audit plane signature does not verify" });
          if (!verifyHex(this.tsaKey.publicPem, `${rec.root}|${rec.anchor.timestamp}`, rec.anchor.token)) problems.push({ checkpoint_id: rec.checkpoint_id, kind: "anchor_invalid", detail: "timestamp authority token does not verify" });
          if (rec.prev_root !== prevRoot) problems.push({ checkpoint_id: rec.checkpoint_id, kind: "checkpoint_chain_break", detail: "prev_root does not match previous checkpoint" });
          prevRoot = rec.root;
          anchoredThrough = rec.to_seq;
          leaves = [];
        }
      }
      results.push({ stream_id: streamId, ok: problems.length === 0, events, checkpoints, anchored_through_seq: anchoredThrough, problems });
    }
    return { ok: results.every((r) => r.ok), verified_at: nowIso(), streams: results };
  }

  /** Export an interaction with inclusion proofs so a third party can verify offline. */
  exportInteraction(interactionId: string, requestedBy: string) {
    const events = this.byInteraction.get(interactionId) ?? [];
    const proofs: { event_id: string; seq: number; checkpoint_id?: string; leaf: string; proof?: ProofStep[]; root?: string; verifies?: boolean; note?: string }[] = [];
    const checkpointsUsed = new Map<string, CheckpointRecord>();
    for (const ev of events) {
      const s = this.streams.get(ev.stream_id!);
      const cp = s?.checkpoints.find((c) => ev.seq! >= c.from_seq && ev.seq! <= c.to_seq);
      if (!cp) {
        proofs.push({ event_id: ev.event_id, seq: ev.seq!, leaf: ev.entry_hash!, note: "not yet checkpointed; included at the next checkpoint" });
        continue;
      }
      const leaves = this.readArchive(ev.stream_id!)
        .filter((r): r is StoredEvent => r.record === "event" && r.seq! >= cp.from_seq && r.seq! <= cp.to_seq)
        .map((r) => r.entry_hash!);
      const idx = ev.seq! - cp.from_seq;
      const proof = merkleProof(leaves, idx);
      checkpointsUsed.set(cp.checkpoint_id, cp);
      proofs.push({ event_id: ev.event_id, seq: ev.seq!, checkpoint_id: cp.checkpoint_id, leaf: ev.entry_hash!, proof, root: cp.root, verifies: verifyProof(ev.entry_hash!, proof, cp.root) });
    }
    this.logAccess("export", requestedBy, { interaction_id: interactionId, events: events.length });
    return {
      exported_at: nowIso(),
      interaction_id: interactionId,
      events: events.map((e) => this.strip(e)),
      proofs,
      checkpoints: [...checkpointsUsed.values()],
      keys: { audit_plane: { key_id: this.auditKey.keyId, public_pem: this.auditKey.publicPem }, tsa: { key_id: this.tsaKey.keyId, public_pem: this.tsaKey.publicPem }, producers: Object.fromEntries(this.producerKeys) },
      how_to_verify: "For each event: recompute entry_hash, apply proof to reach root, check root == checkpoint.root, verify checkpoint.signature with audit_plane key and anchor.token with tsa key.",
    };
  }

  /** Dual-control reveal of tokenised values. */
  reveal(eventId: string, approvers: string[]) {
    const ev = this.byEventId.get(eventId);
    if (!ev) return { ok: false as const, error: "event not found" };
    const uniq = new Set(approvers.filter(Boolean));
    if (uniq.size < 2) return { ok: false as const, error: "dual control: two distinct approvers required" };
    const originals = ev.vault ? openVault(ev.vault) : {};
    this.logAccess("reveal", [...uniq].join("+"), { event_id: eventId, fields: ev.redaction_manifest?.map((m) => m.path) ?? [] });
    return { ok: true as const, event_id: eventId, revealed: originals, manifest: ev.redaction_manifest ?? [] };
  }

  /** Every read of the audit record that leaves the platform is itself audited. */
  private logAccess(kind: string, actor: string, detail: Record<string, unknown>) {
    const payload = { kind, actor, ...detail };
    const base = {
      event_id: shortId("evt"),
      event_type: "audit.access" as const,
      schema_version: "1.0",
      occurred_at: nowIso(),
      emitter: { point: "AUDIT" as const, instance: "audit-plane-1" },
      surface: "admin" as const,
      spine: { interaction_id: `audit-access:${nowIso().slice(0, 10)}`, trace_id: "0".repeat(32), span_id: "0".repeat(16), step_seq: 0 },
      identity: { operator: actor, firm_service: "audit-plane", links: [{ link: "operator" as const, value: actor, method: "sso", result: "verified" as const }] },
      data_classification: "internal" as const,
      payload,
      payload_hash: hashOf(payload),
    };
    const sig = signHex(this.auditKey, hashOf(base));
    const ev: AIAuditEvent = { ...base, producer_signature: { key_id: this.auditKey.keyId, alg: "Ed25519", sig } };
    if (!this.producerKeys.has(this.auditKey.keyId)) this.registerKey(this.auditKey.keyId, this.auditKey.publicPem, "AUDIT");
    const r = this.ingest(ev);
    if (r.ok) this.accessLog.push(r.event);
  }

  accesses() {
    return this.accessLog.map((e) => this.strip(e));
  }

  /** DEMO ONLY: simulate an insider editing the archive directly on disk, bypassing the ingest API. */
  tamper(eventId?: string): { ok: boolean; detail: string; event_id?: string; stream_id?: string } {
    const target = eventId ? this.byEventId.get(eventId) : [...this.byEventId.values()].reverse().find((e) => e.event_type === "tool.called" && (e.payload.result as unknown) !== undefined) ?? this.hot.at(-1);
    if (!target) return { ok: false, detail: "no event to tamper with" };
    const path = this.archivePath(target.stream_id!);
    const lines = readFileSync(path, "utf8").split("\n");
    const idx = lines.findIndex((l) => l.includes(`"event_id":"${target.event_id}"`));
    if (idx < 0) return { ok: false, detail: "event not found in archive" };
    const rec = JSON.parse(lines[idx]) as StoredEvent;
    const change = mutateFirstNumber(rec.payload) ?? "appended note";
    if (change === "appended note") (rec.payload as Record<string, unknown>).__edited = "value changed after the fact";
    lines[idx] = JSON.stringify(rec);
    writeFileSync(path, lines.join("\n"));
    return { ok: true, detail: `archive record for ${target.event_id} edited on disk: ${change}`, event_id: target.event_id, stream_id: target.stream_id };
  }

  status() {
    return { outage: this.outage, accepted: this.ingestedTotal.accepted, rejected: this.ingestedTotal.rejected, recent_rejections: this.rejections.slice(-5), streams: this.streamsInfo(), producers: [...this.producerKeys.entries()].map(([k, v]) => ({ key_id: k, point: v.point })) };
  }
}

function mutateFirstNumber(obj: unknown, path = "payload"): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "number" && v !== 0 && !["step_seq", "duration_ms", "seq"].includes(k)) {
      (obj as Record<string, unknown>)[k] = v * 10;
      return `${path}.${k}: ${v} -> ${v * 10}`;
    }
    if (v && typeof v === "object") {
      const r = mutateFirstNumber(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return undefined;
}
