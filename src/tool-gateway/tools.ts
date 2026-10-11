import { hashOf, nowIso, shortId } from "../shared/canonical.js";
import { URLS } from "../shared/config.js";
import { PROVENANCE_HEADERS, type ProvenanceStamp } from "../shared/types.js";

/** A record fetched from a system of record together with its provenance headers. */
export type FetchedRecord = { body: unknown; source: string; record_ref: string; as_of: string; content_hash: string };

async function core(path: string, init?: RequestInit): Promise<FetchedRecord> {
  const res = await fetch(`${URLS.coreApis}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `core api ${res.status}`);
  const h = res.headers;
  return {
    body,
    source: h.get(PROVENANCE_HEADERS.source) ?? "unknown",
    record_ref: h.get(PROVENANCE_HEADERS.recordRef) ?? path,
    as_of: h.get(PROVENANCE_HEADERS.asOf) ?? nowIso(),
    content_hash: h.get(PROVENANCE_HEADERS.contentHash) ?? hashOf(body),
  };
}

export type ToolOutput = { data: unknown; records: FetchedRecord[] };

/** Tool implementations. Each returns the data plus every source record it touched. */
export const IMPL: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
  async get_customer_profile(args) {
    if (args.customer_id) {
      const r = await core(`/customers/${args.customer_id}`);
      return { data: r.body, records: [r] };
    }
    const r = await core(`/customers?name=${encodeURIComponent(String(args.name ?? ""))}`);
    const list = r.body as unknown[];
    if (list.length === 0) throw new Error(`no client named ${args.name}`);
    return { data: list[0], records: [r] };
  },
  async list_accounts(args) {
    const r = await core(`/customers/${args.customer_id}/accounts`);
    return { data: r.body, records: [r] };
  },
  async get_balances(args) {
    const r = await core(`/accounts/${args.account_id}/balances`);
    return { data: r.body, records: [r] };
  },
  async get_positions(args) {
    const r = await core(`/accounts/${args.account_id}/positions`);
    return { data: r.body, records: [r] };
  },
  async get_transactions(args) {
    const r = await core(`/accounts/${args.account_id}/transactions`);
    return { data: r.body, records: [r] };
  },
  async list_transfer_destinations(args) {
    const r = await core(`/customers/${args.customer_id}/transfer-destinations`);
    return { data: r.body, records: [r] };
  },
  async preview_trade(args) {
    const r = await core(`/orders/preview`, { method: "POST", body: JSON.stringify(args) });
    return { data: r.body, records: [r] };
  },
  async place_trade(args) {
    const { approval_token: _t, ...order } = args;
    const r = await core(`/orders`, { method: "POST", body: JSON.stringify({ ...order, order_type: "MARKET" }) });
    return { data: r.body, records: [r] };
  },
  async initiate_transfer(args) {
    const { approval_token: _t, ...xfer } = args;
    const r = await core(`/transfers`, { method: "POST", body: JSON.stringify(xfer) });
    return { data: r.body, records: [r] };
  },
};

/** Turn fetched records into provenance stamps bound to the tool.called span. */
export function stampsFor(records: FetchedRecord[], toolSpanEventId: string, accessBasis: string): ProvenanceStamp[] {
  return records.map((r) => ({
    stamp_id: shortId("st"),
    source_system: r.source,
    record_ref: r.record_ref,
    as_of: r.as_of,
    content_hash: r.content_hash,
    tool_span: toolSpanEventId,
    trust_class: "firm_record",
    access_basis: accessBasis,
  }));
}

/** Human-readable summary shown to an approver (its hash is recorded with the approval). */
export function summarise(tool: string, args: Record<string, unknown>): string {
  if (tool === "place_trade") return `${args.side} ${args.quantity} ${String(args.symbol).toUpperCase()} at market in account ${args.account_id}`;
  if (tool === "initiate_transfer") return `Transfer $${Number(args.amount).toLocaleString()} from ${args.from_account_id} to destination ${args.destination_id}`;
  return `${tool} ${JSON.stringify(args)}`;
}
