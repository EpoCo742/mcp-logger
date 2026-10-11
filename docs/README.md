# Documentation

| Document | Audience | Files |
| --- | --- | --- |
| **AI Audit Logging Architecture** | Architects, platform and security engineers, Compliance | [`design/AI-Audit-Logging-Architecture.md`](design/AI-Audit-Logging-Architecture.md) · [PDF](design/AI-Audit-Logging-Architecture.pdf) |
| **Executive summary deck** | Leadership, Legal, Compliance, product owners | [`executive-summary-deck/README.md`](executive-summary-deck/README.md) (slide text) · [`executive-summary-deck/`](executive-summary-deck/) (deck source) |

The design document is the standard that the code in `src/` implements: the four enforcement points, the `AIAuditEvent` record, provenance and grounding, integrity controls, redaction, retention and the adoption path for teams.

The executive deck is a sixteen-slide, non-technical summary of the same material. Its source is the slide-per-file format used by the Claude Slides page (`deck.json` plus one HTML section per slide under `slides/`); `README.md` beside it is a plain-text rendering generated from those files.

Live, editable versions (private to the owner until shared):

- Design document: https://claude.ai/code/artifact/e26070e8-b645-460c-b691-e4df088ebbb7
- Executive deck: https://claude.ai/artifact/21V37n4dF64mSTA7Fy8TzU
