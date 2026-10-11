# AI Audit Logging Executive Summary

Plain-text rendering of the deck source in this folder. Bracketed items are placeholders to fill before circulation.

---

## Slide 1: Every AI interaction, on the record

Enterprise Architecture · AI Strategy and Standards

An audit logging standard for the AI capabilities we offer to third-party advisory firms

Executive summary · October 2026

Proof of concept complete


> Speaker notes: Purpose of this deck: give leadership a plain-language view of why AI audit logging needs a firm-wide standard now, what the standard requires, and what the proof of concept has already demonstrated. Technical detail is kept to diagrams and one glossary at the end.

---

## Slide 2: Outside firms are connecting to us through AI

Why now

Advisory firms will reach client data and the systems that move money in three ways. Each one is a new channel into our books and records.


**Their agents call our tools**

A third party's own AI agent connects over MCP and reads accounts or asks for a trade directly.


**Their advisors use our assistant**

An advisor asks our hosted assistant a question. It plans, calls a model and our systems, and answers.


**Our agents act on their behalf**

Background agents run on our side for their clients, with no person watching every step.

The question we must answer months later: who did what, with which data, on whose authority, and how do we know?


> Speaker notes: Three channels: MCP (a protocol that lets another firm's AI agent call our tools), our hosted assistant, and background agents we run on their behalf. All three touch client data and transaction systems. The closing question is the one a regulator, a client or a court will ask.

---

## Slide 3: Six things AI changes about the record

The risk


**Data leaves one call at a time**

Many small reads add up to a client file assembled outside our walls.


**Models act, not just read**

A trade or transfer can be triggered by text we never saw or approved.


**Answers can sound right and be wrong**

A model can state a figure that no system of record ever produced.


**Instructions hide inside documents**

A file a third party uploads can carry commands aimed at the model.


**Logs can be quietly edited**

Records kept by the team that runs the system can be changed after the fact.


**Interactions cannot be replayed**

Months later the prompt, the model version and the data it used are gone.


> Speaker notes: Conventional API logging records a request and a response. With AI in the loop, the thing that matters is the chain: what the model was told, which values it used, what it decided, and which of its statements rest on real records. Each of these six risks is addressed by a specific control later in the deck.

---

## Slide 4: The existing rules already cover AI

Obligations

- Rule or framework | What it asks of us | How the standard answers | SEC Rule 17a-4 | Records kept so they cannot be altered or erased, or with a complete audit trail of changes | Append-only archive, hash chain and independently timestamped checkpoints | FINRA Rule 4511 | Books and records made and preserved for prescribed periods | A retention class assigned to every AI interaction at the point of entry | NIST AI Risk Management Framework | AI systems that are traceable, transparent and accountable | One correlated record per interaction, including model version and settings | ISO/IEC 42001 | A management system for AI with logging and impact controls | One standard applied to every production AI use, with conformance testing | EU AI Act, Article 12 | Automatic event logging for AI systems in regulated uses | Capture happens automatically at shared gateways, not in each application
Technical building blocks are open standards: W3C Trace Context for correlation, RFC 8785 canonical JSON for hashing, RFC 3161 timestamps, Ed25519 signatures.


> Speaker notes: None of these rules carve out AI. The point of the slide: we are not inventing a new obligation, we are making sure AI-mediated activity meets the ones we already have. Legal and Compliance should confirm the mapping before the standard is ratified.

---

## Slide 5: Every production AI interaction leaves one record that is complete, attributable, provable and tamper-evident.

The standard in one sentence


**Complete**

What went in, what came out, and every value the AI used along the way.


**Attributable**

The firm, the person, the client and the agent involved, each one verified.


**Provable**

Every fact in an answer is tied to the source record it came from.


**Tamper-evident**

Any change to a record after the fact is detectable, and the record is kept for its full term.


> Speaker notes: This is the sentence to remember. Everything that follows is how the four words are delivered: where capture happens, what the record holds, and how it is protected.

---

## Slide 6: Four points where the record is captured

Architecture

Outside the firm


**Advisory firm**

Point 1


**Edge Gateway**

Who is calling

Point 2


**Agent Runtime**

What was planned

Point 3


**Model Gateway**

What the model saw


**Model provider**

Point 4


**Tool Gateway**

What was done

Systems of record


**Accounts, orders, transfers**

Assistant path

Direct MCP path


**AI Audit Plane**

Every numbered point sends a signed record of each step here. The Audit Plane checks it, masks regulated fields, chains it to the previous record, seals checkpoints with an independent timestamp and keeps it for the retention period.


> Speaker notes: Two paths. The assistant path: the firm's advisor talks to our assistant; the Edge Gateway admits the call, the Agent Runtime plans, the Model Gateway is the only door to an outside model, and the Tool Gateway is the only door to our systems. The direct path: a third party's own agent calls our tools over MCP; it still passes the Edge Gateway and the Tool Gateway. Application teams never log on their own; the four shared points do it.

---

## Slide 7: What each point writes down

Architecture

Point 1


**Edge Gateway**

Where outside firms enter

- Which firm, which person, which agent, each verified
- The interaction id that ties every later step together
- Exactly what was shown back, with citations
- The retention class for the interaction
Point 2


**Agent Runtime**

Where our assistant thinks

- The plan the agent made and why
- Every document and value placed in front of the model
- Approvals requested and who decided
- The map from each sentence to its source
Point 3


**Model Gateway**

The only door to a model

- The full prompt and the full reply, word for word
- Model name, version and settings used
- Provider terms: data kept or not, where
- Hidden instructions detected in inputs
Point 4


**Tool Gateway**

The only door to our systems

- Every read, proposal and action, with its arguments
- The policy decision and which rules passed or failed
- A source stamp on every value returned
- The approval token behind every action

> Speaker notes: The split matters: no single team sees everything, and no single team can hide anything. The Model Gateway is also where we enforce which providers may be used and on what data-handling terms.

---

## Slide 8: One shape for every record, from every point

The record

Whatever the step, the record answers the same six questions. That is what makes an interaction replayable end to end.


**Who**

The firm, the person, the client, the agent and our own service, each link marked verified or not.


**What happened**

A model call, a tool call, an approval, a guardrail firing, a response shown, or a gap in logging itself.


**When and where**

The time, the interaction it belongs to and its step number, so the whole conversation can be rebuilt in order.


**The data**

Full inputs and outputs, with regulated fields replaced by tokens and the originals held in a sealed vault.


**The proof**

A fingerprint of the content and a signature from the point that produced it, so forgery is detectable.


**The seal**

Its place in the chain, the checkpoint that covers it and the retention class it must be kept under.


> Speaker notes: Technically this is the AIAuditEvent envelope. Because every point uses the same shape, the Audit Plane can validate, index and verify records without knowing anything about the application that produced them.

---

## Slide 9: Every figure in an answer points back to a record

Proof of source

What the advisor saw (from the proof of concept)

The total value of account A-2001 is $759,874.55 [1]. Cash available is $248,210.55 [2]. The largest holding is the index fund position [3].

The S&P 500 is down about 4% this quarter, so the allocation may be worth a rebalance discussion.

Flagged: no source record supports this sentence

Behind citation [1]

Source system: account ledger
Record: account A-2001 balances
As of: the moment it was read
Fingerprint: of the exact values returned
Access basis: client in the caller's scope
Returned by: Tool Gateway, signed

Unsupported statements are not blocked. They are marked in the response, recorded as ungrounded, and reported, so the firm can decide what the assistant may say.


> Speaker notes: Every value that comes out of a system of record carries a provenance stamp: which system, which record, when, and a fingerprint of the content. When the assistant writes an answer, each sentence is linked to the stamps it relied on. A sentence with no stamp behind it is flagged. Figures on this slide are illustrative, taken from the proof of concept's test data.

---

## Slide 10: Reading is not acting

Actions

Read


**Profiles, balances, positions, history**

Allowed when policy passes: the firm is verified, the client is in the caller's scope, the tool is enabled for that channel. Every value returned is stamped.

If the audit service is down, the read proceeds, is buffered, and a gap is recorded and alarmed.

Propose


**Preview a trade, draft a transfer**

Nothing changes in our systems, but the proposal is advice. It is written to the record durably before it is shown to anyone.

If the record cannot be written, the proposal is not shown.

Execute


**Place a trade, move money**

A named person must approve the exact action, seeing the same summary the system will execute. The approval is bound to those parameters and can be used once.

The authorisation is written to the record before anything happens. If it cannot be written, the action is blocked.

Fail closed for actions, fail open with an alarm for reads. A model can never move money on the strength of a record that was not kept.


> Speaker notes: Three action classes. The approval token is tied to a fingerprint of the arguments, so a model cannot get approval for one trade and use it for another. The proof of concept shows the money-movement case end to end, including an approval decided by a person in the demo interface.

---

## Slide 11: A record nobody can quietly change

Integrity

Step 1


**Signed at the source**

Each point signs its record with its own key before sending it.

Step 2


**Chained on arrival**

Every record carries the fingerprint of the one before it, like links in a chain.

Step 3


**Sealed and timestamped**

Every few seconds a checkpoint is signed and stamped by an independent time authority.

Step 4


**Stored write-once**

The archive only ever grows. Verification re-reads it from disk on a schedule.

Tested: in the proof of concept an administrator edited one archived record on disk. Verification reported the changed content, the broken link and the mismatched checkpoint, and named the record.


> Speaker notes: We do not promise a record cannot be changed; we promise any change is detected, located and attributable. Regulators can be given an export with the proofs and the public keys, so they can verify it without trusting us or our systems.

---

## Slide 12: Complete records without a second copy of client data

Privacy and retention


**Regulated fields are masked**

- Social security numbers, dates of birth, emails and phone numbers are replaced by consistent tokens as records arrive.
- The same value always gets the same token, so investigators can still follow a thread.
- Originals go into an encrypted vault. Revealing one needs two approvers, and the reveal is itself a record.

**Kept as long as the business record**

- Each interaction gets a retention class at the point of entry: transactional, advisory or informational.
- A record of a trade or transfer is kept as long as the trade record itself, under the existing books-and-records schedule.
- Informational interactions are kept for [N years]. Legal holds freeze any class.
- A regulator receives an export package with proofs they can verify offline.

> Speaker notes: Two concerns leadership tends to raise: does the audit log become a new honeypot of client data, and how long are we on the hook. Masking at ingest with a dual-control vault answers the first; retention classes tied to the existing schedule answer the second. The number of years for informational records is a Compliance decision.

---

## Slide 13: Eight scenarios, run end to end

Proof of concept

- Scenario | What it proved | Third-party agent reviews a client over MCP | Every value returned carries a source stamp and the result is signed | Agent asks about another firm's client | Denied by policy; the denial and the failed rule are on the record | Advisor asks the assistant for an account summary | Each sentence linked to its source; one unsupported claim flagged | Advisor asks the assistant to place a trade | Preview recorded, then execution paused for a named approver | Third-party agent moves money over MCP | Approval requested, decided by a person, used once, transfer executed | Hidden instructions in an uploaded document | Guardrail fired; the model treated the file as data; no transfer | Audit service outage | Reads continued with a recorded gap; the action was blocked | Administrator edits the archive | Verification detected and located the change

> Speaker notes: The proof of concept runs all four enforcement points, mock systems of record and the Audit Plane as real services talking over HTTP, with a web interface that replays any interaction and verifies the archive live. It can run against a real Claude model or a deterministic stand-in. Keys, the archive and the time authority are simulated; the structure and the record format are what the standard specifies.

---

## Slide 14: Teams inherit the controls, they do not build them

Adoption

Step 1


**Route through the gateways**

Models and tools are reached only through the shared points. No custom logging code.

Step 2


**Register the service**

One form: the service, its owner, its data classification and its signing key.

Step 3


**Pass the conformance check**

The standard scenarios replay automatically against the new service before go-live.

Step 4


**Go live, already audited**

Replay, verification, alerts and exports work on day one, the same for every team.

For product teams: a shorter path to production, because audit, approvals and masking come with the platform.

For Compliance and Audit: one place to look, one record format, one verification report, for every AI use in the firm.


> Speaker notes: This is the "easy path" the standard was asked to provide. The proof of concept's shared client library and the four gateways are the platform pieces; a team that uses them gets the whole control set without writing audit code of its own.

---

## Slide 15: What we are asking for

Decisions requested


**Adopt the standard**

Make it mandatory for every AI capability exposed to third parties, and the default for internal AI use.


**Fund the shared platform**

The Audit Plane and the four gateways as a firm-wide service, owned by [platform team], budget [$__].


**Gate production on conformance**

No third-party AI integration goes live until it passes the conformance scenarios through the gateways.


**Pilot with two advisory firms**

Read-only MCP access first, then approved actions, starting [quarter], with Compliance reviewing the records.

Open items for Legal and Compliance: confirm the rule mapping, set retention years for informational interactions, and agree the approver roles for executed actions.


> Speaker notes: Bracketed items are placeholders for the owner, the budget and the pilot quarter. The pilot sequence, reads first then approved actions, mirrors the action classes in the standard and limits exposure while the records are reviewed.

---

## Slide 16: Plain-language glossary

Appendix

- Term | What it means here | Agent | Software that uses an AI model to decide which steps to take, then takes them | MCP | Model Context Protocol: a standard way for an outside AI agent to call our tools | Enforcement point | A shared gateway every AI call must pass; it applies policy and writes the record | Provenance stamp | A tag on each returned value: which system, which record, when, and a fingerprint | Grounding | Linking each sentence of an answer to the stamped values it relied on | Hash chain | Each record carries the fingerprint of the previous one, so edits break the chain | Checkpoint | A signed, independently timestamped summary of all records up to that moment | Fail closed | If the record cannot be written, the action does not happen | Tokenisation | Replacing a sensitive value with a stand-in; the original is kept in a sealed vault

> Speaker notes: Keep this slide for the question-and-answer session. The full architecture document and the runnable proof of concept are available for anyone who wants the technical detail.
