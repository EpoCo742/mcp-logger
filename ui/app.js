/* AI Audit Plane demo UI: scenarios, approvals, interaction replay, integrity. */
const AUDIT = location.origin;
const TOOLS = "http://localhost:4400";
const MODEL = "http://localhost:4300";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (h) => (h ? String(h).slice(0, 12) + "…" : "");
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) + "." + String(new Date(iso).getMilliseconds()).padStart(3, "0") : "");
const j = (o) => esc(JSON.stringify(o, null, 2));
const get = (u) => fetch(u).then((r) => r.json());
const post = (u, body) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

const state = { selected: null, detail: null, lastRunCount: 0, openEvents: new Set() };

// ---------- scenarios ----------
async function loadScenarios() {
  const list = await get(`${AUDIT}/demo/scenarios`);
  $("#scenarios").innerHTML = list
    .map(
      (s) => `<li><div class="head"><span class="name">${esc(s.title)}</span><button class="btn small" data-run="${s.id}">Run</button></div>
      <div class="desc"><span class="tag ${s.surface}">${s.surface}</span> ${esc(s.description)}</div></li>`,
    )
    .join("");
  $("#scenarios").addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-run");
    if (!id) return;
    e.target.disabled = true;
    await post(`${AUDIT}/demo/scenarios/${id}/run`, { autoApprove: $("#auto-approve").checked });
    setTimeout(() => (e.target.disabled = false), 1500);
  });
}

async function refreshRuns() {
  const runs = await get(`${AUDIT}/demo/runs`);
  const text = runs
    .slice(0, 6)
    .map((r) => `▶ ${r.title} [${r.status}]\n${r.log.map((l) => "  " + l).join("\n")}${r.summary ? `\n  => ${r.summary}` : ""}${r.interaction_id ? `\n  interaction ${r.interaction_id}` : ""}`)
    .join("\n\n");
  if ($("#console").textContent !== text) {
    $("#console").textContent = text || "No runs yet. Pick a scenario on the left.";
  }
  // auto-select the interaction of the newest finished run
  const newest = runs[0];
  if (newest && newest.status === "done" && newest.interaction_id && runs.length !== state.lastRunCount) {
    state.lastRunCount = runs.length;
    select(newest.interaction_id);
  }
}

// ---------- approvals ----------
async function refreshApprovals() {
  const pending = await get(`${TOOLS}/approvals?status=pending`);
  $("#approval-count").textContent = pending.length;
  $("#approvals").innerHTML = pending.length
    ? pending
        .map(
          (a) => `<div class="approval"><div class="summary">${esc(a.summary)}</div>
        <div class="meta">${esc(a.approval_id)} · ${esc(a.tool)} · consumer ${esc(a.consumer_org)} · requested by ${esc(a.operator ?? "agent")} · principal ${esc(a.principal ?? "?")}<br/>shown hash ${short(a.shown_hash)}</div>
        <div class="actions"><select data-approver="${a.approval_id}"><option>ADV-101</option><option>ADV-102</option><option>ADV-201</option></select>
        <button class="btn small" data-decide="approved" data-id="${a.approval_id}">Approve</button><button class="btn small ghost" data-decide="rejected" data-id="${a.approval_id}">Reject</button></div></div>`,
        )
        .join("")
    : `<span class="muted">No approvals waiting. Execute actions (trades, transfers) stop here until a human decides.</span>`;
}
$("#approvals").addEventListener("click", async (e) => {
  const decision = e.target.getAttribute("data-decide");
  if (!decision) return;
  const id = e.target.getAttribute("data-id");
  const approver = document.querySelector(`select[data-approver="${id}"]`).value;
  await post(`${TOOLS}/approvals/${id}/decide`, { decision, approver, note: decision === "approved" ? "reviewed in approvals console" : "declined in approvals console" });
  refreshApprovals();
});

