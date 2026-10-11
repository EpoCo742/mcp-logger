import type { Express } from "express";
import { createServer } from "node:net";
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

function mountDemo(app: Express, store: AuditStore, tools: ToolGateway) {
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
  /**
   * Reset the demo without restarting: reject anything still waiting for a human, clear the
   * run console and start a fresh audit archive. Systems of record (customers, accounts,
   * orders, transfers) and producer keys are left alone.
   */
  app.post("/demo/reset", async (_req, res) => {
    const pending = tools.listApprovals("pending");
    for (const a of pending) await tools.decide(a.approval_id, "rejected", "demo-reset", "rejected because the demo was reset");
    if (pending.length) await new Promise((r) => setTimeout(r, 1500)); // let the waiting scenarios finish writing
    const runsCleared = runs.length;
    runs.length = 0;
    res.json({ ok: true, ...store.reset(), runs_cleared: runsCleared, approvals_rejected: pending.length });
  });
}

/**
 * Refuse to start if any demo port is already taken. This runs before the store is
 * constructed, so a second `npm run demo` can never wipe the archive of a demo that
 * is still running: it exits here without touching data/.
 */
async function assertPortsFree(ports: Record<string, number>): Promise<void> {
  for (const [name, port] of Object.entries(ports)) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, () => probe.close(() => resolve(true)));
    });
    if (!free) {
      console.error(`\nPort ${port} (${name}) is already in use: another demo is probably still running.\nNothing was started and data/ was left untouched. Stop the other demo first, or use its UI at ${URLS.audit}.\n`);
      process.exit(1);
    }
  }
}

await assertPortsFree(PORTS);
const store = new AuditStore(!process.argv.includes("--keep"));
const tools = new ToolGateway();
startAuditPlane(store, (app) => mountDemo(app, store, tools));
startCoreApis();
startToolGateway(tools);
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
