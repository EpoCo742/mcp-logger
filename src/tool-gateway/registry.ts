import { z } from "zod";
import { hashOf } from "../shared/canonical.js";
import type { ActionClass } from "../shared/types.js";

export type JsonSchemaProp = { type: "string" | "number" | "integer" | "boolean"; description?: string; enum?: string[] };
export type ToolDef = {
  name: string;
  version: string;
  action_class: ActionClass;
  description: string;
  output_classification: "internal" | "confidential" | "restricted";
  input_schema: { type: "object"; properties: Record<string, JsonSchemaProp>; required: string[]; additionalProperties: false };
};

/** The tool manifest: what the model (or an MCP client) can call, with action classes that drive policy. */
export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: "get_customer_profile",
    version: "1.2.0",
    action_class: "read",
    description: "Look up a client's profile by customer_id or exact full name. Returns identity, contact and risk profile.",
    output_classification: "restricted",
    input_schema: { type: "object", properties: { customer_id: { type: "string" }, name: { type: "string", description: "Exact full name, e.g. Jane Doe" } }, required: [], additionalProperties: false },
  },
  {
    name: "list_accounts",
    version: "1.0.0",
    action_class: "read",
    description: "List the accounts held by a client.",
    output_classification: "confidential",
    input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"], additionalProperties: false },
  },
  {
    name: "get_balances",
    version: "1.0.0",
    action_class: "read",
    description: "Cash, margin and total value for an account as of last close.",
    output_classification: "confidential",
    input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"], additionalProperties: false },
  },
  {
    name: "get_positions",
    version: "1.1.0",
    action_class: "read",
    description: "Holdings for an account with quantity, price, market value and cost basis.",
    output_classification: "confidential",
    input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"], additionalProperties: false },
  },
  {
    name: "get_transactions",
    version: "1.0.0",
    action_class: "read",
    description: "Recent transactions for an account.",
    output_classification: "confidential",
    input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"], additionalProperties: false },
  },
  {
    name: "list_transfer_destinations",
    version: "1.0.0",
    action_class: "read",
    description: "Verified external bank destinations on file for a client.",
    output_classification: "confidential",
    input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"], additionalProperties: false },
  },
  {
    name: "preview_trade",
    version: "1.0.0",
    action_class: "propose",
    description: "Price a proposed order and check buying power without placing it.",
    output_classification: "confidential",
    input_schema: {
      type: "object",
      properties: { account_id: { type: "string" }, symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, quantity: { type: "number" } },
      required: ["account_id", "symbol", "side", "quantity"],
      additionalProperties: false,
    },
  },
  {
    name: "place_trade",
    version: "2.0.0",
    action_class: "execute",
    description: "Place a market order. Requires a human approval token; call without one to request approval.",
    output_classification: "confidential",
    input_schema: {
      type: "object",
      properties: { account_id: { type: "string" }, symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, quantity: { type: "number" }, approval_token: { type: "string", description: "Token issued when a human approves this exact order" } },
      required: ["account_id", "symbol", "side", "quantity"],
      additionalProperties: false,
    },
  },
  {
    name: "initiate_transfer",
    version: "1.3.0",
    action_class: "execute",
    description: "Move cash from an account to a verified destination on file. Requires a human approval token; call without one to request approval.",
    output_classification: "confidential",
    input_schema: {
      type: "object",
      properties: { from_account_id: { type: "string" }, destination_id: { type: "string" }, amount: { type: "number" }, approval_token: { type: "string" } },
      required: ["from_account_id", "destination_id", "amount"],
      additionalProperties: false,
    },
  },
];

export const TOOL_MANIFEST_HASH = hashOf(TOOL_REGISTRY);

export function toolDef(name: string): ToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

/** Zod shape for the MCP server from the JSON schema (the registry is the single source of truth). */
export function zodShapeFor(def: ToolDef): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(def.input_schema.properties)) {
    let t: z.ZodTypeAny;
    if (p.enum) t = z.enum(p.enum as [string, ...string[]]);
    else if (p.type === "number" || p.type === "integer") t = z.number();
    else if (p.type === "boolean") t = z.boolean();
    else t = z.string();
    if (p.description) t = t.describe(p.description);
    shape[k] = def.input_schema.required.includes(k) ? t : t.optional();
  }
  return shape;
}

/** Anthropic tool definitions for the model gateway (same registry, strict schemas). */
export function anthropicTools() {
  return TOOL_REGISTRY.map((t) => ({ name: t.name, description: `${t.description} [action class: ${t.action_class}]`, input_schema: t.input_schema, strict: false }));
}