// ---------- interactions ----------
async function refreshInteractions() {
  const list = await get(`${AUDIT}/interactions`);
  $("#interaction-count").textContent = list.length;
  const rows = list
    .filter((i) => !i.interaction_id.startsWith("audit-access"))
    .map((i) => {
      const flags = [];
      if (i.denied) flags.push(`<span class="pill bad">denied ${i.denied}</span>`);
      if (i.approvals) flags.push(`<span class="pill warn">approval ${i.approvals}</span>`);
      if (i.guardrails) flags.push(`<span class="pill warn">guardrail ${i.guardrails}</span>`);
      if (i.gaps) flags.push(`<span class="pill bad">gap ${i.gaps}</span>`);
      if (i.retention_class) flags.push(`<span class="pill info">${esc(i.retention_class)}</span>`);
      return `<tr class="row ${i.interaction_id === state.selected ? "selected" : ""}" data-id="${i.interaction_id}">
        <td class="mono">${t(i.started_at)}</td><td><span class="tag ${i.surface}">${i.surface}</span></td><td>${esc(i.consumer_org ?? "")}<div class="muted mono">${esc(i.consumer_system ?? "")}</div></td>
        <td class="mono">${esc(i.operator ?? "")}</td><td class="mono">${esc(i.principal ?? "")}</td><td>${esc(i.request_summary ?? "")}</td>
        <td>${i.completed_at ? esc(i.outcome) : '<span class="muted">in progress</span>'}</td><td class="mono">${i.steps} <span class="muted">(${i.tool_calls}t/${i.model_calls}m)</span></td><td>${flags.join(" ")}</td></tr>`;
    })
    .join("");
  $("#interactions tbody").innerHTML = rows || `<tr><td colspan="9" class="muted">No interactions yet.</td></tr>`;
  if (state.selected) refreshDetail();
}
$("#interactions").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.row");
  if (tr) select(tr.getAttribute("data-id"));
});

function select(id) {
  state.selected = id;
  state.openEvents = new Set();
  refreshDetail(true);
  refreshInteractions();
}

async function refreshDetail(force) {
  const d = await get(`${AUDIT}/interactions/${state.selected}`);
  const sig = d.events.map((e) => e.event_id + e.seq).join(",");
  if (!force && state.detail === sig) return;
  state.detail = sig;
  renderDetail(d);
}

const EP_SUMMARY = {
  "interaction.started": (p) => `${p.channel}: ${p.request_summary ?? ""}${p.attachments?.length ? ` · ${p.attachments.length} attachment(s)` : ""}`,
  "interaction.completed": (p) => `${p.outcome} · ${p.total_steps ?? 0} steps · retention ${p.retention_class}${p.grounding_coverage !== undefined ? ` · grounding ${Math.round(p.grounding_coverage * 100)}%` : ""}${p.closed_by ? ` · ${p.closed_by}` : ""}`,
  "plan.created": (p) => `${p.plan} → ${(p.intended_tools ?? []).join(", ")}`,
  "context.assembled": (p) => `${p.items.length} items in context (turn ${p.turn})`,
  "model.called": (p) => `${p.provider}/${p.model} · ${p.response.stop_reason} · ${p.usage.input_tokens}+${p.usage.output_tokens} tok · ${p.latency_ms}ms${p.guardrails?.length ? " · guardrail hit" : ""}`,
  "tool.called": (p) => `${p.tool} [${p.action_class}] · ${p.policy.decision.toUpperCase()}${p.phase ? ` · ${p.phase}` : ""}${p.stamps ? ` · ${p.stamps.length} stamp(s)` : ""}${p.error ? ` · ${p.error}` : ""}`,
  "approval.requested": (p) => `${p.summary}`,
  "approval.decided": (p) => `${p.decision} by ${p.approver} in ${(p.time_to_decide_ms / 1000).toFixed(1)}s`,
  "guardrail.triggered": (p) => `${p.stage} · ${p.classifier} · ${p.verdict} → ${p.action}`,
  "response.rendered": (p) => `${p.citations.length} citation(s) · grounding ${Math.round(p.grounding.coverage * 100)}% · ${p.grounding.unsupported.length} unsupported claim(s)`,
  "audit.gap": (p) => `${p.disposition}: ${p.missing_event_type} could not be delivered (${p.cause})`,
};

