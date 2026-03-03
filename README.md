# LabelPilot

A prototype tool for TTB alcohol label compliance review. An agent enters the declared application fields, uploads the label artwork, and gets a pass/fail on every required field within seconds — without blocking their workflow.

**Live demo:** https://labelpilot-web.delightfulocean-7862ed4a.eastus.azurecontainerapps.io
**Access code:** available on request

---

## What it does

Agent enters what the application declares (brand name, class/type, ABV, net contents), uploads 1–10 label images, and the tool OCRs the artwork and compares field by field. Every ambiguous result is flagged for human review with a bounding box showing exactly where on the label the text was found. The agent accepts, rejects, or overrides each field and exports the decision record.

Fields verified:

- Brand name
- Class / type designation
- Alcohol content
- Net contents
- Government warning — all-caps `GOVERNMENT WARNING:` enforced; title case caught and flagged as TTB non-compliant

The agent always has the final say. Every field can be accepted, rejected, or overridden with a note in one click — the OCR result is a starting point, not a verdict. This is intentional: the tool handles the mechanical matching so the agent can focus their judgment on the cases that actually need it.

Bottler name/address and country of origin can be entered as optional context. They appear in the review checklist but are not OCR-verified in this version.

---

## Stack

| Layer | Technology | Why |
|---|---|---|
| Web | Next.js 15, TypeScript, Prisma | Fast server-rendered UI, type safety end-to-end, clean ORM for a schema that will evolve |
| Database | PostgreSQL (Azure) | Reliable, cloud-managed, doubles as the job queue for this prototype |
| OCR | Azure AI Vision + Tesseract fallback | Best accuracy on real-world labels; Tesseract ensures the pipeline never hard-fails |
| Storage | Azure Blob Storage | Keeps images inside the Azure boundary, scales without config |
| Worker | Python 3.11 | Mature OCR and image tooling ecosystem; runs independently so the web layer is never blocked |
| Hosting | Azure Container Apps | Managed containers with built-in ingress, secrets, and scaling — no infra overhead |

---

## Dev Tooling

- **Claude Code** — primary coding assistant; used for implementation, debugging, and iterating quickly under time pressure
- **Cursor** — editor with inline AI assistance for boilerplate and refactoring
- **Azure MCP Server** — Azure resource queries during infrastructure setup

---

## Assumptions

- **Manual field entry** — agents key in the declared application values. In production these would come from COLA. The architecture is structured so that swap is a data-source change, not a redesign.
- **Single-tenant prototype** — a shared invite code is sufficient for evaluation. Real multi-agent use would require per-account auth (see Planned Work).
- **Label photography quality** — reasonable photo quality assumed (upright, in-focus, adequate lighting). Heavy skew, glare, or motion blur will reduce OCR accuracy; a preprocessing pass is called out in Planned Work.
- **English-language labels only** — extraction logic targets US TTB requirements and English field values.
- **One application per submission** — each upload represents one product application. Bulk/batch import is a planned feature.
- **24-hour data retention** — acceptable for a prototype. A production deployment would align retention to the agency's records schedule.

---

## Trade-offs and Limitations

**What works, and where it stops:**

- OCR accuracy is good on clean, well-lit photos of standard labels. Decorative fonts, severe skew, and low-contrast printing will produce `needs_human` flags — intentionally, rather than a wrong confident answer.
- Government warning enforcement checks for the required all-caps `GOVERNMENT WARNING:` prefix and flags title-case variants. It does not verify the full warning text word-for-word.
- Bottler name and country of origin are collected and shown in the review checklist but are **not OCR-verified** in this version — they require contextual layout understanding beyond simple regex extraction.
- The worker runs as a single process polling the database. This is fine for prototype load; for production throughput it would move to Azure Storage Queue with KEDA autoscaling (see Planned Work).
- Storage and database are currently internet-accessible with credential auth. Private endpoints and Managed Identity are the production path (called out in Security section).
- No image preprocessing — the pipeline sends images to Azure Vision as-is. OpenCV deskew/contrast normalization would improve results on difficult photography.

---

## Pipeline

