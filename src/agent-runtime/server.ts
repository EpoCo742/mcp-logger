import express from "express";
import { corsMiddleware } from "../audit-plane/server.js";
import { PORTS } from "../shared/config.js";
import { contextFromHeaders } from "../shared/context.js";
import { AgentRuntime } from "./runtime.js";

export function createAgentRuntimeApp(runtime: AgentRuntime) {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: "2mb" }));

  app.post("/run", async (req, res) => {
    const ctx = contextFromHeaders(req.headers, "agent-runtime");
    if (!ctx) return res.status(401).json({ error: "missing interaction context" });
    const { message, attachments } = req.body ?? {};
    try {
      res.json(await runtime.run(ctx, String(message ?? ""), Array.isArray(attachments) ? attachments : []));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return app;
}

export function startAgentRuntime(runtime: AgentRuntime) {
  return createAgentRuntimeApp(runtime).listen(PORTS.runtime);
}
