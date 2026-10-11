import { AuditClient, AuditUnavailableError } from "../shared/audit-client.js";
import { hashOf, nowIso, shortId } from "../shared/canonical.js";
import type { InteractionContext } from "../shared/context.js";
import { signHex } from "../shared/keys.js";
import type { ProvenanceStamp } from "../shared/types.js";
import { decide, type PolicyDecision } from "./policy.js";
import { TOOL_MANIFEST_HASH, toolDef } from "./registry.js";
import { IMPL, stampsFor, summarise } from "./tools.js";

export type Approval = {
  approval_id: string;
  interaction_id: string;
  consumer_org?: string;
  operator?: string;
  principal?: string;
  tool: string;
  arguments: Record<string, unknown>;
  args_hash: string;
  summary: string;
  shown_hash: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_at?: string;
  approver?: string;
  note?: string;
  token?: string;
  consumed: boolean;
};

export type InvokeResult =
  | { ok: true; data: unknown; stamps: ProvenanceStamp[]; event_id: string; action_class: string; signature: { key_id: string; sig: string } }
  | { ok: false; error: { code: "denied" | "approval_required" | "approval_rejected" | "audit_unavailable" | "tool_error" | "unknown_tool"; message: string; approval_id?: string; summary?: string; rules?: PolicyDecision["rules"] }; event_id?: string };

/**
 * EP4. Every tool call, whether from our own agent runtime or from a third party's
 * MCP client, passes through invoke(): policy decision, approval gate for execute
 * actions, the call itself, provenance stamping, and the tool.called audit event.
 */
export class ToolGateway {
  readonly audit = new AuditClient("EP4", "tool-gateway-1");
  readonly approvals = new Map<string, Approval>();

  async invoke(ctx: InteractionContext, tool: string, rawArgs: Record<string, unknown>): Promise<InvokeResult> {
    const def = toolDef(tool);
    if (!def) return { ok: false, error: { code: "unknown_tool", message: `tool ${tool} is not registered` } };
    const started = Date.now();
    const args = { ...rawArgs };
    const policy = decide(ctx, def, args);
    const identity = { ...ctx.identity, principal: policy.principal_scope.resolved_customer_id ?? ctx.identity.principal };
    const base = { tool: def.name, version: def.version, action_class: def.action_class, tool_manifest_hash: TOOL_MANIFEST_HASH, arguments: maskToken(args), policy };
    const emit = (payload: Record<string, unknown>, durable: boolean) =>
      this.audit.emit({ event_type: "tool.called", surface: ctx.surface, spine: ctx.spine, identity, data_classification: def.output_classification, payload }, { durable });

    if (policy.decision === "deny") {
      const r = await emit({ ...base, phase: "denied", duration_ms: Date.now() - started }, false);
      return { ok: false, event_id: r.event.event_id, error: { code: "denied", message: policy.rules.filter((x) => x.result === "fail").map((x) => x.detail).join("; "), rules: policy.rules } };
    }

    // Execute actions need a human approval token tied to these exact arguments.
    if (def.action_class === "execute") {
      const token = typeof args.approval_token === "string" ? args.approval_token : undefined;
      const argsHash = hashOf(maskToken(args, true));
      if (!token) {
        const approval = await this.requestApproval(ctx, identity, def.name, args, argsHash);
        if (!approval) return { ok: false, error: { code: "audit_unavailable", message: "cannot record approval request; action blocked (fail-closed)" } };
        return { ok: false, error: { code: "approval_required", message: `human approval required: ${approval.summary}`, approval_id: approval.approval_id, summary: approval.summary } };
      }
      const approval = [...this.approvals.values()].find((a) => a.token === token);
      if (!approval || approval.status !== "approved" || approval.consumed || approval.args_hash !== argsHash || approval.tool !== def.name) {
        const r = await emit({ ...base, phase: "denied", policy: { ...policy, decision: "deny", rules: [...policy.rules, { id: "R5.valid-approval-token", result: "fail", detail: "approval token missing, consumed, or bound to different arguments" }] }, duration_ms: Date.now() - started }, false);
        return { ok: false, event_id: r.event.event_id, error: { code: "denied", message: "approval token invalid for this action" } };
      }
      approval.consumed = true;
      // Fail-closed: the authorisation record must be durable before anything irreversible happens.
      try {
        await emit({ ...base, phase: "authorised", approval_id: approval.approval_id, approver: approval.approver }, true);
      } catch (e) {
        approval.consumed = false;
        if (e instanceof AuditUnavailableError) return { ok: false, error: { code: "audit_unavailable", message: e.message } };
        throw e;
      }
    }

    try {
      const out = await IMPL[def.name](args);
      const eventId = shortId("evt");
      const accessBasis = policy.rules.find((r) => r.id.startsWith("R2"))?.id ?? "R2";
      const stamps = stampsFor(out.records, eventId, accessBasis);
      const rows = Array.isArray(out.data) ? out.data.length : 1;
      const payload = { ...base, phase: "completed", result: out.data, result_rows: rows, stamps, duration_ms: Date.now() - started };
      const durable = def.action_class === "execute" || def.action_class === "propose";
      // The event id is assigned up front so the stamps can reference their tool span without
      // mutating a payload after it has been hashed and signed.
      const r = await this.audit.emit({ event_id: eventId, event_type: "tool.called", surface: ctx.surface, spine: ctx.spine, identity, data_classification: def.output_classification, payload }, { durable });
      const signature = { key_id: this.audit.keyPair.keyId, sig: signHex(this.audit.keyPair, hashOf({ data: out.data, stamps })) };
      return { ok: true, data: out.data, stamps, event_id: r.event.event_id, action_class: def.action_class, signature };
    } catch (e) {
      if (e instanceof AuditUnavailableError) return { ok: false, error: { code: "audit_unavailable", message: e.message } };
      const message = (e as Error).message;
      const r = await emit({ ...base, phase: "errored", error: message, duration_ms: Date.now() - started }, false);
      return { ok: false, event_id: r.event.event_id, error: { code: "tool_error", message } };
    }
  }

