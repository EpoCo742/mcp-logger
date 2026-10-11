import { ACCOUNTS, CUSTOMERS, FIRMS } from "../core-apis/data.js";
import type { InteractionContext } from "../shared/context.js";
import type { ToolDef } from "./registry.js";

export type PolicyRule = { id: string; result: "pass" | "fail" | "n/a"; detail: string };
export type PolicyDecision = {
  decision: "allow" | "deny";
  rules: PolicyRule[];
  principal_scope: { resolved_customer_id?: string; resolved_from?: string; authorised: boolean };
};

/** Work out which client (principal) the call is about from its arguments. */
export function resolvePrincipal(args: Record<string, unknown>): { customer_id?: string; from?: string } {
  const accountId = (args.account_id ?? args.from_account_id) as string | undefined;
  if (accountId) {
    const a = ACCOUNTS.find((x) => x.account_id === accountId);
    return { customer_id: a?.customer_id, from: `account:${accountId}` };
  }
  if (typeof args.customer_id === "string") return { customer_id: args.customer_id, from: `customer_id` };
  if (typeof args.name === "string") {
    const c = CUSTOMERS.find((x) => x.name.toLowerCase() === String(args.name).trim().toLowerCase());
    return { customer_id: c?.customer_id, from: `name:${args.name}` };
  }
  return {};
}

/**
 * The entitlement decision EP4 makes before any tool runs. Every rule that fired is
 * recorded on the tool.called event, so an investigator sees why a call was allowed.
 */
export function decide(ctx: InteractionContext, def: ToolDef, args: Record<string, unknown>): PolicyDecision {
  const rules: PolicyRule[] = [];
  const firm = FIRMS.find((f) => f.org_id === ctx.identity.consumer_org);
  const orgLink = ctx.identity.links.find((l) => l.link === "consumer_org");

  rules.push(
    firm && orgLink?.result === "verified"
      ? { id: "R1.consumer-org-verified", result: "pass", detail: `${firm.name} verified by ${orgLink.method}` }
      : { id: "R1.consumer-org-verified", result: "fail", detail: "consumer organisation not verified at the edge" },
  );

  const p = resolvePrincipal(args);
  const customer = CUSTOMERS.find((c) => c.customer_id === p.customer_id);
  let authorised = false;
  if (!customer) {
    rules.push({ id: "R2.principal-in-scope", result: "fail", detail: `could not resolve a client from ${p.from ?? "the arguments"}` });
  } else if (firm && firm.represents.includes(customer.customer_id)) {
    authorised = true;
    rules.push({ id: "R2.principal-in-scope", result: "pass", detail: `${firm.org_id} is advisor of record for ${customer.customer_id}` });
  } else {
    rules.push({ id: "R2.principal-in-scope", result: "fail", detail: `${ctx.identity.consumer_org ?? "consumer"} is not advisor of record for ${customer.customer_id}` });
  }

  if (def.action_class === "execute" || def.action_class === "propose") {
    rules.push(
      ctx.identity.operator
        ? { id: "R3.human-operator-present", result: "pass", detail: `operator ${ctx.identity.operator} attached to the interaction` }
        : { id: "R3.human-operator-present", result: "fail", detail: `${def.action_class} actions require a named human operator` },
    );
  } else {
    rules.push({ id: "R3.human-operator-present", result: "n/a", detail: "read action" });
  }

  rules.push({ id: "R4.tool-enabled-for-surface", result: "pass", detail: `${def.name}@${def.version} enabled for ${ctx.surface}` });

  return {
    decision: rules.some((r) => r.result === "fail") ? "deny" : "allow",
    rules,
    principal_scope: { resolved_customer_id: customer?.customer_id, resolved_from: p.from, authorised },
  };
}
