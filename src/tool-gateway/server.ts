import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { isJSONRPCNotification, isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { corsMiddleware } from "../audit-plane/server.js";
import { PORTS } from "../shared/config.js";
import { contextFromHeaders, type InteractionContext } from "../shared/context.js";
import { ToolGateway } from "./gateway.js";
import { TOOL_MANIFEST_HASH, TOOL_REGISTRY, zodShapeFor } from "./registry.js";

/** Build an MCP server bound to one request's verified context (stateless transport). */
function buildMcpServer(gateway: ToolGateway, ctx: InteractionContext): McpServer {
  const server = new McpServer({ name: "firm-advisor-platform-mcp", version: "1.0.0" });
  for (const def of TOOL_REGISTRY) {
    server.registerTool(def.name, { description: `${def.description} [action class: ${def.action_class}]`, inputSchema: zodShapeFor(def) }, async (args) => {
      const r = await gateway.invoke(ctx, def.name, args as Record<string, unknown>);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: r.error }) }], _meta: { error: r.error, interaction_id: ctx.spine.interaction_id } };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ data: r.data, provenance: r.stamps }) }],
        _meta: { provenance: r.stamps, tool_span: r.event_id, interaction_id: ctx.spine.interaction_id, result_signature: r.signature },
      };
    });
  }
  return server;
}

export function createToolGatewayApp(gateway: ToolGateway) {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: "2mb" }));

  app.get("/registry", (_req, res) => res.json({ manifest_hash: TOOL_MANIFEST_HASH, tools: TOOL_REGISTRY }));

  // Internal invocation path used by the agent runtime (EP2).
  app.post("/invoke", async (req, res) => {
    const ctx = contextFromHeaders(req.headers, "tool-gateway");
    if (!ctx) return res.status(401).json({ error: "missing interaction context" });
    const { tool, args } = req.body ?? {};
    res.json(await gateway.invoke(ctx, String(tool), (args ?? {}) as Record<string, unknown>));
  });

  // MCP for third-party clients (always behind EP1). The gateway owns the HTTP layer:
  // each JSON-RPC message is dispatched to a per-request MCP server over an in-memory
  // transport and the JSON-RPC response is returned as a plain JSON body (stateless,
  // Streamable HTTP "JSON response" mode).
  const mcpHandler = async (req: express.Request, res: express.Response) => {
    const ctx = contextFromHeaders(req.headers, "tool-gateway");
    if (!ctx) return res.status(401).json({ error: "missing interaction context (route through the consumer edge gateway)" });
    if (req.method === "GET") return res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "server-initiated streams are not offered on this endpoint" }, id: null });
    if (req.method === "DELETE") return res.status(200).json({ ok: true });
    if (req.method !== "POST") return res.status(405).end();
    const messages = (Array.isArray(req.body) ? req.body : [req.body]) as JSONRPCMessage[];
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer(gateway, ctx);
    await server.connect(serverEnd);
    await clientEnd.start();
    try {
      const responses: JSONRPCMessage[] = [];
      for (const m of messages) {
        if (isJSONRPCRequest(m)) {
          const reply = new Promise<JSONRPCMessage>((resolve) => {
            clientEnd.onmessage = (msg) => {
              if ("id" in msg && msg.id === m.id) resolve(msg);
            };
          });
          await clientEnd.send(m);
          responses.push(await reply);
        } else if (isJSONRPCNotification(m)) {
          await clientEnd.send(m);
        }
      }
      if (responses.length === 0) return res.status(202).end();
      res.setHeader("content-type", "application/json");
      res.status(200).send(JSON.stringify(responses.length === 1 ? responses[0] : responses));
    } finally {
      await clientEnd.close();
      await server.close();
    }
  };
  app.post("/mcp-server", mcpHandler);
  app.get("/mcp-server", mcpHandler);
  app.delete("/mcp-server", mcpHandler);

  // Approvals (the human-in-the-loop queue; the demo UI drives this).
  app.get("/approvals", (req, res) => res.json(gateway.listApprovals(req.query.status ? String(req.query.status) : undefined)));
  app.get("/approvals/:id", (req, res) => {
    const a = gateway.approvals.get(req.params.id);
    if (!a) return res.status(404).json({ error: "not found" });
    res.json(a);
  });
  app.post("/approvals/:id/decide", async (req, res) => {
    const { decision, approver, note } = req.body ?? {};
    if (decision !== "approved" && decision !== "rejected") return res.status(400).json({ error: "decision must be approved|rejected" });
    const a = await gateway.decide(req.params.id, decision, String(approver ?? "ADV-101"), note);
    if (!a) return res.status(404).json({ error: "not found" });
    res.json(a);
  });

  return app;
}

export function startToolGateway(gateway: ToolGateway) {
  return createToolGatewayApp(gateway).listen(PORTS.tools);
}
