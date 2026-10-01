---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-30
scope_description: "Backend foundation for video upload and processing: object storage usage (S3/MinIO), background queue technology, direct-to-storage upload of files up to 10GB, draft pre-registration and status lifecycle, FFmpeg worker for metadata and thumbnail, unique video URL, streaming and download delivery."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — receives the videos module (draft pre-registration, upload session, unique slug, stream/download/thumbnail delivery), the storage and queue integrations, the video worker entrypoint, the `videos` migration, and the new Compose services (object storage, queue broker, worker).
- `next-frontend/` — no open decision in this document: the video UI is explicitly out of scope for this phase (backend-only challenge). The cross-layer TDs below (TD-02, TD-06, TD-07) define the HTTP/storage contract a future frontend phase will consume.

**Already decided upstream (not reopened here):** the object storage is S3-compatible — MinIO locally in Docker, AWS S3 in production (`docs/diagrams/software-arch.mermaid`, `CLAUDE.md`). The error envelope `{ statusCode, error, message }` (`phase-02-auth/TD-07`), request validation with class-validator (`phase-02-auth/TD-06`), the global JWT guard with `@Public()` opt-out (`phase-02-auth/TD-02`) and config via `registerAs` + Joi (`phase-01-configuracao-base/TD-01..TD-04`) are inherited.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram leaves the queue as "TBD". The API must publish a processing job after each upload and a separate worker must consume it with retries, without blocking the HTTP request. The choice adds (or not) a new infrastructure service to `compose.yaml` and defines the NestJS integration.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Jobs stored in Redis; `@nestjs/bullmq` provides `BullModule.forRootAsync`, `registerQueue`, `@InjectQueue` (producer) and `@Processor` + `WorkerHost` (consumer). Built-in attempts/backoff, `UnrecoverableError`, custom `jobId` (idempotent enqueue), stalled-job recovery and graceful `worker.close()`.
- **Pros:** Official NestJS recipe (docs "Queues"); covers retry/backoff/dead-letter (failed set) without custom code; worker concurrency is one option; Redis is a lightweight container.
- **Cons:** New infrastructure dependency (Redis) that must run with `maxmemory-policy noeviction` and AOF for durability; at-least-once delivery (a stalled job may run twice → processing must be idempotent).

### Option B: pg-boss (queue on PostgreSQL)
- Jobs stored in a `pgboss` schema in the existing PostgreSQL, using `SKIP LOCKED`. Retry, backoff and dead-letter supported.
- **Pros:** No new container; transactional enqueue in the same DB as the `videos` table (no dual-write).
- **Cons:** No official NestJS module (manual lifecycle wiring); queue load competes with the OLTP database; the "Message Queue" container of the architecture diagram would not exist as a separate service.

### Option C: RabbitMQ (AMQP)
- Durable queues with manual ack and prefetch; NestJS via `@golevelup/nestjs-rabbitmq` or `amqplib`.
- **Pros:** Mature broker with routing/exchanges; strong delivery guarantees; language-agnostic consumers.
- **Cons:** Retry with backoff requires DLX/TTL topology by hand; heavier container and operational surface; routing features are unused by a single job type.

**Recommendation:** BullMQ + Redis — it is the queue integration documented by NestJS (`@nestjs/bullmq`) and gives attempts, exponential backoff, `UnrecoverableError` and `jobId` deduplication out of the box, which TD-03 relies on; Redis is a small dedicated container, so the queue becomes a real Compose service as the architecture diagram expects, instead of sharing load with PostgreSQL (pg-boss) or hand-building retry topologies (RabbitMQ).

**Decision:** A (BullMQ + Redis)
**Libraries:** `@nestjs/bullmq@^11.0.5`, `bullmq@^6.3.10`, `ioredis@^5.11.1`
**Revisions:**
- 2026-09-30 — Libraries changed from `@nestjs/bullmq@^12.0.0` to `@nestjs/bullmq@^11.0.5` and `ioredis@^5.11.1` added. Rationale: `@nestjs/bullmq@12` (and its `@nestjs/bull-shared`) ship as ESM-only packages, which the CommonJS NestJS 11 build and Jest cannot load; `11.0.5` is the latest CommonJS release and still supports `bullmq@^6` and NestJS 11. `bullmq@6` made `ioredis` an optional peer, so it must be installed explicitly; `^5` because `typeorm@0.3.28` declares an optional `ioredis@^5` peer. Found while implementing SI-03.8.