function renderBody(e) {
  const p = e.payload;
  let html = "";
  if (e.event_type === "tool.called") {
    html += `<div class="kv"><b>arguments</b><span class="mono">${esc(JSON.stringify(p.arguments))}</span><b>principal scope</b><span class="mono">${esc(JSON.stringify(p.policy.principal_scope))}</span></div>`;
    html += `<div style="margin-top:6px">${p.policy.rules.map((r) => `<div class="rule ${r.result === "n/a" ? "na" : r.result}">${r.result === "pass" ? "✓" : r.result === "fail" ? "✗" : "–"} ${esc(r.id)} — ${esc(r.detail)}</div>`).join("")}</div>`;
    if (p.stamps?.length) html += `<div class="stamps"><b class="muted">provenance stamps</b>${p.stamps.map((s) => `<div class="stamp">${esc(s.stamp_id)} · ${esc(s.source_system)} · ${esc(s.record_ref)} · as of ${esc(s.as_of)} · hash ${short(s.content_hash)} · ${esc(s.trust_class)} · basis ${esc(s.access_basis)}</div>`).join("")}</div>`;
    if (p.result !== undefined) html += `<b class="muted">result</b><pre>${j(p.result)}</pre>`;
  } else if (e.event_type === "model.called") {
    html += `<div class="kv"><b>provider</b><span>${esc(p.provider)} · ${esc(p.model)} · region ${esc(p.region)} · contract ${esc(p.data_handling.contract_id)} · zero-retention ${p.data_handling.zero_retention}</span>
      <b>params</b><span class="mono">${esc(JSON.stringify(p.params))}</span><b>system prompt hash</b><span class="mono">${short(p.system_prompt_hash)}</span><b>tool manifest hash</b><span class="mono">${short(p.tool_manifest_hash)}</span><b>tools offered</b><span class="mono">${esc(p.tools_offered.join(", "))}</span></div>`;
    if (p.guardrails?.length) html += `<div class="notice bad">guardrail: ${esc(JSON.stringify(p.guardrails))}</div>`;
    html += `<b class="muted">request (full prompt as sent)</b><pre>${j(p.request)}</pre><b class="muted">response</b><pre>${j(p.response)}</pre>`;
  } else if (e.event_type === "context.assembled") {
    html += `<table class="table"><thead><tr><th>kind</th><th>detail</th><th>trust</th><th>hash</th></tr></thead><tbody>${p.items.map((i) => `<tr><td>${esc(i.kind)}</td><td class="mono">${esc(i.tool ?? i.name ?? (i.tools ? i.tools + " tools" : "") ?? "")} ${i.stamps ? esc(i.stamps.join(", ")) : ""}${i.code ? esc(i.code) : ""}</td><td>${esc(i.trust_class ?? "")}</td><td class="mono">${short(i.hash)}</td></tr>`).join("")}</tbody></table>`;
  } else if (e.event_type === "response.rendered") {
    const spans = p.grounding.spans ?? [];
    html += `<div class="grounding">${spans.map((s) => `<span class="span ${s.factual ? (s.grounded ? "grounded" : "unsupported") : "neutral"}" title="${s.factual ? (s.grounded ? "grounded in " + s.stamps.join(", ") : "factual claim with no source") : "non-factual"}">${esc(s.text.replace(/\[src:[^\]]+\]/g, ""))}${s.stamps.length ? ` <span class="cite">[${s.stamps.map((x) => x).join(", ")}]</span>` : ""}</span>`).join(" ")}</div>`;
    html += `<div class="kv" style="margin-top:8px"><b>legend</b><span><span class="span grounded">grounded</span> <span class="span unsupported">unsupported factual claim</span> <span class="span neutral">non-factual</span></span></div>`;
    html += `<div class="stamps"><b class="muted">citations as rendered to the consumer</b>${p.citations.map((c) => `<div class="stamp">[${c.n}] ${esc(c.stamp_id)} · ${esc(c.source_system)} · ${esc(c.record_ref)} · as of ${esc(c.as_of)}</div>`).join("")}</div>`;
    html += `<div class="notice">${esc(p.rendered_text)}<div class="muted" style="margin-top:6px">${esc(p.disclaimers.join(" "))}</div><div class="mono muted">rendered hash ${short(p.rendered_hash)}</div></div>`;
  } else if (e.event_type === "approval.requested" || e.event_type === "approval.decided") {
    html += `<div class="kv"><b>approval</b><span class="mono">${esc(p.approval_id)}</span><b>shown to approver (hash)</b><span class="mono">${short(p.shown_hash)}</span>${p.arguments ? `<b>arguments</b><span class="mono">${esc(JSON.stringify(p.arguments))}</span>` : ""}${p.note !== undefined ? `<b>note</b><span>${esc(p.note)}</span>` : ""}</div>`;
  } else {
    html += `<pre>${j(p)}</pre>`;
  }
  if (e.redaction_manifest?.length) {
    html += `<div class="notice">Tokenised at ingest: ${e.redaction_manifest.map((m) => `<span class="mono">${esc(m.path)} → ${esc(m.token)} (${m.class})</span>`).join(", ")} <button class="btn small ghost" data-reveal="${e.event_id}">Reveal (dual control)</button><div id="reveal-${e.event_id}"></div></div>`;
  }
  html += `<div class="kv" style="margin-top:8px"><b>chain</b><span class="mono">stream ${esc(e.stream_id)} · seq ${e.seq} · prev ${short(e.prev_hash)} · entry ${short(e.entry_hash)} · producer sig ${e.signature_verified ? "✓ " + esc(e.producer_signature.key_id) : "✗"} · payload hash ${short(e.payload_hash)}</span><b>identity</b><span class="mono">${esc(JSON.stringify({ consumer_org: e.identity.consumer_org, consumer_system: e.identity.consumer_system, operator: e.identity.operator, principal: e.identity.principal, firm_agent: e.identity.firm_agent, firm_service: e.identity.firm_service }))}</span><b>trace</b><span class="mono">${esc(e.spine.trace_id)} / span ${esc(e.spine.span_id)}${e.spine.parent_span_id ? " ← " + esc(e.spine.parent_span_id) : ""}</span></div>`;
  return html;
}

