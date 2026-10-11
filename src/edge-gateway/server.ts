import express, { type Request, type Response } from "express";
import { FIRMS } from "../core-apis/data.js";
import { corsMiddleware } from "../audit-plane/server.js";
import type { RunResult } from "../agent-runtime/runtime.js";
import { AuditClient } from "../shared/audit-client.js";
import { hashOf, nowIso, shortId } from "../shared/canonical.js";
import { PORTS, URLS } from "../shared/config.js";
import { contextToHeaders, newSpanId, newTraceId, type InteractionContext } from "../shared/context.js";
import type { IdentityChain, Surface } from "../shared/types.js";

const DISCLAIMER = "Figures are as of the last market close and are provided to the advisor of record for informational purposes; this is not an offer or recommendation by the firm.";

/**
 * EP1. The first firm-controlled hop for third-party AI traffic: verifies the
 * consumer organisation, operator and agent attestation, assigns the interaction
 * id and trace, captures the envelope, renders responses with citations and
 * disclosures, and classifies the interaction for retention.
 */
type AuthResult = { identity: IdentityChain; consumerSystem: string } | { error: string; status: number };

function authenticate(req: Request): AuthResult {
  const apiKey = req.header("x-api-key");
  const firm = FIRMS.find((f) => f.api_key === apiKey);
  if (!firm) return { error: "unknown consumer credential", status: 401 };
  const operatorId = req.header("x-operator-id");
  const links: IdentityChain["links"] = [{ link: "consumer_org", value: firm.org_id, method: "api-key+mtls(sim)", result: "verified" }];
  let operator: string | undefined;
  if (operatorId) {
    const adv = firm.advisors.find((a) => a.id === operatorId);
    if (!adv) return { error: `operator ${operatorId} is not a registered advisor of ${firm.name}`, status: 403 };
    operator = adv.id;
    links.push({ link: "operator", value: adv.id, method: "federated-oidc(sim)", result: "verified" });
  }
  let consumerSystem = "unattested-client";
  const att = req.header("x-agent-attestation");
  if (att) {
    try {
      const a = JSON.parse(att) as { agent?: string; version?: string; vendor?: string };
      consumerSystem = `${a.agent ?? "agent"}@${a.version ?? "?"}${a.vendor ? ` (${a.vendor})` : ""}`;
      links.push({ link: "consumer_system", value: consumerSystem, method: req.header("x-agent-attestation-sig") ? "signed-attestation" : "self-asserted", result: req.header("x-agent-attestation-sig") ? "verified" : "asserted" });
    } catch {
      links.push({ link: "consumer_system", value: "malformed-attestation", method: "self-asserted", result: "failed" });
    }
  }
  return { identity: { consumer_org: firm.org_id, consumer_system: consumerSystem, operator, firm_service: "edge-gateway", links }, consumerSystem };
}

function newInteraction(identity: IdentityChain, surface: Surface, consumerRef?: string): InteractionContext {
  return { surface, identity, spine: { interaction_id: shortId("int"), trace_id: newTraceId(), span_id: newSpanId(), step_seq: 0, consumer_ref: consumerRef } };
}

type McpSession = { ctx: InteractionContext; step: number; tools: string[]; errors: number; timer?: NodeJS.Timeout; started: string };

