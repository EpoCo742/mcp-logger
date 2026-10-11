import { randomBytes } from "node:crypto";
import { CTX_HEADERS, type IdentityChain, type Spine, type Surface } from "./types.js";

export type InteractionContext = {
  spine: Spine;
  identity: IdentityChain;
  surface: Surface;
};

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}
export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** Build the W3C traceparent header value. */
export function traceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

export function parseTraceparent(value: string | undefined): { traceId: string; spanId: string } | undefined {
  if (!value) return undefined;
  const parts = value.split("-");
  if (parts.length < 4) return undefined;
  return { traceId: parts[1], spanId: parts[2] };
}

/** Serialise an interaction context into propagation headers for the next hop. */
export function contextToHeaders(ctx: InteractionContext, stepSeq?: number): Record<string, string> {
  const h: Record<string, string> = {
    [CTX_HEADERS.interactionId]: ctx.spine.interaction_id,
    [CTX_HEADERS.traceparent]: traceparent(ctx.spine.trace_id, ctx.spine.span_id),
    [CTX_HEADERS.stepSeq]: String(stepSeq ?? ctx.spine.step_seq),
    [CTX_HEADERS.surface]: ctx.surface,
    [CTX_HEADERS.identityLinks]: Buffer.from(JSON.stringify(ctx.identity.links)).toString("base64"),
  };
  if (ctx.identity.consumer_org) h[CTX_HEADERS.consumerOrg] = ctx.identity.consumer_org;
  if (ctx.identity.consumer_system) h[CTX_HEADERS.consumerSystem] = ctx.identity.consumer_system;
  if (ctx.identity.operator) h[CTX_HEADERS.operator] = ctx.identity.operator;
  if (ctx.identity.principal) h[CTX_HEADERS.principal] = ctx.identity.principal;
  if (ctx.identity.firm_agent) h[CTX_HEADERS.firmAgent] = ctx.identity.firm_agent;
  if (ctx.spine.consumer_ref) h[CTX_HEADERS.consumerRef] = ctx.spine.consumer_ref;
  return h;
}

type HeaderBag = Record<string, string | string[] | undefined>;
function one(h: HeaderBag, name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Rebuild the context at the receiving hop; the receiver becomes a child span. */
export function contextFromHeaders(h: HeaderBag, firmService: string): InteractionContext | undefined {
  const interactionId = one(h, CTX_HEADERS.interactionId);
  const tp = parseTraceparent(one(h, CTX_HEADERS.traceparent));
  if (!interactionId || !tp) return undefined;
  let links: IdentityChain["links"] = [];
  const rawLinks = one(h, CTX_HEADERS.identityLinks);
  if (rawLinks) {
    try {
      links = JSON.parse(Buffer.from(rawLinks, "base64").toString("utf8"));
    } catch {
      links = [];
    }
  }
  return {
    surface: (one(h, CTX_HEADERS.surface) as Surface) ?? "api",
    spine: {
      interaction_id: interactionId,
      trace_id: tp.traceId,
      parent_span_id: tp.spanId,
      span_id: newSpanId(),
      step_seq: Number(one(h, CTX_HEADERS.stepSeq) ?? 0),
      consumer_ref: one(h, CTX_HEADERS.consumerRef),
    },
    identity: {
      consumer_org: one(h, CTX_HEADERS.consumerOrg),
      consumer_system: one(h, CTX_HEADERS.consumerSystem),
      operator: one(h, CTX_HEADERS.operator),
      principal: one(h, CTX_HEADERS.principal),
      firm_agent: one(h, CTX_HEADERS.firmAgent),
      firm_service: firmService,
      links: [...links, { link: "firm_service", value: firmService, method: "spiffe-svid", result: "verified" }],
    },
  };
}
