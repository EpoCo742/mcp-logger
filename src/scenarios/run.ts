import { SCENARIOS, scenario } from "./lib.js";

/**
 * CLI: npm run scenarios            -> runs every scenario in order (auto-approving)
 *      npm run scenarios -- <id>    -> runs one scenario
 * Requires `npm run demo` to be running in another terminal.
 */
const wanted = process.argv.slice(2);
const list = wanted.length ? wanted.map((id) => scenario(id)).filter((s): s is NonNullable<typeof s> => !!s) : SCENARIOS;

for (const s of list) {
  console.log(`\n=== ${s.id}: ${s.title} ===`);
  const r = await s.run({ autoApprove: true, log: (l) => console.log(l) });
  console.log(`-> ${r.summary}${r.interaction_id ? ` (interaction ${r.interaction_id})` : ""}`);
}
