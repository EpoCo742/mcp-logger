import express, { type Express } from "express";
import { CHECKPOINT_INTERVAL_MS, PORTS } from "../shared/config.js";
import { AuditStore } from "./store.js";

export function corsMiddleware(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

export function createAuditApp(store: AuditStore): Express {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: "5mb" }));

  // ---- producer key registry ----
  app.post("/keys", (req, res) => {
    const { key_id, public_pem, point } = req.body ?? {};
    if (!key_id || !public_pem) return res.status(400).json({ error: "key_id and public_pem required" });
    store.registerKey(key_id, public_pem, point ?? "unknown");
    res.json({ ok: true });
  });
  app.get("/keys", (_req, res) => res.json({ audit_plane: { key_id: store.auditKey.keyId, public_pem: store.auditKey.publicPem }, tsa: { key_id: store.tsaKey.keyId, public_pem: store.tsaKey.publicPem }, producers: Object.fromEntries(store.producerKeys) }));

  // ---- ingest ----
  app.post("/ingest", (req, res) => {
    const r = store.ingest(req.body);
    if (!r.ok) return res.status(r.status).json({ durable: false, error: r.error });
    res.json({ durable: true, event_id: r.event.event_id, stream_id: r.event.stream_id, seq: r.event.seq, entry_hash: r.event.entry_hash });
  });

  // ---- hot index ----
  app.get("/interactions", (_req, res) => res.json(store.summaries()));
  app.get("/interactions/:id", (req, res) => res.json({ interaction_id: req.params.id, events: store.interaction(req.params.id) }));
  app.get("/events", (req, res) => res.json(store.recent(Number(req.query.limit ?? 200))));
  app.get("/events/:id", (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: "not found" });
    res.json(e);
  });
  app.get("/accesses", (_req, res) => res.json(store.accesses()));

  // ---- integrity ----
  app.get("/verify", (_req, res) => res.json(store.verify()));
  app.get("/checkpoints", (_req, res) => res.json(store.checkpoints()));
  app.post("/checkpoint", (_req, res) => res.json(store.checkpointAll()));
  app.get("/export/:interactionId", (req, res) => res.json(store.exportInteraction(req.params.interactionId, String(req.query.requested_by ?? "examiner-portal"))));
  app.post("/reveal", (req, res) => {
    const { event_id, approvers } = req.body ?? {};
    const r = store.reveal(String(event_id), Array.isArray(approvers) ? approvers.map(String) : []);
    res.status(r.ok ? 200 : 400).json(r);
  });

  // ---- admin / demo controls ----
  app.get("/admin/status", (_req, res) => res.json(store.status()));
  app.post("/admin/outage", (req, res) => {
    store.outage = Boolean(req.body?.on);
    res.json({ outage: store.outage });
  });
  app.post("/admin/tamper", (req, res) => res.json(store.tamper(req.body?.event_id)));

  // periodic checkpoints (the Merkle batch + signature + anchor cadence)
  setInterval(() => store.checkpointAll(), CHECKPOINT_INTERVAL_MS).unref();

  return app;
}

export function startAuditPlane(store: AuditStore, mount?: (app: Express) => void) {
  const app = createAuditApp(store);
  mount?.(app);
  app.use(express.static("ui"));
  return app.listen(PORTS.audit);
}
