// Central configuration for the POC. Everything runs on localhost in one process.
export const PORTS = {
  edge: 4000, // EP1 Consumer Edge Gateway
  coreApis: 4100, // Systems of record (accounts, customers, orders, transfers)
  runtime: 4200, // EP2 Agent Runtime
  model: 4300, // EP3 Model Gateway
  tools: 4400, // EP4 Tool / MCP Gateway
  audit: 4500, // AI Audit Plane + demo UI
} as const;

export const URLS = {
  edge: `http://localhost:${PORTS.edge}`,
  coreApis: `http://localhost:${PORTS.coreApis}`,
  runtime: `http://localhost:${PORTS.runtime}`,
  model: `http://localhost:${PORTS.model}`,
  tools: `http://localhost:${PORTS.tools}`,
  audit: `http://localhost:${PORTS.audit}`,
} as const;

export const SCHEMA_VERSION = "1.0";

// Checkpoint cadence for the audit plane (Merkle batch + signature + anchor).
export const CHECKPOINT_INTERVAL_MS = 4000;
export const CHECKPOINT_MAX_EVENTS = 25;

// Where the append-only archive lives.
export const DATA_DIR = "data";
