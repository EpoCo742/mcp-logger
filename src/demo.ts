import type { Express } from "express";
import { AgentRuntime } from "./agent-runtime/runtime.js";
import { startAgentRuntime } from "./agent-runtime/server.js";
import { startAuditPlane } from "./audit-plane/server.js";
import { AuditStore } from "./audit-plane/store.js";
import { startCoreApis } from "./core-apis/server.js";
import { startEdgeGateway } from "./edge-gateway/server.js";
import { startModelGateway } from "./model-gateway/server.js";
import { SCENARIOS, scenario } from "./scenarios/lib.js";
import { nowIso, shortId } from "./shared/canonical.js";
import { PORTS, URLS } from "./shared/config.js";
import { ToolGateway } from "./tool-gateway/gateway.js";
import { startToolGateway } from "./tool-gateway/server.js";

/**
 * Starts every component in one process (separate ports, real HTTP between them)
 * and mounts the demo controls on the Audit Plane so the UI can run scenarios.
 */
type Run = { run_id: string; scenario: string; title: string; status: "running" | "done" | "failed"; started_at: string; finished_at?: string; log: string[]; interaction_id?: string; summary?: string };
const runs: Run[] = [];

function mountDemo(app: Express) {
  app.get("/demo/scenarios", (_req, res) => res.json(SCENARIOS.map(({ id, title, surface, description }) => ({ id, title, surface, description }))));
  app.get("/demo/runs", (_req, res) => res.json(runs.slice(-30).reverse()));
  app.post("/demo/scenarios/:id/run", (req, res) => {
    const s = scenario(req.params.id);
    if (!s) return res.status(404).json({ error: "unknown scenario" });
    const run: Run = { run_id: shortId("run"), scenario: s.id, title: s.title, status: "running", started_at: nowIso(), log: [] };
    runs.push(run);
    const autoApprove = Boolean(req.body?.autoApprove);
    void s
      .run({ autoApprove, log: (l) => run.log.push(l) })
      .then((r) => {
        run.status = "done";
        run.summary = r.summary;
        run.interaction_id = r.interaction_id;
      })
      .catch((e: Error) => {
        run.status = "failed";
        run.summary = e.message;
        run.log.push(`error: ${e.stack ?? e.message}`);
      })
      .finally(() => (run.finished_at = nowIso()));
    res.json(run);
  });
}

const store = new AuditStore(!process.argv.includes("--keep"));
startAuditPlane(store, mountDemo);
startCoreApis();
startToolGateway(new ToolGateway());
startModelGateway();
startAgentRuntime(new AgentRuntime());
startEdgeGateway();

console.log(`
AI Audit Logging POC is running
  Demo UI + Audit Plane   ${URLS.audit}
  EP1 Consumer Edge       ${URLS.edge}      (POST /assistant/chat, /mcp-server)
  EP2 Agent Runtime       ${URLS.runtime}
  EP3 Model Gateway       ${URLS.model}     (provider: ${process.env.ANTHROPIC_API_KEY ? "anthropic claude-opus-5-5" : "simulator; set ANTHROPIC_API_KEY to use Claude"})
  EP4 Tool / MCP Gateway  ${URLS.tools}     (MCP at /mcp-server, only via EP1)
  Core brokerage APIs     ${URLS.coreApis}
Run scenarios from the UI or: npm run scenarios
`);
void PORTS;