---

## TD-02: Large File Upload Strategy (up to 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** A 10GB body must not be held by the API process (memory, event loop, request timeouts). The project plan also asks that the upload can be resumed after a connection failure (`docs/project-plan.md` → Pontos de Atenção). The handshake lives on both sides: the backend defines it now, a future frontend phase implements the client.

**Options:**

### Option A: Streamed multipart through the API
- Client sends `multipart/form-data` to the API; the API pipes the stream to S3 (`@aws-sdk/lib-storage` `Upload`).
- **Pros:** Single endpoint; server sees every byte (can validate on the fly).
- **Cons:** The API holds a socket and bandwidth for the whole 10GB transfer; no resume (a dropped connection restarts from zero); request timeouts and proxy body limits become the bottleneck — exactly what the capability forbids.

### Option B: S3 multipart upload with presigned part URLs (direct to storage)
- API creates the multipart upload and returns presigned `UploadPart` URLs; the client `PUT`s each part straight to the storage; the API then completes the upload. Parts can be re-signed and re-sent individually.
- **Pros:** Zero video bytes cross the API (only small JSON calls); parallel parts; resume by listing already-uploaded parts and re-signing only the missing ones; same protocol on MinIO and AWS S3.
- **Cons:** Client must split the file and track parts; presigned URLs need a storage hostname reachable by the client (see TD-07); the API cannot inspect content during upload (validated later by the worker, TD-05).

### Option C: tus resumable protocol (tusd server)
- A tus server receives chunked PATCH requests and stores to S3; the API is notified via hooks.
- **Pros:** Standardized resumable protocol with client libraries.
- **Cons:** Adds another server to operate; bytes still flow through a server we run; hook integration duplicates the draft/complete lifecycle already owned by the API.

