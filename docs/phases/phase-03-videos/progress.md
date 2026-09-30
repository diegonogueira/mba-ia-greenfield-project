# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 3/12 completed

### SI-03.1 — Infra: Dependencies, Compose Services and FFmpeg Image
- **Status:** completed
- **Tests:** no tests (Infra) — regression: 22 unit/integration suites (142 tests) and 3 E2E suites (52 tests) passing
- **Observations:**
  - Official `minio/minio` and `minio/mc` images are no longer on Docker Hub; `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` and `pgsty/mc:RELEASE.2026-09-16T00-00-00Z` pulled and verified (`minio-init` created `streamtube-media`, exit 0).
  - `redis-cli config get maxmemory-policy` → `noeviction`; `ffprobe`/`ffmpeg` 5.1.9 available in the `nestjs-api` image.
  - npm resolved `@aws-sdk/client-s3`/`s3-request-presigner` 3.1144.0 (inside the planned `^3.1143.0` range).
  - `MAIL_FROM` now holds the bare address; `mail.config.ts` composes `"StreamTube" <address>` (a full value is kept as-is). Joi default changed accordingly (DG-2).
  - Pre-existing, out of this SI: `src/database/migrations.integration-spec.ts` fails when the DB was created by `npm run migration:run` (it drops tables but not the `verification_tokens_type_enum` type). It is fixed in SI-03.4, which already edits that spec. Excluded from this SI's regression run.
  - Local-only: host ports 5432/6379 were taken by other projects on this machine; an uncommitted `compose.override.yaml` remaps them. Container-to-container traffic is unaffected.

### SI-03.2 — Configuration Namespaces for Storage, Queue and Video
- **Status:** completed
- **Tests:** 13 passing (env.validation.integration-spec.ts: 10, swagger.config.spec.ts: 3 regression)
- **Observations:**
  - Existing `requiredEnv` fixture of the env validation spec now includes the two required S3 credentials.

### SI-03.3 — Storage Module (S3 client, multipart and presigned URLs)
- **Status:** completed
- **Tests:** 8 passing (storage.service.integration-spec.ts: 7, storage.module.spec.ts: 1)
- **Observations:**
  - Presigned URLs used by the tests are signed for the in-network endpoint (`src/test/storage.ts`), since the test process cannot reach the host's `localhost:9000`; the audience test signs against a fake public host to prove URLs carry `S3_PUBLIC_ENDPOINT`.
  - `npm run lint` was already failing before this phase (151 errors, mostly `no-unsafe-*` in phase 01/02 test files). Handled in final verification, since the Definition of Done requires lint to pass.

### SI-03.4 — Video Entity, Migration and Repository
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.5 — Optional Authentication Mode in the Global JWT Guard
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.6 — Endpoint POST /videos (draft pre-registration + upload session)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Endpoints GET /videos/{slug}/upload and POST /videos/{slug}/upload/parts (resume)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — Endpoint POST /videos/{slug}/upload/complete (queue producer)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — Media Probe Service (ffprobe metadata + ffmpeg thumbnail)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Video Worker: Processor, Entrypoint and Compose Service
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Endpoints GET /videos/{slug}, /stream, /download, /thumbnail
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — OpenAPI Artifact and AI Documentation Update
- **Status:** pending
- **Tests:** —
- **Observations:** none
