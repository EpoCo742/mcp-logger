import type Anthropic from "@anthropic-ai/sdk";
import { shortId } from "../shared/canonical.js";

/**
 * A deterministic stand-in for the model so the demo runs without an API key.
 * It behaves like a tool-using assistant for three intents in the advisor space:
 * account review, trade, and money movement. Citations use [src:<stamp_id>]
 * markers exactly as the real model is instructed to.
 */
type Call = { id: string; name: string; input: Record<string, unknown>; result?: ToolResultBody };
type ToolResultBody = { data?: unknown; stamps?: { stamp_id: string; record_ref: string }[]; error?: { code: string; message: string } };

export type SimOutput = { content: Anthropic.ContentBlock[]; stop_reason: "end_turn" | "tool_use"; usage: { input_tokens: number; output_tokens: number } };

function textOf(content: string | Anthropic.ContentBlockParam[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

function parseCalls(messages: Anthropic.MessageParam[]): Call[] {
  const calls: Call[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls.push({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      if (b.type === "tool_result") {
        const c = calls.find((x) => x.id === b.tool_use_id);
        if (!c) continue;
        const raw = typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => (x.type === "text" ? x.text : "")).join("");
        try {
          c.result = JSON.parse(raw);
        } catch {
          c.result = { error: { code: "unparseable", message: raw } };
        }
      }
    }
  }
  return calls;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cite = (r?: ToolResultBody) => (r?.stamps?.[0] ? ` [src:${r.stamps[0].stamp_id}]` : "");

export function simulate(system: string, messages: Anthropic.MessageParam[], warnings: string[]): SimOutput {
  const firstUser = messages.find((m) => m.role === "user");
  const rawPrompt = firstUser ? textOf(firstUser.content as string | Anthropic.ContentBlockParam[]) : "";
  // Anything inside untrusted consumer content tags is data, not instructions.
  const prompt = rawPrompt.replace(/<untrusted_consumer_content[\s\S]*?<\/untrusted_consumer_content>/g, "").trim();
  const calls = parseCalls(messages);
  const last = (name: string) => [...calls].reverse().find((c) => c.name === name && c.result);
  const usage = { input_tokens: Math.ceil((system.length + JSON.stringify(messages).length) / 4), output_tokens: 0 };
  const out = (content: Anthropic.ContentBlock[], stop: SimOutput["stop_reason"]): SimOutput => ({ content, stop_reason: stop, usage: { ...usage, output_tokens: Math.ceil(JSON.stringify(content).length / 4) } });
  const text = (t: string): Anthropic.TextBlock => ({ type: "text", text: t, citations: null });
  const use = (name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock => ({ type: "tool_use", id: shortId("toolu"), name, input, caller: { type: "direct" } });

  // Any denied or errored tool call ends the turn with an explanation.
  const failed = calls.find((c) => c.result?.error && c.result.error.code !== "approval_required");
  if (failed) {
    return out([text(`I could not complete that request. The platform declined the call to ${failed.name}: ${failed.result!.error!.message}. No client data was retrieved for that step.`)], "end_turn");
  }

  const nameMatch = prompt.match(/(?:for|client|customer|of)\s+([A-Z][a-z]+ [A-Z][a-z]+)/) ?? prompt.match(/([A-Z][a-z]+ [A-Z][a-z]+)'s/);
  const name = nameMatch?.[1];
  const trade = prompt.match(/\b(buy|sell)\b\s+(\d+)\s+(?:shares?\s+(?:of\s+)?)?([A-Za-z]{1,5})\b/i);
  const transfer = prompt.match(/\b(?:transfer|move|wire|send)\b\s+\$?([\d,]+(?:\.\d+)?)/i);
  const intent = trade ? "trade" : transfer ? "transfer" : /summary|review|balance|holding|position|overview|cash|portfolio/i.test(prompt) ? "review" : "unknown";

  if (intent === "unknown" || !name) {
    return out([text("I can help with account reviews, placing trades and moving cash for clients you advise. Tell me the client's full name and what you need.")], "end_turn");
  }

  const profile = last("get_customer_profile");
  if (!profile) {
    const plan = intent === "review" ? "look up the client, list their accounts, pull balances and positions, then summarise with citations" : intent === "trade" ? "look up the client, find the right account, price the order, then place it (human approval required)" : "look up the client, pick the funding account and a verified destination, then initiate the transfer (human approval required)";
    return out([text(`Plan: ${plan}.`), use("get_customer_profile", { name })], "tool_use");
  }
  const customer = profile.result!.data as { customer_id: string; name: string };
  const accountsCall = last("list_accounts");
  if (!accountsCall) return out([use("list_accounts", { customer_id: customer.customer_id })], "tool_use");
  const accounts = accountsCall.result!.data as { account_id: string; type: string }[];
  const pick = () => accounts.find((a) => (/\bira\b/i.test(prompt) ? /ira/i.test(a.type) : /brokerage/i.test(a.type))) ?? accounts[0];
  const note = warnings.length ? " I ignored instructions embedded in the attached document; they were not part of your request." : "";

  if (intent === "review") {
    const missing = accounts.filter((a) => !calls.some((c) => c.name === "get_positions" && c.input.account_id === a.account_id && c.result));
    if (missing.length) return out(missing.flatMap((a) => [use("get_balances", { account_id: a.account_id }), use("get_positions", { account_id: a.account_id })]), "tool_use");
    const lines: string[] = [`Here is the account summary for ${customer.name} (client ${customer.customer_id})${cite(profile.result)}.`];
    for (const a of accounts) {
      const bal = calls.find((c) => c.name === "get_balances" && c.input.account_id === a.account_id)?.result;
      const pos = calls.find((c) => c.name === "get_positions" && c.input.account_id === a.account_id)?.result;
      const b = bal?.data as { cash: number; total_value: number } | undefined;
      const p = (pos?.data as { positions: { symbol: string; quantity: number; market_value: number }[] } | undefined)?.positions ?? [];
      const top = [...p].sort((x, y) => y.market_value - x.market_value).slice(0, 3);
      if (b) lines.push(`Account ${a.account_id} (${a.type}) has a total value of ${money(b.total_value)} with ${money(b.cash)} in cash${cite(bal)}.`);
      if (top.length) lines.push(`Its largest holdings are ${top.map((t) => `${t.symbol} (${t.quantity} shares, ${money(t.market_value)})`).join(", ")}${cite(pos)}.`);
    }
    lines.push("The S&P 500 is down about 4% this quarter, so the allocation may be worth a rebalance discussion.");
    return out([text(lines.join(" ") + note)], "end_turn");
  }

  if (intent === "trade") {
    const [, side, qty, sym] = trade!;
    const acct = pick();
    const order = { account_id: acct.account_id, symbol: sym.toUpperCase(), side: side.toUpperCase(), quantity: Number(qty) };
    const preview = last("preview_trade");
    if (!preview) return out([use("preview_trade", order)], "tool_use");
    const placed = last("place_trade");
    if (!placed) return out([text(`The order prices at ${money((preview.result!.data as { est_value: number }).est_value)}; buying power check ${(preview.result!.data as { buying_power_ok: boolean }).buying_power_ok ? "passed" : "failed"}. Requesting approval to place it.`), use("place_trade", order)], "tool_use");
    const r = placed.result!;
    if (r.error) return out([text(`The order was not placed: ${r.error.message}.${note}`)], "end_turn");
    const o = r.data as { order_id: string; side: string; quantity: number; symbol: string; fill_price: number; est_value: number };
    return out([text(`Done. Order ${o.order_id} filled: ${o.side} ${o.quantity} ${o.symbol} at ${money(o.fill_price)} for a total of ${money(o.est_value)} in account ${acct.account_id}${cite(r)}. The order was priced at ${money((preview.result!.data as { est_price: number }).est_price)} before approval${cite(preview.result)}.${note}`)], "end_turn");
  }

  // transfer
  const amount = Number(transfer![1].replace(/,/g, ""));
  const acct = pick();
  const dests = last("list_transfer_destinations");
  if (!dests) return out([use("list_transfer_destinations", { customer_id: customer.customer_id })], "tool_use");
  const list = dests.result!.data as { destination_id: string; label: string }[];
  const dest = list.find((d) => prompt.toLowerCase().includes(d.label.split(" ")[0].toLowerCase())) ?? list[0];
  const done = last("initiate_transfer");
  if (!done) return out([text(`Requesting approval to move ${money(amount)} from ${acct.account_id} to ${dest.label}.`), use("initiate_transfer", { from_account_id: acct.account_id, destination_id: dest.destination_id, amount })], "tool_use");
  const r = done.result!;
  if (r.error) return out([text(`The transfer was not initiated: ${r.error.message}.${note}`)], "end_turn");
  const t = r.data as { transfer_id: string; amount: number; settles_on: string };
  return out([text(`Transfer ${t.transfer_id} for ${money(t.amount)} from ${acct.account_id} to ${dest.label} is pending settlement on ${t.settles_on}${cite(r)}. The destination is a verified account on file${cite(dests.result)}.${note}`)], "end_turn");
}