**Recommendation:** S3 multipart with presigned part URLs — the only option in which the API never carries the 10GB body, with native resume (list parts + re-sign) and no extra server. Parameters: max file size 10 GiB (10737418240 bytes), part size 64 MiB (≤ 160 parts, well within S3's 10,000-part and 5 MiB-minimum limits), part URL TTL 1 hour; the API completes the upload from the storage's own part listing (ListParts) and checks that all expected parts are present and that their total equals the declared size before calling CompleteMultipartUpload.

**Decision:** B (S3 multipart with presigned part URLs)
**Libraries:** —

---

## TD-03: Video Status Lifecycle and Processing Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The video row must exist as a draft as soon as the upload starts, move to processing when the upload completes, and end as ready or failed. The policy on failure (retry vs fail-fast) and the guarantees against double processing (at-least-once queue, TD-01) must be defined once and shared by API and worker.

**Options:**

### Option A: Single `status` enum + queue retries + terminal `failed`
- `status` ∈ `draft → processing → ready | failed`, each transition guarded by the expected current status (compare-and-set). Transient errors (storage/network) are retried by the queue (3 attempts, exponential backoff); invalid media is failed immediately (`UnrecoverableError`); after the last attempt the worker sets `failed` with a `failure_reason`.
- **Pros:** One column answers "where is this video"; idempotent worker (skips when status is not `processing`); failures are visible in the DB, not only in Redis.
- **Cons:** A failed video needs a new upload (no reprocess endpoint in this phase).

### Option B: Separate `upload_status` and `processing_status` columns
- Two independent state machines for upload and processing.
- **Pros:** Finer-grained states.
- **Cons:** Invalid combinations must be prevented by code; more complex queries; no capability needs the extra granularity.

### Option C: Single status, no retries (fail-fast)
- Any worker error sets `failed` at once.
- **Pros:** Simplest worker.
- **Cons:** A transient MinIO/Redis hiccup permanently fails a 10GB upload.

**Recommendation:** Option A — a single guarded enum keeps the draft pre-registration and the processing lifecycle observable in one column, while BullMQ retries (TD-01) absorb transient failures and `UnrecoverableError` stops retrying media that FFmpeg cannot read; the compare-and-set guard makes the at-least-once delivery harmless.

**Decision:** A (Single guarded status enum + queue retries + terminal `failed`)
**Libraries:** —

---

## TD-04: Video Worker Runtime

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The architecture diagram shows a "Video Worker (FFmpeg)" container separate from the API. FFmpeg work is CPU-heavy and must not compete with HTTP handling.

**Options:**

### Option A: Separate container, same codebase, dedicated entrypoint
- `src/worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP server); the processor module is imported only by `WorkerModule`. Compose runs it as its own service from the same image with a different command.
- **Pros:** Reuses entities, config, storage and videos services without duplication; isolates CPU load; scales independently (more replicas / concurrency); matches the diagram.
- **Cons:** The image carries FFmpeg; two processes must be kept in sync on config.

### Option B: Processor inside the API process
- Register the `@Processor` in the API module.
- **Pros:** No extra container.
- **Cons:** FFmpeg competes with request handling — contradicts "sem impacto na performance" and the diagram.

### Option C: Separate subproject (own package.json)
- A new `video-worker/` project with its own dependencies.
- **Pros:** Hard isolation.
- **Cons:** Duplicates entity/config/storage code or requires a shared package (monorepo tooling not in the stack).

**Recommendation:** Option A — the worker is a real separate container as in the diagram, while reusing the NestJS modules already in `nestjs-project/` (a new subproject would duplicate them); the processor lives only in `WorkerModule`, so the API never consumes jobs.

**Decision:** A (Separate container, same codebase, dedicated entrypoint)
**Libraries:** —

---

## TD-05: Media Metadata and Thumbnail Toolchain

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker must extract duration and technical metadata and render one frame as a thumbnail, for files up to 10GB that live in object storage.

**Options:**

### Option A: System `ffprobe`/`ffmpeg` binaries via `child_process.execFile`, reading a presigned URL
- `ffprobe -print_format json -show_format -show_streams <url>` and `ffmpeg -ss <t> -i <url> -frames:v 1` read the object over HTTP range requests; the JPEG goes back to storage.
- **Pros:** No 10GB download to local disk (FFmpeg seeks with range reads); no wrapper library; binaries from the Debian package of the image.
- **Cons:** Output parsing and argument building are ours; binaries must exist in every container that runs the worker or its tests.

### Option B: `fluent-ffmpeg` wrapper
- Fluent API over the same binaries.
- **Pros:** Less argument plumbing.
- **Cons:** The npm package is marked "no longer supported" (deprecated); still needs the binaries.

### Option C: `ffmpeg-static` / `ffprobe-static` npm binaries + download to temp file
- Binaries shipped via npm; object downloaded before processing.
- **Pros:** No OS package.
- **Cons:** Downloading 10GB per job to local disk; large npm artifacts per platform.

**Recommendation:** Option A — reading through a short-lived presigned URL lets FFmpeg seek without copying up to 10GB to the worker disk, and avoids the deprecated `fluent-ffmpeg`. Thumbnail = one JPEG frame at 10% of the duration (0 s for streams without duration), scaled to at most 1280 px wide; metadata stored: duration (s), width, height, video/audio codec, container format, bit rate, frame rate. A file with no video stream is invalid media (unrecoverable, TD-03).

**Decision:** A (System ffprobe/ffmpeg via execFile over presigned URL)
**Libraries:** —

---

## TD-06: Unique Video URL Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every video needs a short public identifier used in its URL (`/videos/{slug}` in the API, a watch page in a future frontend). It must never collide and must not expose the internal primary key or allow enumeration.

**Options:**

### Option A: UUID primary key in the URL
- Use the existing `id` (uuid v4).
- **Pros:** Zero extra column; collision-free.
- **Cons:** 36-char URL, not "short" as the project plan asks (Pontos de Atenção: "URL curta e única").

### Option B: Random 11-char base64url slug + unique constraint + retry
- `crypto.randomBytes(8)` encoded base64url (11 chars, 64 bits of entropy), `UNIQUE` index in the DB; on unique violation, regenerate (bounded retries).
- **Pros:** Short, YouTube-like, non-sequential; the DB constraint is the final guarantee; no dependency.
- **Cons:** Needs a retry path (rarely exercised).

### Option C: Sqids/Hashids of a sequential number
- Encode a sequence value into a short string.
- **Pros:** Deterministic, no retry.
- **Cons:** Reversible (reveals volume/order); adds a dependency and a sequence column.

**Recommendation:** Option B — 64 random bits make collisions practically impossible, the unique index guarantees "sem conflito" even in that case (retry on `23505`, same pattern as channel nicknames in phase 02), and the slug is short and not enumerable.

**Decision:** B (Random 11-char base64url slug + unique constraint + retry)
**Libraries:** —

---

## TD-07: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** A player must start without downloading the whole file (HTTP range requests / `206 Partial Content`), and the user must be able to download the original file. The diagram shows the frontend streaming directly from Object Storage.

**Options:**

### Option A: API proxies the bytes with Range support
- `GET /videos/:slug/stream` reads the object with a `Range` and pipes it with `206`.
- **Pros:** Single origin; auth on every chunk.
- **Cons:** Every byte of every view passes through the API (bandwidth, event loop) — the load the upload strategy just avoided.

### Option B: API redirects (302) to a short-lived presigned GET URL
- The API resolves the video, checks access, and redirects to a presigned URL; the storage answers `Range` requests with `206` natively. Download uses the same mechanism with `response-content-disposition=attachment`.
- **Pros:** Zero bytes through the API; native range/seek; works for `<video src>` and plain links; identical on MinIO and S3.
- **Cons:** The presigned URL must be signed with a storage hostname reachable by the client (a public endpoint distinct from the in-network `minio` host); a URL leaked within its TTL can be reused.

### Option C: HLS adaptive streaming (transcoding to segments)
- Worker transcodes to HLS renditions; the player loads playlists.
- **Pros:** Adaptive bitrate.
- **Cons:** Heavy transcoding and storage multiplication — beyond "extração de duração e metadados" in this phase's scope.

**Recommendation:** Option B — the storage serves range requests natively, so streaming and download cost the API one redirect instead of the full transfer, matching the "Frontend → streams from Object Storage" relation of the diagram. Playback/download URL TTL: 6 hours (long videos keep issuing range requests during playback). Presigned URLs handed to clients are signed against `S3_PUBLIC_ENDPOINT`; server-side calls (API, worker) use `S3_ENDPOINT` (Compose service name).

**Decision:** B (302 redirect to short-lived presigned GET URL)
**Libraries:** —

---

## TD-08: Object Storage Client Library

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage is fixed as S3-compatible (MinIO locally, S3 in production). The client library determines whether that swap is configuration-only and how presigned multipart URLs are produced.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Modular S3 client; `forcePathStyle` + custom `endpoint` for MinIO; `getSignedUrl` for `UploadPartCommand`/`GetObjectCommand`.
- **Pros:** The production target's own SDK — MinIO → S3 is a config change; full multipart API (Create/UploadPart/ListParts/Complete/Abort).
- **Cons:** Verbose command objects.

### Option B: MinIO JavaScript SDK (`minio`)
- MinIO's S3 client.
- **Pros:** Compact API.
- **Cons:** Presigning individual multipart parts is not part of its public API; S3 becomes a "compatible" target instead of the native one.

**Recommendation:** Option A — the AWS SDK v3 speaks the production API natively and exposes the multipart + presign primitives TD-02 and TD-07 need; MinIO is reached by pointing `endpoint` at it with path-style addressing.

**Decision:** A (AWS SDK v3)
**Libraries:** `@aws-sdk/client-s3@^3.1143.0`, `@aws-sdk/s3-request-presigner@^3.1143.0`

---

## TD-09: Bucket Layout, Object Keys and Provisioning

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Video files and thumbnails need a key scheme shared by API and worker, and the bucket must exist when the stack starts. The official MinIO images are no longer published on Docker Hub (`minio/minio` and `minio/mc` return "not found"), so the image source is part of the decision.

**Options:**

### Option A: One private bucket, prefixes per asset, init container creates it
- Bucket `streamtube-media` (private); keys `videos/{videoId}/original` and `thumbnails/{videoId}.jpg`; a one-shot `minio-init` service (MinIO client `mc mb --ignore-existing`) runs after `minio` is healthy. Images: the community-maintained MinIO fork `pgsty/minio` / `pgsty/mc`, pinned by release tag.
- **Pros:** Single set of credentials/policies; keys derive from the video id (no user-controlled names in keys); provisioning is declarative in Compose, not in application code.
- **Cons:** Depends on a community image for local dev (same S3 API; production uses AWS S3).

### Option B: Two buckets (`videos`, `thumbnails`)
- **Pros:** Separate lifecycle/policies per asset type.
- **Cons:** Two buckets to provision and configure for no current need.

### Option C: API creates the bucket at boot
- **Pros:** No init container.
- **Cons:** Application code with admin rights over storage; wrong responsibility for production S3.

**Recommendation:** Option A — one private bucket with id-derived keys keeps API and worker in agreement without extra config, and a one-shot init container keeps provisioning in infrastructure. Everything stays private; clients only get presigned URLs (TD-07).

**Decision:** A (One private bucket, prefixes per asset, init container)
**Libraries:** —

---

## TD-10: Access Policy for Video Reads (metadata, stream, download, thumbnail)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário", "URL única por vídeo, sem conflito com outros vídeos"

**Context:** The platform lets anonymous users watch (`docs/project-plan.md` → Visão Geral), but publication and visibility (public/unlisted) belong to Phase 04 and listings to Phase 07. Phase 03 must still decide who can read a video and its files, and the owner must be able to follow the status of a video that is not ready yet.

**Options:**

### Option A: Ready videos readable by anyone holding the slug; non-ready only by the owner
- `GET /videos/:slug` and its stream/download/thumbnail work anonymously when `status = ready`; for `draft|processing|failed` only the channel owner sees it (others get 404). Public routes accept an optional bearer token so the owner is recognized.
- **Pros:** Matches "anonymous users can watch" with no listing (effectively link-only until Phase 04 adds visibility); drafts are never exposed; the owner can track processing.
- **Cons:** Requires an optional-authentication mode in the global guard.

### Option B: Owner-only reads until Phase 04
- Every read requires the owner's token.
- **Pros:** Most restrictive.
- **Cons:** "Download do vídeo pelo usuário" and streaming would work for the uploader only; `<video src>` cannot send a bearer header.

### Option C: Everything public
- **Pros:** Simplest.
- **Cons:** Exposes drafts and failed uploads of other users.

**Recommendation:** Option A — it delivers streaming/download to any viewer with the unique URL without exposing unfinished uploads; write operations (upload session, complete) stay owner-only behind the global JWT guard. Phase 04 will layer publication/visibility on top of `status = ready`.

**Decision:** A (Ready videos readable via slug; non-ready owner-only)
**Libraries:** —

---

## TD-11: Test Strategy for Storage, Queue and FFmpeg

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The testing guide's `references/external-systems.md` suggests a local-filesystem storage adapter and leaves the queue as "TBD"; this phase introduces real MinIO, Redis and FFmpeg in Compose.

**Options:**

### Option A: Real MinIO, Redis and FFmpeg from Compose, with test isolation
- Integration/E2E tests hit the Compose services; the test queue uses its own BullMQ `prefix` so the running `video-worker` container never consumes test jobs; sample videos are generated at test time with `ffmpeg -f lavfi` (no binary fixtures in git).
- **Pros:** Tests exercise the real S3 multipart protocol, real presigned URLs and real FFmpeg output; no adapter code that exists only for tests.
- **Cons:** Tests require the stack up; slower than mocks.

### Option B: Local filesystem adapter + mocked queue
- Storage interface with a filesystem implementation for tests.
- **Pros:** Fast, no services.
- **Cons:** Multipart/presigned flows cannot be exercised; the adapter is code that production never runs.

**Recommendation:** Option A — the upload protocol (TD-02) and delivery (TD-07) only exist on a real S3 API, so a filesystem adapter would leave the core of the phase untested; `nestjs-project/CLAUDE.md` already requires tests to run inside the Compose stack. The testing guide's external-systems reference is updated to reflect it.

**Decision:** A (Real MinIO, Redis and FFmpeg from Compose, with test isolation)
**Libraries:** —

---

## TD-12: Canonical Environment Keys for Storage, Queue and Worker

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"

**Context:** The same keys are read by the Joi schema, `registerAs` factories, `compose.yaml` and `.env.example`; API and worker must share them.

**Options:**

### Option A: Namespaced `S3_*`, `REDIS_*`, `VIDEO_*` keys, Compose service names as hosts
- `S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`; `REDIS_HOST=redis`, `REDIS_PORT`, `QUEUE_PREFIX`; `VIDEO_UPLOAD_PART_SIZE_BYTES`, `VIDEO_UPLOAD_URL_TTL_SECONDS`, `VIDEO_PLAYBACK_URL_TTL_SECONDS`, `VIDEO_WORKER_CONCURRENCY`. Credentials required, tunables with defaults.
- **Pros:** Mirrors AWS naming (drop-in for S3), follows the `registerAs` per-domain pattern (`storage`, `queue`, `video`), service names as hosts per `CLAUDE.md`.
- **Cons:** `S3_PUBLIC_ENDPOINT=localhost` is the one value that is not a Compose service name — it is the address the client (browser/curl on the host) uses, never a service-to-service host.

### Option B: MinIO-specific names (`MINIO_*`)
- **Pros:** Explicit about the local tool.
- **Cons:** Misleading once production points at AWS S3.

**Recommendation:** Option A — provider-neutral names keep the MinIO → S3 swap a pure configuration change, and separating `S3_ENDPOINT` (in-network) from `S3_PUBLIC_ENDPOINT` (client-facing) is what makes presigned URLs usable from outside the Docker network without breaking the "service name as host" rule for service-to-service traffic.

**Decision:** A (Namespaced `S3_*`, `REDIS_*`, `VIDEO_*` keys)
**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | A — BullMQ + Redis (`@nestjs/bullmq`) | A |
| TD-02 | Cross-layer | Large File Upload Strategy (up to 10GB) | B — S3 multipart with presigned part URLs | B |
| TD-03 | Backend | Video Status Lifecycle and Processing Failure Policy | A — single guarded enum + queue retries + terminal `failed` | A |
| TD-04 | Backend | Video Worker Runtime | A — separate container, same codebase, dedicated entrypoint | A |
| TD-05 | Backend | Media Metadata and Thumbnail Toolchain | A — system ffprobe/ffmpeg via execFile over presigned URL | A |
| TD-06 | Cross-layer | Unique Video URL Identifier | B — random 11-char base64url slug + unique index + retry | B |
| TD-07 | Cross-layer | Streaming and Download Delivery | B — 302 to short-lived presigned GET URL | B |
| TD-08 | Backend | Object Storage Client Library | A — AWS SDK v3 | A |
| TD-09 | Repo-wide | Bucket Layout, Object Keys and Provisioning | A — one private bucket, id-derived keys, init container | A |
| TD-10 | Backend | Access Policy for Video Reads | A — ready = readable via slug; non-ready = owner only | A |
| TD-11 | Backend | Test Strategy for Storage, Queue and FFmpeg | A — real Compose services with test isolation | A |
| TD-12 | Repo-wide | Canonical Environment Keys | A — `S3_*`, `REDIS_*`, `VIDEO_*` with service-name hosts | A |