```
Agent submits fields + images
        ↓
Web validates, writes Job to PostgreSQL (status: queued)
Responds immediately — agent is not blocked
        ↓
Python worker polls DB, claims job
Downloads image from Azure Blob Storage (internal)
Runs Azure Vision OCR  →  Tesseract fallback if endpoint unavailable
Extracts each field (regex + four-tier fuzzy matching)
Compares against declared values, writes results to DB
        ↓
Review page polls and renders results as they arrive
Agent sees first result within ~5 seconds of upload
Agent reviews pass/fail per field, overrides where needed
Job marked complete, decision record exportable as CSV or JSON
```

Multiple images per application are handled natively. A field passes if it is found with sufficient confidence in **any** of the submitted label panels — which is how TTB evaluates a complete label submission across front, back, and neck panels.

The web server and worker never talk to each other directly. They coordinate only through the database, keeping the two processes fully decoupled.

---

## Design decisions

**Separate worker process** — OCR on a real label takes 1–3 seconds per image. Offloading to a background worker keeps the web response instant and lets multiple labels process in parallel. The agent is never blocked waiting.

**Azure Vision over a vision LLM** — A vision LLM would be more flexible but non-deterministic: confidence scores vary on identical inputs and it is difficult to explain to a compliance agent exactly why a field failed. The structured OCR + regex approach gives consistent, auditable, explainable results. It also eliminates the prompt injection surface entirely — no user input is ever passed to a language model.

**Azure Vision over Tesseract** — In testing on real labels, Tesseract missed fields that Azure Vision caught reliably, especially on decorative fonts and slightly skewed shots. Tesseract is retained as an automatic fallback if the Azure endpoint is unavailable, so the pipeline degrades gracefully rather than failing.

**Manual field entry** — This prototype does not integrate with COLA. The agent keys in the declared values for proof of concept. The architecture is structured so that COLA integration is a data-source swap, not a redesign.

---

## Security

### Upload hardening

Every file upload passes through a layered validation stack before anything is stored or processed:

- **MIME type whitelist** — only `image/png` and `image/jpeg` accepted
- **Magic bytes inspection** — first 8 bytes of each file are read and matched against the actual PNG (`\x89PNG`) and JPEG (`\xFF\xD8\xFF`) signatures; declared type and extension cannot be spoofed
- **Double-extension blocking** — filenames like `evil.php.jpg` are rejected outright
- **File size limit** — 10 MB per file (configurable via env)
- **File count limit** — 1–10 files per submission
- **Empty file rejection** — zero-byte files blocked
- **Filename sanitization** — path traversal characters, null bytes, and special characters stripped before storage

### API and session security

- All protected routes verify a session cookie server-side before any processing occurs
- Input validated with strict Zod schemas (types, lengths, required fields) on every endpoint
- Rate limiting: 20 requests per 60-second window per session, enforced before any DB or storage call
- Error responses never expose stack traces, query details, or internal paths
- HTTPS enforced at the Azure Container Apps ingress layer — no plaintext traffic
- Session cookie is `httpOnly`, `SameSite=Lax`, with a 24-hour TTL matching data retention

### Auth

A shared invite code gates all protected routes. This is explicitly a prototype control — it demonstrates the auth boundary without requiring Azure AD provisioning for evaluation. The session model (httpOnly cookie → server-validated session ID) is structured to swap directly to per-account token-based auth in a future iteration. See Planned Work.

### Cloud containment — no outbound traffic outside Azure

Every service call in the pipeline is internal to Azure East US:

| From | To | Channel |
|---|---|---|
| Web container | PostgreSQL | Azure internal, TLS |
| Web container | Blob Storage | Azure SDK, TLS |
| Worker container | PostgreSQL | Azure internal, TLS |
| Worker container | Blob Storage | Azure SDK, TLS |
| Worker container | Azure Vision | Azure Cognitive Services, TLS |

No user data leaves the Azure boundary and its all marked for deletion. No user-controlled URLs are ever fetched by the system (SSRF prevention by design). Azure credentials are stored as Container Apps secrets and are never present in application code or client-side bundles. All resource access is loggable and auditable via Azure Monitor and Log Analytics.

This architecture is aligned with **Microsoft's enterprise compliance posture** — Azure is FedRAMP High authorized (Azure Government), holds a FedRAMP Moderate authorization on the commercial cloud, and operates under Microsoft's standard data processing and data protection agreements. A production deployment targeting federal use would go through the formal ATO process on Azure Government, but the architectural choices here are consistent with that path.

### Data lifecycle and privacy

