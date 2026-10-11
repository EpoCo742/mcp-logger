# AI Audit Logging POC

A runnable proof of concept for the **AI Audit Logging Architecture** standard: how a brokerage platform keeps a tamper-evident, replayable record of every AI interaction with third-party advisory firms, whether they call our MCP server directly or use our hosted assistant.

Everything runs locally in one process with real HTTP between components.

```
npm install
npm run demo          # starts all components; UI at http://localhost:4500
npm run scenarios     # in another terminal: runs all 8 scenarios (auto-approving)
```

Set `ANTHROPIC_API_KEY` to route model calls to Claude (`claude-opus-5-5`); without it a deterministic simulator stands in so the demo is reproducible.

The standard this POC implements and an executive summary deck are in [`docs/`](docs/README.md).

## What is in the box

| Component | Port | Role |
| --- | --- | --- |
| EP1 Consumer Edge Gateway | 4000 | Verifies the advisory firm, operator and agent attestation; assigns the interaction id and trace; proxies MCP; renders responses with citations and disclosures; classifies retention |
| EP2 Agent Runtime | 4200 | Plans, assembles context, calls the model and tools, waits for human approvals, builds the grounding map |
| EP3 Model Gateway | 4300 | The only egress to a model; logs the full prompt and response, parameters, provider terms; runs the input guardrail |
| EP4 Tool / MCP Gateway | 4400 | Policy decision per call, approval gate for execute actions, provenance stamps on every value, signed results; hosts the MCP server |
| Core brokerage APIs | 4100 | Systems of record (customers, accounts, orders, transfers); every response carries provenance headers |
| AI Audit Plane + UI | 4500 | Ingest, validate, verify producer signatures, tokenise regulated fields, hash-chain per stream, Merkle checkpoints signed and anchored, WORM-style archive, hot index, verification, export with proofs |

Source layout mirrors the architecture: `src/edge-gateway`, `src/agent-runtime`, `src/model-gateway`, `src/tool-gateway`, `src/core-apis`, `src/audit-plane`, with the shared SDK in `src/shared` (`AIAuditEvent` schema, canonical hashing, signing, context propagation, the `AuditClient`).

## Scenarios

| Scenario | Surface | Shows |
| --- | --- | --- |
| Third-party agent reviews a client over MCP | MCP | Direct EP1 → EP4 path; every value stamped and the result signed |
| Over-scoped MCP call is denied | MCP | Entitlement rule R2 fails for another firm's client; the denial and the rules that fired are recorded |
| Advisor asks the assistant for an account summary | Assistant | Full EP1 → EP2 → EP3 → EP4 path; grounding map links sentences to stamps and flags an unsupported claim |
| Advisor asks the assistant to place a trade | Assistant | preview (propose) then place_trade (execute) stopping for human approval; durable authorisation record before execution |
| Third-party agent moves money over MCP | MCP | approval_required, human decision, retry with token, transfer executed |
| Prompt injection in a consumer-supplied document | Assistant | EP3 input guardrail flags hidden instructions; the model treats the attachment as data; no transfer |
| Audit Plane outage | MCP | Read proceeds with a buffered event and an audit.gap; execute is blocked (fail-closed); buffer replays on recovery |
| Insider edits the archive | Admin | Checkpoint, verify clean, edit a record on disk, verify reports the broken link and Merkle root |

In the UI, **auto-approve** is on by default; untick it to decide approvals yourself in the Pending approvals panel. **Reset demo** (two clicks) wipes the audit archive and the run console and rejects anything still waiting for approval, so you can start a clean walkthrough without restarting the process.

## The record

Every enforcement point emits the same `AIAuditEvent` envelope (`src/shared/types.ts`): event type, emitter, correlation spine (interaction, trace, span, step), verified identity chain (consumer org, consumer system, operator, principal, firm agent, firm service), data classification, full payload, payload hash and an Ed25519 producer signature. The Audit Plane adds stream, sequence, previous hash, entry hash, redaction manifest and retention class.

Integrity controls implemented here: producer signatures verified at ingest; per-stream hash chain; Merkle checkpoints every 4 seconds or 25 events, signed by the audit plane key and anchored with a simulated RFC 3161 timestamp token from a separate key; append-only JSONL archive under `data/archive`; continuous verification that recomputes everything from disk; export with inclusion proofs and public keys for offline verification; dual-control reveal of tokenised values with every access logged.

## Notes

- The MCP endpoint is `/mcp-server`. On this development machine an endpoint-security product (Avast Web Shield) rewrites loopback HTTP responses for requests whose path ends in `/mcp` or that carry the `mcp-protocol-version` or `mcp-session-id` headers, breaking chunked framing. EP1 does not forward those headers to EP4, and the scenario client strips them through a custom fetch. On machines without that interception none of this matters.
- `data/` is wiped on each `npm run demo` unless you pass `--keep`. The demo checks that all six ports are free before it touches `data/`, so starting a second copy while one is running exits with a message instead of wiping the running demo's archive.
- **Verify chain** labels every finding with its cause. Findings from the **Tamper archive** control (or the tamper scenario) are marked *expected*: the edit stays on disk, so verification keeps failing until the demo is reset or restarted, which is the point. A finding marked *investigate* is not explained by the demo; the usual cause is an archive whose first records are missing from disk, which the panel reports as "archive on disk starts at seq N".
- This is a POC: keys live in memory, the archive is a local file, and the timestamp authority is simulated. The structure, event schema and control flow are what the standard specifies.