function renderDetail(d) {
  const events = [...d.events].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.seq - b.seq));
  const links = new Map();
  for (const e of events) for (const l of e.identity.links) links.set(`${l.link}:${l.value}`, l);
  const idHtml = `<div class="identity">${[...links.values()].map((l) => `<div class="link ${l.result}"><b>${esc(l.link)}</b>${esc(l.value)}<div class="muted">${esc(l.method)} · ${esc(l.result)}</div></div>`).join("")}</div>`;
  const actions = `<div class="detail-actions"><span class="mono muted">${esc(d.interaction_id)}</span><button class="btn small" id="btn-export">Export with proofs</button></div><div id="export-result"></div>`;
  const tl = events
    .map(
      (e) => `<div class="event ${e.emitter.point} ${state.openEvents.has(e.event_id) ? "open" : ""}" data-ev="${e.event_id}"><div class="head"><span class="ep">${e.emitter.point}</span><span class="type">${esc(e.event_type)}</span><span class="step">step ${e.spine.step_seq}</span><span class="time">${t(e.occurred_at)}</span></div>
      <div class="summary">${esc((EP_SUMMARY[e.event_type] ?? ((p) => JSON.stringify(p).slice(0, 120)))(e.payload))}</div><div class="body">${renderBody(e)}</div></div>`,
    )
    .join("");
  $("#detail-body").innerHTML = idHtml + actions + `<div class="timeline">${tl}</div>`;
  $("#btn-export").onclick = async () => {
    const r = await get(`${AUDIT}/export/${d.interaction_id}?requested_by=examiner-portal`);
    const verified = r.proofs.filter((p) => p.verifies).length;
    const pending = r.proofs.filter((p) => !p.checkpoint_id).length;
    $("#export-result").innerHTML = `<div class="notice ${verified + pending === r.proofs.length ? "good" : "bad"}">Export: ${r.events.length} events, ${verified} inclusion proofs verify against ${r.checkpoints.length} signed+anchored checkpoint(s)${pending ? `, ${pending} awaiting the next checkpoint` : ""}. Keys for offline verification included (audit plane, timestamp authority, ${Object.keys(r.keys.producers).length} producers). This export was itself logged as audit.access.</div><pre style="max-height:200px;overflow:auto;background:#0b0f14;padding:8px;border-radius:6px;font-size:11px">${j(r.proofs.slice(0, 2))}</pre>`;
  };
}
$("#detail-body").addEventListener("click", async (e) => {
  const rev = e.target.getAttribute("data-reveal");
  if (rev) {
    const a1 = prompt("Dual control: first approver id", "COMPLIANCE-7");
    const a2 = prompt("Dual control: second approver id", "SEC-OPS-2");
    const r = await post(`${AUDIT}/reveal`, { event_id: rev, approvers: [a1, a2] });
    document.getElementById(`reveal-${rev}`).innerHTML = r.ok ? `<div class="notice good mono">${esc(JSON.stringify(r.revealed))} (access logged)</div>` : `<div class="notice bad">${esc(r.error)}</div>`;
    return;
  }
  const head = e.target.closest(".head");
  if (!head) return;
  const card = head.closest(".event");
  card.classList.toggle("open");
  const id = card.getAttribute("data-ev");
  if (card.classList.contains("open")) state.openEvents.add(id);
  else state.openEvents.delete(id);
});