- All jobs, results, uploaded images, and associated artifacts are set to expire after **24 hours**
- On deletion (manual or automatic expiry), images are removed from Blob Storage and all DB records are purged — no orphaned artifacts
- Session IDs are random UUIDs — no PII is stored or linked to a session
- No analytics, telemetry, or third-party scripts are loaded in the browser
- Retention window can be tightened to session-end if the data handling requirement demands it

### No prompt injection surface

Because the AI component is Azure Vision (a structured OCR API), there is no language model in the processing pipeline. User-supplied text is never interpolated into an AI prompt. Field comparison is entirely deterministic. This is a deliberate security choice as much as an auditability one.

### What a hardened production deployment would add

- **Private endpoints** for PostgreSQL and Blob Storage — currently both are internet-accessible with credential auth; VNet integration closes this
- **Managed Identity** for the worker — removes all connection strings from environment variables; access is logged against the identity in Azure's audit trail
- **Azure Key Vault** — centralize and rotate secrets without redeployment
- **Azure WAF / Front Door** — DDoS protection and geo-restriction (US traffic only) at the network edge
- **Azure Defender for Storage** — malware scanning on blob uploads as a second pass after our own validation
- **CSP headers** — Content-Security-Policy to restrict script execution in the browser
- **Audit log per decision** — every agent override persisted with timestamp and session, queryable for compliance audits

---

## Local setup

### Prerequisites
- Node.js ≥ 18, Python ≥ 3.10
- Azure AI Vision resource (or use Tesseract for local/offline)

### Web
```bash
cd web
cp .env.example .env
npm install
npm run db:migrate
npm run dev               # http://localhost:3000
```

### Worker (second terminal)
```bash
cd worker
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env      # set OCR_BACKEND + credentials
python worker.py
```

### OCR backends

**Azure AI Vision** (recommended) — handles decorative fonts, label skew, and uneven lighting. Set `OCR_BACKEND=azure` with your endpoint and key.

**Tesseract** — offline, no credentials needed. Set `OCR_BACKEND=tesseract`. Reliable for clean scans; struggles with stylised or angled text.

**Stub** — if neither is configured, all fields are flagged for human review. Useful for UI development and testing without credentials.

---

## Tests

```bash
cd worker && python -m pytest tests/ -v   # 114 tests
cd web && npm test                         # 52 tests
```

Worker tests cover field extraction, all four matching tiers, government warning enforcement, confidence scoring, and each OCR backend — no live credentials needed. Web tests cover upload validation (including magic bytes), session and auth logic, rate limiting, storage adapters, all API route handlers, and export formatting.

---

## Planned work

**Bulk / batch import**
Upload a CSV of application fields alongside a ZIP of label images. The backend parses, validates, and creates all jobs in a single transaction. Requires a dedicated batch review UI — a summary dashboard showing pass/fail counts across the batch, filterable to `needs_human` items only, with bulk export. The job creation and worker layers need no changes; the engineering effort is in the secure ZIP extraction (path traversal, decompression bomb limits) and the batch review flow.

**Azure Storage Queue**
Replace the current database polling loop with Azure Storage Queue + KEDA autoscaling. The worker and storage adapter are already structured for this swap. Benefits: backpressure handling, dead-letter queue for failed jobs, per-message audit trail, and scale-to-zero on idle.

**Image preprocessing**
Deskew, contrast normalization, and glare reduction before OCR. Azure Vision handles moderate quality issues natively, but severe cases (heavy rotation, strong glare, motion blur) still fail. A preprocessing pass with OpenCV or PIL would extend the range of acceptable label photography.

**Infrastructure tiers**
Move to geo-redundant Blob Storage (RA-GRS), PostgreSQL Business Critical with zone redundancy, and a higher Azure Vision tier for increased throughput and SLA. Relevant for production volume and any data residency or backup requirements.

**Azure AD authentication**
Replace the shared invite code with per-agent Microsoft accounts. Gets you MFA, Conditional Access policies, RBAC (senior agent vs. reviewer vs. admin), and a full audit log of who reviewed what and when. The session cookie model in the current code maps directly to a token issued on AD login.

**COLA integration**
Pull application data directly from TTB's internal system rather than requiring agents to key in fields manually. Labels and declared values are pre-populated based on the agent's assigned queue. This is the end state — the manual input model in this prototype is intentionally structured to make the COLA data source a straightforward swap.