  private async requestApproval(ctx: InteractionContext, identity: InteractionContext["identity"], tool: string, args: Record<string, unknown>, argsHash: string): Promise<Approval | undefined> {
    const summary = summarise(tool, args);
    const approval: Approval = {
      approval_id: shortId("apr"),
      interaction_id: ctx.spine.interaction_id,
      consumer_org: identity.consumer_org,
      operator: identity.operator,
      principal: identity.principal,
      tool,
      arguments: maskToken(args, true),
      args_hash: argsHash,
      summary,
      shown_hash: hashOf({ summary, tool, args: maskToken(args, true) }),
      status: "pending",
      requested_at: nowIso(),
      consumed: false,
    };
    try {
      await this.audit.emit(
        { event_type: "approval.requested", surface: ctx.surface, spine: ctx.spine, identity, payload: { approval_id: approval.approval_id, tool, action_class: "execute", summary, shown_hash: approval.shown_hash, arguments: approval.arguments } },
        { durable: true },
      );
    } catch {
      return undefined;
    }
    this.approvals.set(approval.approval_id, approval);
    return approval;
  }

  async decide(approvalId: string, decision: "approved" | "rejected", approver: string, note?: string): Promise<Approval | undefined> {
    const a = this.approvals.get(approvalId);
    if (!a || a.status !== "pending") return a;
    a.status = decision;
    a.decided_at = nowIso();
    a.approver = approver;
    a.note = note;
    if (decision === "approved") a.token = shortId("tok");
    const stepSeq = 0; // the approval is a side event of the interaction; EP2/EP1 own the step counter
    await this.audit.emit(
      {
        event_type: "approval.decided",
        surface: "assistant",
        spine: { interaction_id: a.interaction_id, trace_id: "0".repeat(32), span_id: "0".repeat(16), step_seq: stepSeq },
        identity: { consumer_org: a.consumer_org, operator: approver, principal: a.principal, firm_service: "tool-gateway", links: [{ link: "operator", value: approver, method: "approval-ui-sso", result: "verified" }] },
        payload: { approval_id: a.approval_id, decision, approver, note: note ?? "", shown_hash: a.shown_hash, time_to_decide_ms: Date.parse(a.decided_at) - Date.parse(a.requested_at), summary: a.summary },
      },
      { durable: true },
    );
    return a;
  }

  listApprovals(status?: string): Approval[] {
    return [...this.approvals.values()].filter((a) => !status || a.status === status).sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  }
}

function maskToken(args: Record<string, unknown>, drop = false): Record<string, unknown> {
  const { approval_token, ...rest } = args;
  if (drop || approval_token === undefined) return rest;
  return { ...rest, approval_token: "***" };
}