// ---------- integrity & status ----------
async function verify() {
  const r = await get(`${AUDIT}/verify`);
  const sum = r.summary ?? { problems: 0, expected: 0, unexpected: 0 };
  let headline;
  if (r.ok) headline = "All streams verify: every entry hash recomputes, every checkpoint root, signature and anchor token check out.";
  else if (sum.unexpected === 0) headline = `VERIFICATION FAILED as expected: ${sum.expected} finding(s), all caused by the simulated insider edit (Tamper archive). The archive is tamper-evident. Restart the demo to start a clean archive.`;
  else headline = `VERIFICATION FAILED: ${sum.unexpected} finding(s) are not explained by the tamper demo and need investigation${sum.expected ? ` (${sum.expected} more come from the simulated insider edit)` : ""}.`;
  $("#integrity").innerHTML =
    `<div class="notice ${r.ok ? "good" : sum.unexpected === 0 ? "warn" : "bad"}">${headline} <span class="muted">(${t(r.verified_at)})</span></div>` +
    r.streams
      .map((s) => {
        const trunc = s.truncated_before_seq ? `<div class="problem">archive on disk starts at seq ${s.first_seq_on_disk}: records 1-${s.truncated_before_seq - 1} are missing</div>` : "";
        const probs = s.problems.map((p) => `<div class="problem ${p.expected ? "expected" : ""}"><b>${p.expected ? "expected" : "investigate"}</b> · seq ${p.seq ?? "-"} ${p.event_id ? esc(p.event_id) : esc(p.checkpoint_id ?? "")}: ${esc(p.kind)} — ${esc(p.detail)}<div class="cause">${esc(p.cause)}</div></div>`).join("");
        return `<div class="stream ${s.ok ? "good" : s.problems.every((p) => p.expected) ? "warn" : "bad"}"><b>${esc(s.stream_id)}</b> · ${s.events} events on disk · ${s.checkpoints} checkpoints · anchored through seq ${s.anchored_through_seq}${trunc}${probs}</div>`;
      })
      .join("");
}
$("#btn-verify").onclick = verify;
$("#btn-checkpoint").onclick = async () => {
  const r = await post(`${AUDIT}/checkpoint`);
  $("#integrity").innerHTML = `<div class="notice good">${r.length} checkpoint(s) written: ${r.map((c) => `${esc(c.stream_id)} seq ${c.from_seq}-${c.to_seq} root ${short(c.root)} anchored ${t(c.anchor.timestamp)}`).join("; ")}</div>` + $("#integrity").innerHTML;
};
$("#btn-tamper").onclick = async () => {
  const r = await post(`${AUDIT}/admin/tamper`);
  $("#integrity").innerHTML = `<div class="notice bad">Insider edit simulated on disk: ${esc(r.detail)}. Now press Verify chain.</div>` + $("#integrity").innerHTML;
};
$("#btn-outage").onclick = async () => {
  const s = await get(`${AUDIT}/admin/status`);
  await post(`${AUDIT}/admin/outage`, { on: !s.outage });
  refreshStatus();
};
async function refreshStatus() {
  const s = await get(`${AUDIT}/admin/status`);
  $("#outage").textContent = s.outage ? "ingest: DOWN (simulated)" : "ingest: up";
  $("#outage").className = `chip ${s.outage ? "bad" : "good"}`;
  $("#btn-outage").textContent = s.outage ? "Restore ingest" : "Simulate outage";
  $("#streams").textContent = `streams: ${s.streams.length} · events: ${s.accepted} · rejected: ${s.rejected}`;
}
async function loadProvider() {
  try {
    const p = await get(`${MODEL}/provider`);
    $("#provider").textContent = `model: ${p.provider} (${p.model})`;
  } catch {
    $("#provider").textContent = "model gateway: offline";
  }
}

loadScenarios();
loadProvider();
refreshStatus();
refreshInteractions();
refreshApprovals();
refreshRuns();
setInterval(() => {
  refreshInteractions();
  refreshApprovals();
  refreshRuns();
  refreshStatus();
}, 1500);
