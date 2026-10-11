import { z } from "zod";

/** Enforcement points and supporting emitters. */
export const EmitterPoint = z.enum(["EP1", "EP2", "EP3", "EP4", "SOR", "AUDIT", "ADMIN"]);
export type EmitterPoint = z.infer<typeof EmitterPoint>;

export const Surface = z.enum(["mcp", "assistant", "agent", "api", "admin"]);
export type Surface = z.infer<typeof Surface>;

export const ActionClass = z.enum(["read", "derive", "propose", "execute"]);
export type ActionClass = z.infer<typeof ActionClass>;

export const TrustClass = z.enum([
  "firm_record",
  "firm_derived",
  "consumer_supplied",
  "public_web",
  "model_generated",
]);
export type TrustClass = z.infer<typeof TrustClass>;

export const EventType = z.enum([
  "interaction.started",
  "interaction.completed",
  "plan.created",
  "context.assembled",
  "model.called",
  "tool.called",
  "approval.requested",
  "approval.decided",
  "guardrail.triggered",
  "response.rendered",
  "audit.gap",
  "audit.access",
  "audit.checkpoint",
  "audit.verification",
]);
export type EventType = z.infer<typeof EventType>;

export const DataClassification = z.enum(["public", "internal", "confidential", "restricted"]);

/** Provenance stamp attached by EP4 to every value returned to a model or MCP client. */
export const ProvenanceStamp = z.object({
  stamp_id: z.string(),
  source_system: z.string(),
  record_ref: z.string(),
  as_of: z.string(),
  content_hash: z.string(),
  tool_span: z.string(), // event_id of the tool.called event that fetched it
  trust_class: TrustClass,
  access_basis: z.string(),
  injection_verdict: z.enum(["clean", "suspicious", "blocked"]).optional(),
});
export type ProvenanceStamp = z.infer<typeof ProvenanceStamp>;

export const IdentityLink = z.object({
  link: z.enum(["consumer_org", "consumer_system", "operator", "principal", "firm_agent", "firm_service"]),
  value: z.string(),
  method: z.string(),
  result: z.enum(["verified", "asserted", "failed"]),
});

export const IdentityChain = z.object({
  consumer_org: z.string().optional(),
  consumer_system: z.string().optional(),
  operator: z.string().optional(),
  principal: z.string().optional(),
  firm_agent: z.string().optional(),
  firm_service: z.string(),
  links: z.array(IdentityLink),
});
export type IdentityChain = z.infer<typeof IdentityChain>;

export const Spine = z.object({
  interaction_id: z.string(),
  trace_id: z.string(),
  span_id: z.string(),
  parent_span_id: z.string().optional(),
  step_seq: z.number().int().nonnegative(),
  consumer_ref: z.string().optional(),
});
export type Spine = z.infer<typeof Spine>;

/** The canonical envelope every enforcement point emits. */
export const AIAuditEvent = z.object({
  event_id: z.string(),
  event_type: EventType,
  schema_version: z.string(),
  occurred_at: z.string(),
  emitter: z.object({ point: EmitterPoint, instance: z.string() }),
  surface: Surface,
  spine: Spine,
  identity: IdentityChain,
  data_classification: DataClassification,
  payload: z.record(z.unknown()),
  payload_hash: z.string(),
  producer_signature: z.object({ key_id: z.string(), alg: z.literal("Ed25519"), sig: z.string() }),
  // Set by the Audit Plane at ingest:
  stream_id: z.string().optional(),
  seq: z.number().int().optional(),
  prev_hash: z.string().optional(),
  entry_hash: z.string().optional(),
  ingested_at: z.string().optional(),
  redaction_manifest: z
    .array(z.object({ path: z.string(), class: z.string(), token: z.string(), key_id: z.string() }))
    .optional(),
  retention_class: z.string().optional(),
});
export type AIAuditEvent = z.infer<typeof AIAuditEvent>;

/** Fields a producer supplies; the audit client fills in the rest. */
export type EventInput = {
  event_type: EventType;
  surface: Surface;
  spine: Spine;
  identity: IdentityChain;
  data_classification?: z.infer<typeof DataClassification>;
  payload: Record<string, unknown>;
  occurred_at?: string;
  event_id?: string;
};

/** Context propagated between hops as headers. */
export const CTX_HEADERS = {
  interactionId: "x-ai-interaction-id",
  traceparent: "traceparent",
  stepSeq: "x-ai-step-seq",
  consumerOrg: "x-ai-consumer-org",
  consumerSystem: "x-ai-consumer-system",
  operator: "x-ai-operator",
  principal: "x-ai-principal",
  surface: "x-ai-surface",
  consumerRef: "x-ai-consumer-ref",
  firmAgent: "x-ai-firm-agent",
  identityLinks: "x-ai-identity-links", // base64 JSON of verified links
} as const;

export const PROVENANCE_HEADERS = {
  source: "x-provenance-source",
  recordRef: "x-provenance-record-ref",
  asOf: "x-provenance-as-of",
  contentHash: "x-provenance-content-hash",
} as const;
