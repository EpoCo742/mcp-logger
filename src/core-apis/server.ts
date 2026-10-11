import express, { type Request, type Response } from "express";
import { hashOf, nowIso, shortId } from "../shared/canonical.js";
import { PORTS } from "../shared/config.js";
import { PROVENANCE_HEADERS } from "../shared/types.js";
import { ACCOUNTS, AS_OF, BALANCES, CUSTOMERS, DESTINATIONS, POSITIONS, QUOTES, TRANSACTIONS } from "./data.js";

/**
 * Systems of record for the POC: customers, accounts, orders and money movement.
 * Every response carries the provenance response headers that EP4 turns into stamps:
 * source system, record reference, as-of time and content hash.
 */
const SOURCE = "core-brokerage-api@prod-sim";

export type Order = { order_id: string; account_id: string; symbol: string; side: string; quantity: number; order_type: string; status: string; fill_price: number; est_value: number; placed_at: string };
export type Transfer = { transfer_id: string; from_account_id: string; destination_id: string; amount: number; currency: string; status: string; initiated_at: string; settles_on: string };

export const ORDERS: Order[] = [];
export const TRANSFERS: Transfer[] = [];

function send(res: Response, recordRef: string, body: unknown, asOf = AS_OF) {
  res.setHeader(PROVENANCE_HEADERS.source, SOURCE);
  res.setHeader(PROVENANCE_HEADERS.recordRef, recordRef);
  res.setHeader(PROVENANCE_HEADERS.asOf, asOf);
  res.setHeader(PROVENANCE_HEADERS.contentHash, hashOf(body));
  res.json(body);
}

function notFound(res: Response, what: string) {
  res.status(404).json({ error: `${what} not found` });
}

export function createCoreApisApp() {
  const app = express();
  app.use(express.json());

  app.get("/customers", (req: Request, res: Response) => {
    const name = String(req.query.name ?? "").trim().toLowerCase();
    const list = CUSTOMERS.filter((c) => !name || c.name.toLowerCase() === name).map(({ ssn: _s, ...rest }) => ({ ...rest, ssn_last4: _s.slice(-4) }));
    send(res, `customers:search:${name || "*"}`, list);
  });

  app.get("/customers/:id", (req, res) => {
    const c = CUSTOMERS.find((x) => x.customer_id === req.params.id);
    if (!c) return notFound(res, "customer");
    send(res, `customer:${c.customer_id}`, c);
  });

  app.get("/customers/:id/accounts", (req, res) => {
    const list = ACCOUNTS.filter((a) => a.customer_id === req.params.id);
    if (!CUSTOMERS.some((c) => c.customer_id === req.params.id)) return notFound(res, "customer");
    send(res, `customer:${req.params.id}:accounts`, list);
  });

  app.get("/customers/:id/transfer-destinations", (req, res) => {
    send(res, `customer:${req.params.id}:destinations`, DESTINATIONS.filter((d) => d.customer_id === req.params.id));
  });

  app.get("/accounts/:id", (req, res) => {
    const a = ACCOUNTS.find((x) => x.account_id === req.params.id);
    if (!a) return notFound(res, "account");
    send(res, `account:${a.account_id}`, a);
  });

  app.get("/accounts/:id/balances", (req, res) => {
    const b = BALANCES[req.params.id];
    if (!b) return notFound(res, "account");
    send(res, `account:${req.params.id}:balances`, { account_id: req.params.id, as_of: AS_OF, ...b });
  });

  app.get("/accounts/:id/positions", (req, res) => {
    const p = POSITIONS[req.params.id];
    if (!p) return notFound(res, "account");
    send(res, `account:${req.params.id}:positions`, { account_id: req.params.id, as_of: AS_OF, positions: p });
  });

  app.get("/accounts/:id/transactions", (req, res) => {
    const t = TRANSACTIONS[req.params.id];
    if (!t) return notFound(res, "account");
    send(res, `account:${req.params.id}:transactions`, { account_id: req.params.id, transactions: t });
  });

  app.post("/orders/preview", (req, res) => {
    const { account_id, symbol, side, quantity } = req.body ?? {};
    const price = QUOTES[String(symbol).toUpperCase()];
    if (!ACCOUNTS.some((a) => a.account_id === account_id)) return notFound(res, "account");
    if (!price) return res.status(400).json({ error: `no quote for ${symbol}` });
    const est_value = Math.round(price * Number(quantity) * 100) / 100;
    const cash = BALANCES[account_id].cash;
    const body = { account_id, symbol: String(symbol).toUpperCase(), side, quantity: Number(quantity), est_price: price, est_value, buying_power_ok: side === "SELL" || est_value <= cash + BALANCES[account_id].margin_available, cash_available: cash };
    send(res, `quote:${body.symbol}`, body, nowIso());
  });

  app.post("/orders", (req, res) => {
    const { account_id, symbol, side, quantity, order_type } = req.body ?? {};
    const price = QUOTES[String(symbol).toUpperCase()];
    if (!ACCOUNTS.some((a) => a.account_id === account_id)) return notFound(res, "account");
    if (!price) return res.status(400).json({ error: `no quote for ${symbol}` });
    const order: Order = {
      order_id: shortId("O").toUpperCase(),
      account_id,
      symbol: String(symbol).toUpperCase(),
      side: String(side).toUpperCase(),
      quantity: Number(quantity),
      order_type: String(order_type ?? "MARKET").toUpperCase(),
      status: "FILLED",
      fill_price: price,
      est_value: Math.round(price * Number(quantity) * 100) / 100,
      placed_at: nowIso(),
    };
    ORDERS.push(order);
    if (order.side === "BUY") BALANCES[account_id].cash = Math.round((BALANCES[account_id].cash - order.est_value) * 100) / 100;
    send(res, `order:${order.order_id}`, order, order.placed_at);
  });

  app.post("/transfers", (req, res) => {
    const { from_account_id, destination_id, amount } = req.body ?? {};
    const acct = ACCOUNTS.find((a) => a.account_id === from_account_id);
    if (!acct) return notFound(res, "account");
    const dest = DESTINATIONS.find((d) => d.destination_id === destination_id);
    if (!dest || dest.customer_id !== acct.customer_id || !dest.verified) {
      return res.status(400).json({ error: "destination is not a verified destination on file for this account owner" });
    }
    if (Number(amount) > BALANCES[from_account_id].cash) return res.status(400).json({ error: "insufficient cash" });
    const t: Transfer = {
      transfer_id: shortId("T").toUpperCase(),
      from_account_id,
      destination_id,
      amount: Number(amount),
      currency: "USD",
      status: "PENDING_SETTLEMENT",
      initiated_at: nowIso(),
      settles_on: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    };
    TRANSFERS.push(t);
    BALANCES[from_account_id].cash = Math.round((BALANCES[from_account_id].cash - t.amount) * 100) / 100;
    send(res, `transfer:${t.transfer_id}`, t, t.initiated_at);
  });

  return app;
}

export function startCoreApis() {
  return createCoreApisApp().listen(PORTS.coreApis);
}