export function createEdgeGatewayApp() {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: "2mb" }));
  const audit = new AuditClient("EP1", "edge-gateway-1");
  const mcpSessions = new Map<string, McpSession>();

  app.get("/health", (_req, res) => res.json({ ok: true, point: "EP1" }));

  // ---------- Hosted assistant surface ----------
  app.post("/assistant/chat", async (req: Request, res: Response) => {
    const auth = authenticate(req);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.error });
    const { message, attachments = [] } = req.body as { message: string; attachments?: { name: string; text: string }[] };
    const ctx = newInteraction({ ...auth.identity, firm_agent: "advisor-assistant@1.4.0" }, "assistant", req.header("x-consumer-ref") ?? undefined);
    const startedAt = nowIso();
    await audit.emit({
      event_type: "interaction.started",
      surface: "assistant",
      spine: ctx.spine,
      identity: ctx.identity,
      payload: { channel: "assistant-chat-api", request_summary: String(message).slice(0, 140), request_hash: hashOf(message), attachments: attachments.map((a) => ({ name: a.name, hash: hashOf(a.text), chars: a.text.length, trust_class: "consumer_supplied" })), consumer_ref: ctx.spine.consumer_ref ?? null },
    });

    let run: RunResult;
    try {
      const r = await fetch(`${URLS.runtime}/run`, { method: "POST", headers: { "content-type": "application/json", ...contextToHeaders(ctx, 0) }, body: JSON.stringify({ message, attachments }) });
      run = (await r.json()) as RunResult;
      if (!r.ok) throw new Error((run as unknown as { error: string }).error);
    } catch (e) {
      await audit.emit({ event_type: "interaction.completed", surface: "assistant", spine: ctx.spine, identity: ctx.identity, payload: { outcome: "errored", error: (e as Error).message, retention_class: "advisory_communication" } });
      return res.status(502).json({ interaction_id: ctx.spine.interaction_id, error: (e as Error).message });
    }

    // Output guardrail: nothing that looks like a raw national id leaves the firm.
    let answer = run.answer;
    const leak = answer.match(/\b\d{3}-\d{2}-\d{4}\b/);
    if (leak) {
      answer = answer.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]");
      await audit.emit({ event_type: "guardrail.triggered", surface: "assistant", spine: ctx.spine, identity: ctx.identity, data_classification: "internal", payload: { stage: "response-output", classifier: "pii-regex-v1", verdict: "blocked", action: "redact", pattern: "ssn" } });
    }

    // Render citations as numbered footnotes and attach disclosures.
    const citations: { n: number; stamp_id: string; record_ref: string; source_system: string; as_of: string }[] = [];
    const rendered = answer.replace(/\[src:([A-Za-z0-9_]+)\]/g, (_m, id: string) => {
      const st = run.stamps[id];
      if (!st) return "";
      let c = citations.find((x) => x.stamp_id === id);
      if (!c) {
        c = { n: citations.length + 1, stamp_id: id, record_ref: st.record_ref, source_system: st.source_system, as_of: st.as_of };
        citations.push(c);
      }
      return `[${c.n}]`;
    });
    const renderedHash = hashOf({ rendered, citations, DISCLAIMER });
    await audit.emit({ event_type: "response.rendered", surface: "assistant", spine: { ...ctx.spine, step_seq: run.steps + 1 }, identity: ctx.identity, payload: { rendered_text: rendered, citations, disclaimers: [DISCLAIMER], rendered_hash: renderedHash, grounding: { coverage: run.grounding.coverage, factual_spans: run.grounding.factual_spans, grounded_spans: run.grounding.grounded_spans, unsupported: run.grounding.unsupported, spans: run.grounding.spans } } });

    const anyExec = run.tool_calls.some((t) => t.action_class === "execute" || t.action_class === "propose");
    const anyDenied = run.tool_calls.some((t) => t.code === "denied");
    const retention_class = anyDenied ? "refused" : anyExec ? "transactional" : run.tool_calls.length ? "advisory_communication" : "informational";
    await audit.emit({
      event_type: "interaction.completed",
      surface: "assistant",
      spine: { ...ctx.spine, step_seq: run.steps + 2 },
      identity: ctx.identity,
      payload: { outcome: run.outcome, started_at: startedAt, total_steps: run.steps, model_calls: run.model_calls, tool_calls: run.tool_calls.length, approvals: run.tool_calls.filter((t) => t.approval_id).length, grounding_coverage: run.grounding.coverage, unsupported_claims: run.grounding.unsupported.length, retention_class, final_response_hash: renderedHash },
    });
    res.json({ interaction_id: ctx.spine.interaction_id, answer: rendered, citations, disclaimers: [DISCLAIMER], grounding: run.grounding, tool_calls: run.tool_calls, outcome: run.outcome });
  });

  // ---------- MCP surface (third-party agents calling our tools directly) ----------
  const mcpHandler = async (req: Request, res: Response) => {
    const auth = authenticate(req);
    if ("error" in auth) return res.status(auth.status).json({ jsonrpc: "2.0", error: { code: -32001, message: auth.error }, id: null });
    const consumerRef = req.header("x-consumer-ref") ?? "default";
    const key = `${auth.identity.consumer_org}:${consumerRef}`;
    let session = mcpSessions.get(key);
    if (!session) {
      const ctx = newInteraction(auth.identity, "mcp", consumerRef);
      session = { ctx, step: 0, tools: [], errors: 0, started: nowIso() };
      mcpSessions.set(key, session);
      await audit.emit({ event_type: "interaction.started", surface: "mcp", spine: ctx.spine, identity: ctx.identity, payload: { channel: "mcp-streamable-http", request_summary: `MCP session from ${auth.consumerSystem}`, consumer_ref: consumerRef } });
    }
    const body = req.method === "POST" ? req.body : undefined;
    const method = body && typeof body === "object" && !Array.isArray(body) ? (body as { method?: string }).method : undefined;
    if (method === "tools/call") {
      session.step++;
      session.tools.push(String((body as { params?: { name?: string } }).params?.name));
    }
    const upstream = await fetch(`${URLS.tools}/mcp-server`, {
      method: req.method,
      // Note: the MCP protocol-version header is deliberately not forwarded; EP4 is stateless and some
      // endpoint-security products on developer machines rewrite loopback responses that carry MCP markers.
      headers: { "content-type": "application/json", accept: "application/json", ...contextToHeaders(session.ctx, session.step) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await upstream.text();
    const awaitingApproval = /approval_required/.test(text);
    if (method === "tools/call" && /"isError":true/.test(text) && !awaitingApproval) session.errors++;
    res.status(upstream.status);
    for (const h of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.send(text);

    // An MCP "interaction" closes when the consumer's session goes idle; a pending human
    // approval keeps it open long enough for the decision and the retried call.
    if (session.timer) clearTimeout(session.timer);
    const s = session;
    s.timer = setTimeout(() => {
      mcpSessions.delete(key);
      const retention_class = s.tools.some((t) => t === "place_trade" || t === "initiate_transfer" || t === "preview_trade") ? "transactional" : s.errors ? "refused" : s.tools.length ? "advisory_communication" : "informational";
      void audit.emit({ event_type: "interaction.completed", surface: "mcp", spine: { ...s.ctx.spine, step_seq: s.step + 1 }, identity: s.ctx.identity, payload: { outcome: s.errors ? "completed-with-denials" : "completed", started_at: s.started, total_steps: s.step, tool_calls: s.tools.length, tools_called: s.tools, tool_errors: s.errors, retention_class, closed_by: "consumer-session-idle" } });
    }, awaitingApproval ? 180_000 : 2500);
  };
  app.post("/mcp-server", mcpHandler);
  app.get("/mcp-server", mcpHandler);
  app.delete("/mcp-server", mcpHandler);

  return app;
}

export function startEdgeGateway() {
  return createEdgeGatewayApp().listen(PORTS.edge);
}
