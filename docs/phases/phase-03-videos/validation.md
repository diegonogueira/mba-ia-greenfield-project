---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-09-30T16:47:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T16:28:19-03:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "'rascunho' in Fase 03 vs draft→publication flow of Fase 04"
    resolved_by: clarification
  - id: DG-1
    status: resolved
    summary: "Phase 02 JWT guard has no optional-auth mode needed by TD-10 option A"
    resolved_by: clarification
  - id: DG-2
    status: resolved
    summary: ".env.example from phase 02 breaks docker compose .env parsing"
    resolved_by: clarification
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Message Queue Technology"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Large File Upload Strategy (up to 10GB)"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Video Status Lifecycle and Processing Failure Policy"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Video Worker Runtime"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — Media Metadata and Thumbnail Toolchain"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Unique Video URL Identifier"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — Streaming and Download Delivery"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Object Storage Client Library"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Bucket Layout, Object Keys and Provisioning"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Access Policy for Video Reads"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending — Test Strategy for Storage, Queue and FFmpeg"
    resolved_by: phase-03-videos/TD-11
  - id: OQ-12
    status: resolved
    summary: "TD-12 pending — Canonical Environment Keys"
    resolved_by: phase-03-videos/TD-12
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

- **AMB-1** _(resolved_by clarification)_ — 'rascunho' in Fase 03 vs draft→publication flow of Fase 04 — user chose (a): Fase 03 `status` describes only the upload/processing lifecycle (`draft` = pre-registered, file not complete yet); publication/visibility is a separate dimension that Fase 04 adds on top of `ready`.
- **DG-1** _(resolved_by clarification)_ — Phase 02 JWT guard has no optional-auth mode — user chose (a): extend the global guard in this phase with an opt-in optional-auth mode (valid token → user attached; no token → anonymous; invalid token → 401), with its own SI and tests.
- **DG-2** _(resolved_by clarification)_ — .env.example from phase 02 breaks docker compose `.env` parsing — user chose (a): fix it in the infrastructure SI (bare address in `.env.example`, display name composed in `mail.config.ts`).
- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 decided: Message Queue Technology — A (BullMQ + Redis).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 decided: Large File Upload Strategy — B (S3 multipart with presigned part URLs).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 decided: Video Status Lifecycle and Processing Failure Policy — A.
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 decided: Video Worker Runtime — A.
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 decided: Media Metadata and Thumbnail Toolchain — A.
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 decided: Unique Video URL Identifier — B.
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — TD-07 decided: Streaming and Download Delivery — B.
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — TD-08 decided: Object Storage Client Library — A (AWS SDK v3).
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — TD-09 decided: Bucket Layout, Object Keys and Provisioning — A.
- **OQ-10** _(resolved_by phase-03-videos/TD-10)_ — TD-10 decided: Access Policy for Video Reads — A.
- **OQ-11** _(resolved_by phase-03-videos/TD-11)_ — TD-11 decided: Test Strategy for Storage, Queue and FFmpeg — A.
- **OQ-12** _(resolved_by phase-03-videos/TD-12)_ — TD-12 decided: Canonical Environment Keys — A.
