import { hashOf, nowIso, shortId } from "./canonical.js";
import { makeKeyPair, signHex, type KeyPair } from "./keys.js";
import { SCHEMA_VERSION, URLS } from "./config.js";
import { type AIAuditEvent, type EmitterPoint, type EventInput } from "./types.js";

export class AuditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditUnavailableError";
  }
}

export type EmitResult = { ok: true; event: AIAuditEvent; durable: boolean };

/**
 * The platform SDK every enforcement point uses. It signs events with the
 * workload identity key, sends them to the Audit Plane, and implements the
 * fail-closed / fail-open-with-gap rules from the standard.
 */
export class AuditClient {
  readonly keyPair: KeyPair;
  private buffer: AIAuditEvent[] = [];
  private replaying = false;
  private registered = false;

  constructor(
    readonly point: EmitterPoint,
    readonly instance: string,
    private readonly auditUrl: string = URLS.audit,
  ) {
    this.keyPair = makeKeyPair(`${point}-${instance}`);
    setInterval(() => void this.replay(), 1500).unref();
  }

  /** Register the producer public key with the Audit Plane so signatures can be verified. */
  async register(): Promise<void> {
    if (this.registered) return;
    try {
      const res = await fetch(`${this.auditUrl}/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key_id: this.keyPair.keyId, public_pem: this.keyPair.publicPem, point: this.point }),
        signal: AbortSignal.timeout(2000),
      });
      this.registered = res.ok;
    } catch {
      /* retried on next emit */
    }
  }

  /** Build a signed event without sending it. */
  build(input: EventInput): AIAuditEvent {
    const payload_hash = hashOf(input.payload);
    const base = {
      event_id: input.event_id ?? shortId("evt"),
      event_type: input.event_type,
      schema_version: SCHEMA_VERSION,
      occurred_at: input.occurred_at ?? nowIso(),
      emitter: { point: this.point, instance: this.instance },
      surface: input.surface,
      spine: input.spine,
      identity: input.identity,
      data_classification: input.data_classification ?? "confidential",
      payload: input.payload,
      payload_hash,
    };
    const sig = signHex(this.keyPair, hashOf(base));
    return { ...base, producer_signature: { key_id: this.keyPair.keyId, alg: "Ed25519", sig } };
  }

  /**
   * Emit an event. With durable=true the call waits for the Audit Plane's durable
   * acknowledgement and throws AuditUnavailableError if it cannot be obtained
   * (used before execute and propose actions: fail-closed). With durable=false
   * (read paths) the client tries once, then buffers locally, records an audit.gap
   * and replays later (fail-open with alarm).
   */
  async emit(input: EventInput, opts: { durable?: boolean } = {}): Promise<EmitResult> {
    await this.register();
    const event = this.build(input);
    const sent = await this.send(event);
    if (sent.ok) return { ok: true, event, durable: true };
    if (opts.durable) {
      this.recordGap(event, sent.error, "blocked");
      throw new AuditUnavailableError(`audit plane unavailable (${sent.error}); action blocked (fail-closed)`);
    }
    this.buffer.push(event);
    this.recordGap(event, sent.error, "buffered");
    return { ok: true, event, durable: false };
  }

  private recordGap(event: AIAuditEvent, cause: string, disposition: "buffered" | "blocked") {
    const gap = this.build({
      event_type: "audit.gap",
      surface: event.surface,
      spine: event.spine,
      identity: event.identity,
      data_classification: "internal",
      payload: { missing_event_id: event.event_id, missing_event_type: event.event_type, cause, disposition },
    });
    this.buffer.push(gap);
  }

  private async send(event: AIAuditEvent): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
    try {
      const res = await fetch(`${this.auditUrl}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { ok: false, error: `http ${res.status}`, status: res.status };
      const body = (await res.json()) as { durable?: boolean };
      return body.durable ? { ok: true } : { ok: false, error: "not durable" };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Replay buffered events in order once the Audit Plane is reachable again. */
  private async replay(): Promise<void> {
    if (this.replaying || this.buffer.length === 0) return;
    this.replaying = true;
    try {
      this.registered = false;
      await this.register();
      while (this.buffer.length > 0) {
        const r = await this.send(this.buffer[0]);
        if (!r.ok && r.status !== undefined && r.status < 500) {
          // Permanently rejected (schema or signature problem): a producer defect, not an outage.
          // Drop it so the rest of the buffer can drain; the audit plane keeps the rejection record.
          this.buffer.shift();
          continue;
        }
        if (!r.ok) break;
        this.buffer.shift();
      }
    } finally {
      this.replaying = false;
    }
  }

  get buffered(): number {
    return this.buffer.length;
  }
}
