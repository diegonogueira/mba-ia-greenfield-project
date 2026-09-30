---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 15
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-09-30T14:54:35-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T13:48:53-03:00"
issues:
  - id: AMB-1
    status: open
    summary: "'rascunho' in Fase 03 vs draft→publication flow of Fase 04"
  - id: DG-1
    status: open
    summary: "Phase 02 JWT guard has no optional-auth mode needed by TD-10 option A"
  - id: DG-2
    status: open
    summary: ".env.example from phase 02 breaks docker compose .env parsing"
  - id: OQ-1
    status: open
    summary: "TD-01 pending — Message Queue Technology"
  - id: OQ-2
    status: open
    summary: "TD-02 pending — Large File Upload Strategy (up to 10GB)"
  - id: OQ-3
    status: open
    summary: "TD-03 pending — Video Status Lifecycle and Processing Failure Policy"
  - id: OQ-4
    status: open
    summary: "TD-04 pending — Video Worker Runtime"
  - id: OQ-5
    status: open
    summary: "TD-05 pending — Media Metadata and Thumbnail Toolchain"
  - id: OQ-6
    status: open
    summary: "TD-06 pending — Unique Video URL Identifier"
  - id: OQ-7
    status: open
    summary: "TD-07 pending — Streaming and Download Delivery"
  - id: OQ-8
    status: open
    summary: "TD-08 pending — Object Storage Client Library"
  - id: OQ-9
    status: open
    summary: "TD-09 pending — Bucket Layout, Object Keys and Provisioning"
  - id: OQ-10
    status: open
    summary: "TD-10 pending — Access Policy for Video Reads"
  - id: OQ-11
    status: open
    summary: "TD-11 pending — Test Strategy for Storage, Queue and FFmpeg"
  - id: OQ-12
    status: open
    summary: "TD-12 pending — Canonical Environment Keys"
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

- **AMB-1** — The capability "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload" uses the word *rascunho*, while Fase 04 (neighbor) lists "Fluxo de rascunho → publicação" and "Visibilidade do vídeo: público ou unlisted". It is not stated whether the Fase 03 draft is the same state that Fase 04 later publishes (a processed video would stay "rascunho" until published) or only the pre-upload/pre-processing state of the file. The status enum, the transition to `ready` and who may read a processed video depend on this boundary. Explicit choice: (a) Fase 03 `status` describes only the upload/processing lifecycle (`draft` = pre-registered, file not yet complete); publication/visibility is a separate dimension that Fase 04 adds on top of `ready`; (b) `draft` persists after processing and Fase 03 must already model publication.

### Missing Decisions

_None._

### Dependency Gaps

- **DG-1** — TD-10 (pending) recommends that public read routes recognize the owner through an *optional* bearer token, but the global `JwtAuthGuard` delivered by phase-02-auth (`phase-02-auth/TD-02`, custom guard) only supports two modes: protected, or `@Public()` with no authentication at all. No prior phase delivers an optional-authentication mode. Explicit choice: (a) extend the phase 02 guard in this phase with an opt-in optional-auth mode (valid token → user attached; missing token → anonymous; invalid token → 401), covered by its own SI and tests; (b) choose a TD-10 option that does not need it.
- **DG-2** — Fase 03 must bring new services up with `docker compose`, which interpolates variables from `nestjs-project/.env`. The `.env.example` delivered in phase 02 contains `MAIL_FROM="StreamTube" <noreply@streamtube.com>` (unquoted `<`/`>`), which makes `docker compose` abort with `unexpected character "<"` when `.env` is created from the example — the exact pitfall `nestjs-project/CLAUDE.md` → "Environment File Conventions" warns about. The new `S3_*`/`REDIS_*`/`VIDEO_*` keys also have to be added to that file. Explicit choice: (a) fix the example value (bare address, display name composed in `mail.config.ts` as the CLAUDE.md recommends) in the infrastructure SI of this phase; (b) leave it and document a manual workaround.

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

- **OQ-1** — TD-01 pending — Message Queue Technology. Resolution: fill the **Decision:** field of TD-01 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-2** — TD-02 pending — Large File Upload Strategy (up to 10GB). Resolution: fill the **Decision:** field of TD-02 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-3** — TD-03 pending — Video Status Lifecycle and Processing Failure Policy. Resolution: fill the **Decision:** field of TD-03 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-4** — TD-04 pending — Video Worker Runtime. Resolution: fill the **Decision:** field of TD-04 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-5** — TD-05 pending — Media Metadata and Thumbnail Toolchain. Resolution: fill the **Decision:** field of TD-05 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-6** — TD-06 pending — Unique Video URL Identifier. Resolution: fill the **Decision:** field of TD-06 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-7** — TD-07 pending — Streaming and Download Delivery. Resolution: fill the **Decision:** field of TD-07 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-8** — TD-08 pending — Object Storage Client Library. Resolution: fill the **Decision:** field of TD-08 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-9** — TD-09 pending — Bucket Layout, Object Keys and Provisioning. Resolution: fill the **Decision:** field of TD-09 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-10** — TD-10 pending — Access Policy for Video Reads (metadata, stream, download, thumbnail). Resolution: fill the **Decision:** field of TD-10 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-11** — TD-11 pending — Test Strategy for Storage, Queue and FFmpeg. Resolution: fill the **Decision:** field of TD-11 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.
- **OQ-12** — TD-12 pending — Canonical Environment Keys for Storage, Queue and Worker. Resolution: fill the **Decision:** field of TD-12 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 3.

### UI Coverage Gaps

_None._

## Resolved Issues

_No issues resolved yet._
