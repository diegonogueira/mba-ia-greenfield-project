---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-09-30T15:36:35-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-30T15:36:25-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T15:35:37-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-30T12:56:49-03:00"
  docs/project-plan.md: "2026-09-30T12:56:33-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver video upload and processing end to end in `nestjs-project/`: object storage (MinIO/S3) for video files and thumbnails, a Redis-backed processing queue consumed by a separate FFmpeg worker container, direct-to-storage multipart upload of files up to 10GB with automatic draft pre-registration, automatic extraction of duration/metadata and thumbnail generation, a unique short URL per video, and streaming (HTTP range) plus download — so that "upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas" hold on the Docker Compose stack.

---

## Step Implementations

### SI-03.1 — Infra: Dependencies, Compose Services and FFmpeg Image

**Description:** Install the phase libraries and bring the new infrastructure up with Docker Compose — Redis (queue broker), MinIO (object storage) with a one-shot bucket provisioner — and add FFmpeg to the dev image, so every later SI runs against real services.

**Technical actions:**

1. Install in `nestjs-project`: `@nestjs/bullmq@^12.0.0`, `bullmq@^6.3.10` (per `phase-03-videos/TD-01`), `@aws-sdk/client-s3@^3.1143.0`, `@aws-sdk/s3-request-presigner@^3.1143.0` (per `phase-03-videos/TD-08`)
2. Add to `compose.yaml` the `redis` service (`redis:8.10.2`, `redis-server --appendonly yes --maxmemory-policy noeviction`, healthcheck `redis-cli ping`, port 6379) per `library-refs.md` → bullmq Redis requirements
3. Add to `compose.yaml` the `minio` service (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, `server /data --console-address :9001`, ports 9000/9001, named volume, healthcheck on `/minio/health/live`) and the one-shot `minio-init` service (`pgsty/mc:RELEASE.2026-09-16T00-00-00Z`) that runs `mc alias set` + `mc mb --ignore-existing` for `S3_BUCKET` after `minio` is healthy (per `phase-03-videos/TD-09`); make `nestjs-api` depend on `redis` (healthy), `minio` (healthy) and `minio-init` (completed successfully)
4. Add `ffmpeg` (Debian package, provides `ffmpeg` and `ffprobe`) to `Dockerfile.dev`, so the API container can run the worker's tests and the worker container (SI-03.10) reuses the same image (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`)
5. Update `.env.example`: add the TD-12 keys with Compose-service defaults (`S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=streamtube-media`, `S3_FORCE_PATH_STYLE=true`, `REDIS_HOST=redis`, `REDIS_PORT=6379`, `QUEUE_PREFIX=bull`, `VIDEO_UPLOAD_PART_SIZE_BYTES=67108864`, `VIDEO_UPLOAD_URL_TTL_SECONDS=3600`, `VIDEO_PLAYBACK_URL_TTL_SECONDS=21600`, `VIDEO_WORKER_CONCURRENCY=1`) and replace the unquoted `MAIL_FROM="StreamTube" <noreply@streamtube.com>` with the bare address `MAIL_FROM=noreply@streamtube.com`, composing the display name in `mail.config.ts` (DG-2 resolution) (per `phase-03-videos/TD-12`)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `cp .env.example .env && docker compose up -d` starts without `.env` parse errors; `docker compose ps` shows `db`, `mailpit`, `redis`, `minio` running and `minio-init` exited with code 0
- `docker compose exec redis redis-cli config get maxmemory-policy` returns `noeviction`
- The bucket `streamtube-media` exists in MinIO after `minio-init` runs (listing it with the MinIO client succeeds)
- `docker compose exec nestjs-api ffprobe -version` and `ffmpeg -version` exit with code 0
- Existing suites still pass (`npm test -- --runInBand`, `npm run test:e2e`)

---

### SI-03.2 — Configuration Namespaces for Storage, Queue and Video

**Description:** Expose the TD-12 environment keys through validated `registerAs` namespaces (`storage`, `queue`, `video`) shared by the API and the worker, following the phase 01 config conventions.

**Technical actions:**

1. Create `src/config/storage.config.ts` — `registerAs('storage', ...)` with `endpoint` (`S3_ENDPOINT`), `publicEndpoint` (`S3_PUBLIC_ENDPOINT`), `region`, `accessKeyId`, `secretAccessKey`, `bucket`, `forcePathStyle` (boolean) (per `phase-03-videos/TD-12`)
2. Create `src/config/queue.config.ts` — `registerAs('queue', ...)` with `host` (`REDIS_HOST`), `port` (`REDIS_PORT`), `prefix` (`QUEUE_PREFIX`)
3. Create `src/config/video.config.ts` — `registerAs('video', ...)` with `uploadPartSizeBytes`, `uploadUrlTtlSeconds`, `playbackUrlTtlSeconds`, `workerConcurrency`
4. Extend `src/config/env.validation.ts`: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` required; `S3_ENDPOINT` (default `http://minio:9000`), `S3_PUBLIC_ENDPOINT` (default `http://localhost:9000`), `S3_REGION` (`us-east-1`), `S3_BUCKET` (`streamtube-media`), `S3_FORCE_PATH_STYLE` (`'true'|'false'`, default `'true'`), `REDIS_HOST` (`redis`), `REDIS_PORT` (`6379`), `QUEUE_PREFIX` (`bull`), `VIDEO_UPLOAD_PART_SIZE_BYTES` (integer ≥ 5242880, default 67108864), `VIDEO_UPLOAD_URL_TTL_SECONDS` (default 3600), `VIDEO_PLAYBACK_URL_TTL_SECONDS` (default 21600), `VIDEO_WORKER_CONCURRENCY` (integer ≥ 1, default 1)
5. Register the three factories in `ConfigModule.forRoot({ load: [...] })` of `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Unit: S3 credentials required, defaults applied, part size below 5 MiB rejected | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- The application boots with the `.env.example` values
- Starting without `S3_ACCESS_KEY_ID` fails Joi validation at bootstrap
- `VIDEO_UPLOAD_PART_SIZE_BYTES=1048576` fails validation (below the 5 MiB S3 minimum)
- Omitted tunables resolve to the documented defaults (`QUEUE_PREFIX=bull`, part size 67108864, playback TTL 21600)

---

### SI-03.3 — Storage Module (S3 client, multipart and presigned URLs)

**Description:** Encapsulate every object-storage operation of the phase behind `StorageService`, with one S3 client for in-network calls and one signer for client-facing URLs.

**Technical actions:**

1. Create `src/storage/storage.module.ts` + `src/storage/storage.service.ts` — two `S3Client` instances built from `storageConfig`: `internal` (`endpoint = S3_ENDPOINT`) for API/worker calls and `public` (`endpoint = S3_PUBLIC_ENDPOINT`) used only by `getSignedUrl`; both with `forcePathStyle`, `requestChecksumCalculation: 'WHEN_REQUIRED'`, `responseChecksumValidation: 'WHEN_REQUIRED'` (per `phase-03-videos/TD-08`, `library-refs.md` → @aws-sdk/client-s3)
2. Multipart methods: `createMultipartUpload(key, contentType)`, `presignUploadParts(key, uploadId, partNumbers, ttl)` (public signer, `UploadPartCommand`), `listParts(key, uploadId)` (paginated), `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)` (per `phase-03-videos/TD-02`)
3. Object methods: `putObject(key, body, contentType)`, `headObject(key)`, `deleteObject(key)`, `presignGetObject(key, { ttl, audience: 'public' | 'internal', downloadFileName? })` — `downloadFileName` sets `ResponseContentDisposition: attachment; filename="..."` (per `phase-03-videos/TD-07`, `library-refs.md` → @aws-sdk/s3-request-presigner)
4. Define key builders in `src/storage/storage.keys.ts`: `videoObjectKey(videoId) = videos/{videoId}/original`, `thumbnailObjectKey(videoId) = thumbnails/{videoId}.jpg` (per `phase-03-videos/TD-09`)
5. Translate storage errors the services must branch on (`NoSuchUpload`, `InvalidPart`, `EntityTooSmall`) into typed errors exported by the module; other SDK errors propagate unchanged

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (real MinIO): create multipart → `PUT` parts to presigned URLs → `listParts` → complete → `headObject`; presigned GET with `Range` returns `206`; `downloadFileName` sets `Content-Disposition: attachment`; `put`/`delete`; abort; `EntityTooSmall` translated | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compiles with `storageConfig` | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- A 2-part upload (5 MiB + remainder) through presigned part URLs completes and `headObject` reports the exact total size
- A presigned GET requested with `Range: bytes=0-99` answers `206` with exactly 100 bytes
- A presigned download URL answers with `Content-Disposition: attachment; filename="<name>"`
- Completing with a non-final part smaller than 5 MiB raises the typed storage error instead of an untyped SDK error
- URLs from the `public` audience carry the `S3_PUBLIC_ENDPOINT` host; `internal` ones carry the `S3_ENDPOINT` host

---

### SI-03.4 — Video Entity, Migration and Repository

**Description:** Persist videos linked to their channel with the status lifecycle, through a custom repository that owns the queries and the compare-and-set transitions.

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with the fields, enum, transformers (`bigint`/`numeric` → `number`) and indexes of `### Data Model → Video`; `VideoStatus` enum in `src/videos/videos.constants.ts` (per `phase-03-videos/TD-03`)
2. Add the inverse side `@OneToMany(() => Video, (video) => video.channel) videos` to `src/channels/entities/channel.entity.ts`
3. Generate `src/database/migrations/<timestamp>-CreateVideos.ts` via `npm run migration:generate -- src/database/migrations/CreateVideos` and review it (enum type, FK `ON DELETE CASCADE`, unique `slug`, index `channel_id`)
4. Create `src/videos/videos.repository.ts` (`VideosRepository`, wraps `Repository<Video>`): `create`, `findBySlug` (with `channel`), `findById`, `transitionStatus(id, from, to, patch)` issuing `UPDATE ... WHERE id AND status = from` and returning whether a row changed (per `phase-03-videos/TD-03`)
5. Create `src/videos/videos.module.ts` with `TypeOrmModule.forFeature([Video])` and `VideosRepository`; register `VideosModule` in `AppModule`; add `videos` to `cleanAllTables` in `src/test/create-test-data-source.ts` and the new migration/entity to `src/database/migrations.integration-spec.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique `slug`, `status` default `draft`, enum rejects unknown values, FK cascade on channel delete, `size_bytes` > 2³¹ round-trips as number | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosRepository` | Integration: `findBySlug` loads channel; `transitionStatus` updates only from the expected status | `src/videos/videos.repository.integration-spec.ts` |
| Migrations | Integration: apply/revert now covers `videos` | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with the enum, FK, unique `slug` and `channel_id` index; `migration:revert` drops them
- Inserting two videos with the same `slug` fails with a unique-constraint violation
- A new video row has `status = 'draft'`
- `transitionStatus(id, processing, ready)` on a `draft` video changes nothing and reports `false`
- Deleting a channel deletes its videos

---

### SI-03.5 — Optional Authentication Mode in the Global JWT Guard

**Description:** Let public read routes recognize the owner when a bearer token is sent, without changing any existing route (DG-1 resolution, required by `phase-03-videos/TD-10`).

**Technical actions:**

1. Create `src/auth/decorators/optional-auth.decorator.ts` — `@OptionalAuth()` = `SetMetadata(IS_OPTIONAL_AUTH_KEY, true)`, used together with `@Public()`
2. Update `src/auth/guards/jwt-auth.guard.ts`: on `@Public()` routes that also carry `@OptionalAuth()`, a missing `Authorization` header passes as anonymous (`request.user` undefined); a present header must hold a valid `Bearer` token (payload attached to `request.user`) or the guard throws `UnauthorizedException`. Routes with only `@Public()` keep ignoring the header; protected routes are unchanged (per inherited `phase-02-auth/TD-02`)
3. Create `src/auth/decorators/optional-current-user.decorator.ts` — `@OptionalCurrentUser()` returning `JwtPayload | undefined`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `JwtAuthGuard` | Unit: optional route + no header → allowed, no user; + valid token → user attached; + invalid/malformed token → 401; plain `@Public()` ignores a bad header; protected route unchanged | `src/auth/guards/jwt-auth.guard.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- On a route marked `@Public()` + `@OptionalAuth()`, a request without `Authorization` succeeds as anonymous
- The same route with `Authorization: Bearer <valid access token>` exposes that user's payload to the handler
- The same route with `Authorization: Bearer invalid` returns `401`
- Every existing auth E2E test keeps passing (no behavior change for `@Public()`-only and protected routes)

---

### SI-03.6 — Endpoint POST /videos (draft pre-registration + upload session)

**Route:** POST /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated — the video is created in the caller's own channel

**Description:** Starting an upload pre-registers the video as `draft` with a unique slug and opens the S3 multipart upload, returning presigned part URLs — the file itself never reaches the API.

**Technical actions:**

1. Create `src/videos/video-slug.util.ts` — `generateVideoSlug()` = `crypto.randomBytes(8).toString('base64url')` (11 chars) (per `phase-03-videos/TD-06`); add `ChannelsService.findByUserId(userId)` in `src/channels/channels.service.ts`
2. Create `src/videos/dto/create-video.dto.ts` (`CreateVideoDto` per `#### Validation Rules — Video upload`) and response DTOs `src/videos/dto/video-response.dto.ts` (`VideoResponseDto`, `UploadSessionResponseDto`) with `@ApiProperty`
3. Create `src/videos/videos.service.ts` — `createDraft(userId, dto)`: resolve channel (`CHANNEL_NOT_FOUND`), generate id + slug, compute `partCount = ceil(sizeBytes / partSize)`, `createMultipartUpload(videoObjectKey(id), mimeType)`, insert the `draft` row with `upload_id` (retry the slug inside a SAVEPOINT on unique violation, max 5 attempts, per `.claude/rules/typeorm-queries.md`), abort the multipart upload if the insert finally fails, presign all part URLs with `VIDEO_UPLOAD_URL_TTL_SECONDS` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
4. Add `VideoNotFoundException`, `ChannelNotFoundException` (and the remaining `### Error Catalog` codes used by SI-03.7/03.8/03.11) to `src/common/exceptions/domain.exception.ts`
5. Create `src/videos/videos.controller.ts` (`@ApiTags('videos')`, `@Controller('videos')`) with `POST /videos` → `201`, documented with `@ApiBearerAuth('access-token')` and every error status; register controller + `VideosService` in `VideosModule` (imports `ChannelsModule`, `StorageModule`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generateVideoSlug` | Unit: 11 chars, base64url alphabet, different values across calls | `src/videos/video-slug.util.spec.ts` |
| `VideosService.createDraft` | Unit: part count for 1 byte / exact multiple / 10 GiB (160 parts of 64 MiB); `CHANNEL_NOT_FOUND`; slug retry on unique violation; multipart aborted when the insert fails | `src/videos/videos.service.spec.ts` |
| `VideosService.createDraft` | Integration (DB + MinIO): draft row persisted with `upload_id`, `video_key = videos/{id}/original`; the multipart upload exists in MinIO (ListParts succeeds) | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: returns the user's channel / `null` | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` with a valid body and access token returns `201` with `status: "draft"`, an 11-char `slug` and `upload.parts.length == upload.partCount`
- A `videos` row exists immediately after the call with `status = 'draft'` and the caller's `channel_id`
- `POST /videos` with `sizeBytes: 10737418241` returns `400` with `error: "VALIDATION_ERROR"`
- `POST /videos` with `mimeType: "image/png"` returns `400` with `error: "VALIDATION_ERROR"`
- `POST /videos` without a token returns `401`
- For `sizeBytes: 10737418240` the response has `partSize: 67108864` and `partCount: 160`
- Each `upload.parts[].url` accepts an HTTP `PUT` of the part bytes straight to the storage (the API is not in the data path)

---

### SI-03.7 — Endpoints GET /videos/{slug}/upload and POST /videos/{slug}/upload/parts (resume)

**Route:** GET /videos/{slug}/upload, POST /videos/{slug}/upload/parts
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only (non-owner → 404)

**Description:** Let the owner inspect which parts the storage already holds and obtain fresh URLs for missing or expired parts, so an interrupted 10GB upload resumes without restarting (per `phase-03-videos/TD-02`).

**Technical actions:**

1. Add `VideosService.findOwnedDraft(slug, userId)` — `VIDEO_NOT_FOUND` when the slug is unknown or the channel's `user_id` differs; `VIDEO_UPLOAD_NOT_ACTIVE` when `status ≠ draft`
2. Add `VideosService.getUploadSession(slug, userId)` → `{ partSize, partCount, uploadedParts }` from `storage.listParts` (`partSize` recomputed from the stored `size_bytes`/`partCount` rule of SI-03.6)
3. Add `VideosService.signParts(slug, userId, partNumbers)` — `INVALID_PART_NUMBER` for any number > `partCount`; otherwise presign with `VIDEO_UPLOAD_URL_TTL_SECONDS`
4. Create `src/videos/dto/sign-parts.dto.ts` (`partNumbers`: `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10000)`, `@ArrayUnique`, `@IsInt({ each: true })`, `@Min(1, { each: true })`)
5. Add the two routes to `VideosController` (`GET` → `200`; `POST .../parts` → `@HttpCode(200)`), with OpenAPI decorators for 200/400/401/404/409

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (session) | Unit: non-owner → `VIDEO_NOT_FOUND`; non-draft → `VIDEO_UPLOAD_NOT_ACTIVE`; part > `partCount` → `INVALID_PART_NUMBER` | `src/videos/videos.service.spec.ts` |
| `VideosService` (session) | Integration (DB + MinIO): after `PUT`ting part 1, `getUploadSession` lists exactly part 1 with its size; re-signed URL for part 2 accepts a `PUT` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5, SI-03.6

**Acceptance criteria:**

- After uploading part 1 of 3, `GET /videos/{slug}/upload` by the owner returns `200` with `uploadedParts: [{ partNumber: 1, sizeBytes: <bytes sent> }]`
- `POST /videos/{slug}/upload/parts` with `{ "partNumbers": [2, 3] }` returns `200` with two URLs and an `expiresAt` about one hour ahead
- `POST /videos/{slug}/upload/parts` with `{ "partNumbers": [999] }` for a 3-part upload returns `400` with `error: "INVALID_PART_NUMBER"`
- Both routes called by another authenticated user return `404` with `error: "VIDEO_NOT_FOUND"`; without a token they return `401`
- Both routes on a video that is no longer `draft` return `409` with `error: "VIDEO_UPLOAD_NOT_ACTIVE"`

---

### SI-03.8 — Endpoint POST /videos/{slug}/upload/complete (queue producer)

**Route:** POST /videos/{slug}/upload/complete
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only (non-owner → 404)

**Description:** Close the upload from the storage's own part listing, move the video `draft → processing` and publish the `process-video` job, so processing starts automatically after the upload (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`).

**Technical actions:**

1. Register `BullModule.forRootAsync` in `AppModule` from `queueConfig` (`connection: { host, port }`, `prefix`) and `BullModule.registerQueue({ name: 'video-processing' })` in `VideosModule`; queue/job names and job options as `as const` constants in `src/videos/videos.constants.ts` (per `library-refs.md` → @nestjs/bullmq, `### Events/Messages → process-video`)
2. Add `VideosService.completeUpload(slug, userId)`: `findOwnedDraft`; `listParts`; `UPLOAD_INCOMPLETE` if any part in `1..partCount` is missing or the sizes do not add up to `size_bytes`; `completeMultipartUpload` with the listed ETags (storage rejection → `UPLOAD_INCOMPLETE`; `NoSuchUpload` with the object already present → treat as completed, making a retried call safe)
3. In one DB transaction: `transitionStatus(draft → processing, upload_id = null)` (no row changed → `VIDEO_UPLOAD_NOT_ACTIVE`) and `queue.add('process-video', { videoId }, { jobId: videoId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete, removeOnFail })`; an enqueue error rolls the status back and propagates
4. Add `POST /videos/{slug}/upload/complete` to `VideosController` with `@HttpCode(202)` returning `VideoResponseDto`, documented for 202/401/404/409/422

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: missing part / size mismatch → `UPLOAD_INCOMPLETE`; storage rejection → `UPLOAD_INCOMPLETE`; CAS miss → `VIDEO_UPLOAD_NOT_ACTIVE`; enqueue failure propagates | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (DB + MinIO + Redis, test `QUEUE_PREFIX`): real 2-part upload → object exists with the full size, row `processing` with `upload_id = null`, job `process-video` with `jobId = videoId` waiting in the queue; enqueue failure leaves the row `draft` | `src/videos/videos.service.integration-spec.ts` |
| `VideosModule` | Unit: compiles with `BullModule` + `StorageModule` + `ChannelsModule` | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.7

**Acceptance criteria:**

- After all parts are uploaded, `POST /videos/{slug}/upload/complete` by the owner returns `202` with `status: "processing"`
- The `videos` row is `processing` and the queue `video-processing` holds a `process-video` job whose `data.videoId` is the video id
- Calling complete again returns `409` with `error: "VIDEO_UPLOAD_NOT_ACTIVE"` and no second job is created
- Completing with a missing part returns `422` with `error: "UPLOAD_INCOMPLETE"` and the video stays `draft`
- Another user gets `404 VIDEO_NOT_FOUND`; no token gets `401`

---

### SI-03.9 — Media Probe Service (ffprobe metadata + ffmpeg thumbnail)

**Description:** Wrap the FFmpeg binaries used by the worker: read duration/technical metadata and render one JPEG frame directly from a URL, without downloading the file (per `phase-03-videos/TD-05`).

**Technical actions:**

1. Create `src/video-processing/media-probe.service.ts` — `probe(url)`: `execFile('ffprobe', ['-v','error','-print_format','json','-show_format','-show_streams', url])` with a timeout; map to `{ durationSeconds, width, height, videoCodec, audioCodec, formatName, bitRate, frameRate }` (numbers parsed, `r_frame_rate` fraction evaluated, absent audio → `null`); no video stream or ffprobe failure → `InvalidMediaError`
2. `captureThumbnail(url, atSeconds)`: `execFile('ffmpeg', ['-v','error','-ss', t, '-i', url, '-frames:v','1','-vf',"scale='min(1280,iw)':-2",'-f','image2pipe','-vcodec','mjpeg','pipe:1'], { encoding: 'buffer' })` → `Buffer`; empty output → `InvalidMediaError`
3. `thumbnailTimestamp(durationSeconds)` = `durationSeconds * 0.1`, `0` when duration is unknown or ≤ 0
4. Create `src/test/sample-video.ts` — test helper generating a short MP4 (`ffmpeg -f lavfi -i testsrc=... -f lavfi -i sine=...`) in `os.tmpdir()` so no binary fixture is committed (per `phase-03-videos/TD-11`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Unit: ffprobe JSON mapping (frame-rate fraction, missing audio, missing duration), `thumbnailTimestamp` rules | `src/video-processing/media-probe.service.spec.ts` |
| `MediaProbeService` | Integration (real ffmpeg + MinIO presigned URL): generated 2 s 320x240 clip → duration ≈ 2, width 320, height 240, codecs; thumbnail buffer starts with the JPEG magic bytes; a text file → `InvalidMediaError` | `src/video-processing/media-probe.service.integration-spec.ts` |

**Dependencies:** SI-03.1, SI-03.3

**Acceptance criteria:**

- Probing the generated sample over a presigned internal URL returns `durationSeconds` within 0.1 s of the generated length and the generated width/height
- The captured thumbnail is a JPEG (`FF D8 FF`) no wider than 1280 px
- A non-video object raises `InvalidMediaError` (never a generic error)
- The object is read over HTTP by FFmpeg — nothing is written to the worker's disk besides FFmpeg's own buffers

---

### SI-03.10 — Video Worker: Processor, Entrypoint and Compose Service

**Description:** Consume `process-video` jobs in a separate container that extracts metadata, stores the thumbnail and moves the video to `ready` — or to `failed` with a reason (per `phase-03-videos/TD-03`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`).

**Technical actions:**

1. Add to `VideosService` the worker-side transitions `markReady(videoId, result)` and `markFailed(videoId, reason)` (compare-and-set from `processing`, set `processed_at`; `failure_reason` truncated to 500 chars) and `findById`
2. Create `src/video-processing/video.processor.ts` — `@Processor('video-processing', { concurrency })` extending `WorkerHost`: load video; missing → `UnrecoverableError`; `status ≠ processing` → return without side effects (idempotency); presign internal GET; `probe`; `captureThumbnail`; `putObject(thumbnailObjectKey(id), jpeg, 'image/jpeg')`; `markReady`. `InvalidMediaError` → `markFailed` + `UnrecoverableError`; any other error → `markFailed` only when `job.attemptsMade + 1 >= job.opts.attempts`, then rethrow so BullMQ retries/fails (per `library-refs.md` → bullmq)
3. Create `src/video-processing/video-processing.module.ts` (imports `VideosModule`, `StorageModule`; provides `VideoProcessor`, `MediaProbeService`) and `src/worker.module.ts` (`ConfigModule` with the same `load`/Joi schema as `AppModule`, `TypeOrmModule.forRootAsync`, `BullModule.forRootAsync`, `VideoProcessingModule`) — the processor is imported only here, never by `AppModule`
4. Create `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()` (graceful `worker.close()`); npm scripts `start:worker` (`node dist/worker`) and `start:worker:dev` (`nest start --watch --entryFile worker --path tsconfig.worker.json`, compiling to `dist-worker/` so it never clobbers the API's `dist/`); add `dist-worker` to `.gitignore`
5. Add the `video-worker` service to `compose.yaml`: same build as `nestjs-api` (`Dockerfile.dev`, FFmpeg included), same bind mount, `command: npm run start:worker:dev`, `restart: unless-stopped`, depends on `db`/`redis`/`minio` healthy and `minio-init` completed

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Unit: non-`processing` video skipped with no calls; missing video → `UnrecoverableError`; `InvalidMediaError` → `markFailed` + `UnrecoverableError`; transient error on attempt 1 of 3 rethrown without `markFailed`; on attempt 3 of 3 → `markFailed` + rethrow | `src/video-processing/video.processor.spec.ts` |
| `VideoProcessor` | Integration (DB + MinIO + ffmpeg): real uploaded sample → row `ready` with `duration_seconds`, `metadata`, `thumbnail_key`, `processed_at`, thumbnail object present in MinIO; uploaded text file → row `failed` with `failure_reason` | `src/video-processing/video.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compiles and resolves `VideoProcessor` | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.8, SI-03.9

**Acceptance criteria:**

- `docker compose up -d` starts `video-worker`; its logs show the Nest application context started and no HTTP listener
- A job for a valid uploaded video ends with the row `ready`, `duration_seconds` set, `metadata.width/height` set, and `thumbnails/{id}.jpg` stored as `image/jpeg`
- A job for a non-video upload ends with the row `failed` and a non-empty `failure_reason`, without retries
- Re-delivering a job for a video already `ready` changes nothing (no new writes, no status change)
- The API process (`AppModule`) registers no BullMQ worker for `video-processing`

---

### SI-03.11 — Endpoints GET /videos/{slug}, /stream, /download, /thumbnail

**Route:** GET /videos/{slug}, GET /videos/{slug}/stream, GET /videos/{slug}/download, GET /videos/{slug}/thumbnail
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Public with optional authentication — `ready` videos for anyone holding the slug; other statuses only for the owner (per `### Authorization Matrix`)

**Description:** Expose the video by its unique URL and deliver playback (HTTP range, no full download), download and thumbnail through redirects to short-lived presigned URLs (per `phase-03-videos/TD-07`, `phase-03-videos/TD-10`).

**Technical actions:**

1. Add `VideosService.findVisible(slug, viewer?)` — unknown slug → `VIDEO_NOT_FOUND`; `status ≠ ready` and viewer is not the owner → `VIDEO_NOT_FOUND`
2. Add `VideosService.getPlaybackUrl(slug, viewer?, mode: 'stream' | 'download')` and `getThumbnailUrl(slug, viewer?)` — after `findVisible`, owner with `status ≠ ready` → `VIDEO_NOT_READY`; presign (`audience: 'public'`, `VIDEO_PLAYBACK_URL_TTL_SECONDS`) the original (download adds `downloadFileName = original_filename`) or the thumbnail key
3. Add the four routes to `VideosController` with `@Public()` + `@OptionalAuth()` and `@OptionalCurrentUser()`: `GET :slug` → `200 VideoResponseDto`; `GET :slug/stream|download|thumbnail` → `@Redirect()` `302` to the presigned URL; OpenAPI decorators for 200/302/401/404/409 (no `@ApiBearerAuth`, since the routes are public)
4. Add `src/videos/videos.mapper.ts` (`toVideoResponse(video)`) so the controller never returns the entity (hides `upload_id`, keys, `channel.user_id`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (reads) | Unit: visibility matrix (anonymous/non-owner/owner × each status), `VIDEO_NOT_READY` for owner, download URL carries the attachment filename | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.5, SI-03.10

**Acceptance criteria:**

- For a `ready` video, anonymous `GET /videos/{slug}` returns `200` with `status: "ready"`, `durationSeconds` and `metadata`
- `GET /videos/{slug}/stream` returns `302`; requesting the `Location` URL with `Range: bytes=0-1023` returns `206` with 1024 bytes and `Content-Range` — playback without downloading the whole file
- `GET /videos/{slug}/download` returns `302` whose target answers with `Content-Disposition: attachment; filename="<original file name>"`
- `GET /videos/{slug}/thumbnail` returns `302` whose target answers `200` with `Content-Type: image/jpeg`
- A `processing` video is `404 VIDEO_NOT_FOUND` for anonymous and non-owner callers, visible (`200`) to its owner, and its `/stream` returns `409 VIDEO_NOT_READY` to the owner
- `Authorization: Bearer invalid` on any of these routes returns `401`
- The response body never contains `upload_id`, `video_key`, `thumbnail_key` or the owner's `user_id`

---

### SI-03.12 — OpenAPI Artifact and AI Documentation Update

**Description:** Keep the exported contract and the AI-facing documentation coherent with the delivered code: `openapi.json`, `CLAUDE.md` (root and `nestjs-project/`), the testing guide's external-systems reference and `api.http` (per inherited `openapi-docs-nestjs/TD-02`, `phase-03-videos/TD-11`).

**Technical actions:**

1. Regenerate `nestjs-project/openapi.json` with `npm run openapi:export` (new `videos` tag and the 8 routes)
2. Update root `CLAUDE.md`: Message Queue = BullMQ + Redis, Video Worker container, object storage keys/buckets, the Phase 03 services in the architecture list
3. Update `nestjs-project/CLAUDE.md`: new Compose services (`redis`, `minio`, `minio-init`, `video-worker`) and readiness checks, worker commands, the `S3_ENDPOINT` vs `S3_PUBLIC_ENDPOINT` rule, the video endpoints, the queue/worker flow and the test prerequisites (FFmpeg in the image, test `QUEUE_PREFIX`)
4. Update `.claude/skills/testing-guide-nestjs-project/references/external-systems.md` — Object Storage and Message Queue sections describe the real MinIO/Redis strategy of `phase-03-videos/TD-11`
5. Add a "VÍDEOS" section to `nestjs-project/api.http` with the upload-session, complete and read requests

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `exportSpec` | Integration: exported document contains the `videos` paths | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.11

**Acceptance criteria:**

- `openapi.json` lists `POST /videos`, `GET /videos/{slug}`, `GET /videos/{slug}/upload`, `POST /videos/{slug}/upload/parts`, `POST /videos/{slug}/upload/complete`, `GET /videos/{slug}/stream`, `GET /videos/{slug}/download`, `GET /videos/{slug}/thumbnail`
- Every file, command, env key and endpoint cited in the updated `CLAUDE.md` files exists in the code or `compose.yaml`
- The external-systems reference no longer prescribes a filesystem storage adapter

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK — generated by the service (`crypto.randomUUID()`) before insert so the storage key can embed it |
| channel_id | uuid | not null, FK → `channels.id` `ON DELETE CASCADE`, indexed |
| slug | varchar(11) | not null, unique — random base64url (per `phase-03-videos/TD-06`) |
| title | varchar(100) | not null |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (per `phase-03-videos/TD-03`) |
| original_filename | varchar(255) | not null — file name declared by the client (used only in the download `Content-Disposition`) |
| mime_type | varchar(100) | not null — declared `video/*` type |
| size_bytes | bigint | not null — declared size; must equal the sum of uploaded parts at completion (TypeORM transformer → `number`) |
| video_key | varchar(255) | not null — `videos/{id}/original` (per `phase-03-videos/TD-09`) |
| upload_id | varchar(255) | nullable — S3 multipart `UploadId` while `status = draft`; set to `null` on completion |
| thumbnail_key | varchar(255) | nullable — `thumbnails/{id}.jpg`, set by the worker |
| duration_seconds | numeric(10,3) | nullable — set by the worker (TypeORM transformer → `number`) |
| metadata | jsonb | nullable — `{ width, height, videoCodec, audioCodec, formatName, bitRate, frameRate }` (per `phase-03-videos/TD-05`) |
| failure_reason | varchar(500) | nullable — set when `status = failed` |
| processed_at | timestamp | nullable — set when the worker finishes (`ready` or `failed`) |
| created_at | timestamp | CreateDateColumn |
| updated_at | timestamp | UpdateDateColumn |

**Relations:** `Video` many-to-one `Channel` (`channel_id`); `Channel` one-to-many `Video` (`videos`) — both sides declared.
**Indexes:** unique on `slug`; index on `channel_id`.
**Status transitions (compare-and-set, per `phase-03-videos/TD-03`):** `draft → processing` (upload completed, API) · `processing → ready` (worker success) · `processing → failed` (worker, invalid media or retries exhausted). Every transition is an `UPDATE ... WHERE id = :id AND status = :expected`; zero affected rows means the transition did not happen. `ready` and `failed` are terminal in this phase. Publication/visibility is **not** modelled here — Fase 04 adds it on top of `ready` (AMB-1 resolution).

### API Contracts

All error bodies use the inherited envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`). `401` responses on protected routes are produced by the global `JwtAuthGuard` (`{ statusCode: 401, message: "Unauthorized" }`, as in phase 02). `{slug}` is the 11-char public identifier (per `phase-03-videos/TD-06`).

**VideoResponse** (shape shared by several endpoints):
- id: string (uuid)
- slug: string (11 chars)
- title: string
- status: `draft` | `processing` | `ready` | `failed`
- mimeType: string
- sizeBytes: number
- durationSeconds: number | null
- metadata: `{ width, height, videoCodec, audioCodec, formatName, bitRate, frameRate }` | null
- failureReason: string | null
- channel: `{ id: string (uuid), nickname: string }`
- createdAt: string (ISO date)
- processedAt: string (ISO date) | null

#### POST /videos (SI-03.6)

Pre-registers the video as a draft and opens the multipart upload session (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`). No file bytes are sent to the API.

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- title: string, required — trimmed, 1–100 characters
- fileName: string, required — 1–255 characters
- mimeType: string, required — must match `^video\/[a-z0-9.+-]+$`
- sizeBytes: integer, required — 1 to 10737418240 (10 GiB)

**Response 201:**
- VideoResponse fields (`status: "draft"`)
- upload: `{ partSize: number, partCount: number, expiresAt: string (ISO date), parts: [{ partNumber: number, url: string }] }` — one presigned `PUT` URL per part, signed for `S3_PUBLIC_ENDPOINT` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-12`); `partCount = ceil(sizeBytes / partSize)`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation (including `sizeBytes` above 10 GiB or a non-`video/*` `mimeType`)
- 401: missing or invalid access token
- 404 CHANNEL_NOT_FOUND: the authenticated user has no channel

---

#### GET /videos/{slug}/upload (SI-03.7)

Returns the state of the upload session so a client can resume after a connection failure (lists what the storage already holds).

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- partSize: number
- partCount: number
- uploadedParts: `[{ partNumber: number, sizeBytes: number }]` — from the storage's ListParts, ordered by `partNumber`

**Error responses:**
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the caller is not the owner
- 409 VIDEO_UPLOAD_NOT_ACTIVE: video `status` is not `draft`

---

#### POST /videos/{slug}/upload/parts (SI-03.7)

Re-signs part URLs (expired URLs or parts to be re-sent). Returns `200` because no resource is created.

**Request headers:**
- Authorization: Bearer {access_token}
- Content-Type: application/json

**Request body:**
- partNumbers: integer[], required — 1 to 10000 items, unique, each ≥ 1

**Response 200:**
- expiresAt: string (ISO date)
- parts: `[{ partNumber: number, url: string }]`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation
- 400 INVALID_PART_NUMBER: a part number is greater than the session's `partCount`
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the caller is not the owner
- 409 VIDEO_UPLOAD_NOT_ACTIVE: video `status` is not `draft`

---

#### POST /videos/{slug}/upload/complete (SI-03.8)

Completes the multipart upload from the storage's own part listing, moves the video `draft → processing` and enqueues the processing job (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-03`). No request body. `202` because processing continues asynchronously.

**Request headers:**
- Authorization: Bearer {access_token}

**Response 202:**
- VideoResponse (`status: "processing"`)

**Error responses:**
- 401: missing or invalid access token
- 404 VIDEO_NOT_FOUND: slug does not exist or the caller is not the owner
- 409 VIDEO_UPLOAD_NOT_ACTIVE: video `status` is not `draft` (e.g. already completed)
- 422 UPLOAD_INCOMPLETE: a part in `1..partCount` is missing, the uploaded parts do not add up to `sizeBytes`, or the storage rejects the part set (e.g. a non-final part smaller than 5 MiB); the video stays `draft` so the client can fix and retry

---

#### GET /videos/{slug} (SI-03.11)

Video metadata and status (per `phase-03-videos/TD-10`). Public route with optional authentication: a valid bearer token identifies the owner.

**Request headers:**
- Authorization: Bearer {access_token} — optional

**Response 200:**
- VideoResponse

**Error responses:**
- 401: an `Authorization` header is present but the token is invalid or expired
- 404 VIDEO_NOT_FOUND: slug does not exist, or the video is not `ready` and the caller is not its owner

---

#### GET /videos/{slug}/stream (SI-03.11)

Redirects to a presigned `GET` URL of the original file with inline disposition; the storage answers `Range` requests with `206 Partial Content` (per `phase-03-videos/TD-07`). URL TTL `VIDEO_PLAYBACK_URL_TTL_SECONDS` (default 21600).

**Request headers:**
- Authorization: Bearer {access_token} — optional

**Response 302:**
- Location: presigned URL (signed for `S3_PUBLIC_ENDPOINT`)

**Error responses:**
- 401: `Authorization` header present with an invalid token
- 404 VIDEO_NOT_FOUND: slug does not exist, or the video is not `ready` and the caller is not its owner
- 409 VIDEO_NOT_READY: the owner requests a video whose `status` is not `ready`

---

#### GET /videos/{slug}/download (SI-03.11)

Same as `/stream`, but the presigned URL carries `response-content-disposition=attachment; filename="{original_filename}"` so the browser saves the file (per `phase-03-videos/TD-07`).

**Request headers:**
- Authorization: Bearer {access_token} — optional

**Response 302:**
- Location: presigned URL with attachment disposition

**Error responses:**
- 401: `Authorization` header present with an invalid token
- 404 VIDEO_NOT_FOUND: slug does not exist, or the video is not `ready` and the caller is not its owner
- 409 VIDEO_NOT_READY: the owner requests a video whose `status` is not `ready`

---

#### GET /videos/{slug}/thumbnail (SI-03.11)

Redirects to a presigned `GET` URL of the generated JPEG thumbnail.

**Request headers:**
- Authorization: Bearer {access_token} — optional

**Response 302:**
- Location: presigned URL of `thumbnails/{id}.jpg`

**Error responses:**
- 401: `Authorization` header present with an invalid token
- 404 VIDEO_NOT_FOUND: slug does not exist, or the video is not `ready` and the caller is not its owner
- 409 VIDEO_NOT_READY: the owner requests a video whose `status` is not `ready`

---

#### Validation Rules — Video upload

| Field | Rule | Error message (VALIDATION_ERROR) |
|-------|------|----------------------------------|
| title | string, trimmed, 1–100 characters | title must be shorter than or equal to 100 characters |
| fileName | string, 1–255 characters | fileName must be shorter than or equal to 255 characters |
| mimeType | matches `^video\/[a-z0-9.+-]+$` | mimeType must be a video MIME type |
| sizeBytes | integer, 1 ≤ n ≤ 10737418240 | sizeBytes must not be greater than 10737418240 |
| partNumbers | array of unique integers ≥ 1, 1–10000 items | each value in partNumbers must not be less than 1 |

### Authorization Matrix

Per `phase-03-videos/TD-10`. "Owner" = authenticated user whose channel (`channels.user_id = sub`) owns the video. Write routes stay behind the global `JwtAuthGuard`; read routes are `@Public()` with optional authentication (DG-1 resolution — SI-03.5).

| Endpoint | Anonymous | Authenticated (not owner) | Owner |
|----------|-----------|---------------------------|-------|
| POST /videos | ✗ 401 | ✓ (creates in the caller's own channel) | ✓ |
| GET /videos/{slug}/upload | ✗ 401 | ✗ 404 | ✓ (409 if not `draft`) |
| POST /videos/{slug}/upload/parts | ✗ 401 | ✗ 404 | ✓ (409 if not `draft`) |
| POST /videos/{slug}/upload/complete | ✗ 401 | ✗ 404 | ✓ (409 if not `draft`) |
| GET /videos/{slug} | ✓ if `ready`, else 404 | ✓ if `ready`, else 404 | ✓ any status |
| GET /videos/{slug}/stream | ✓ if `ready`, else 404 | ✓ if `ready`, else 404 | ✓ if `ready`, else 409 |
| GET /videos/{slug}/download | ✓ if `ready`, else 404 | ✓ if `ready`, else 404 | ✓ if `ready`, else 409 |
| GET /videos/{slug}/thumbnail | ✓ if `ready`, else 404 | ✓ if `ready`, else 404 | ✓ if `ready`, else 409 |

On the optional-auth routes a present-but-invalid `Authorization` header returns `401` (credentials are never silently ignored); an absent header means anonymous.

### Error Catalog

Inherited envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`); validation errors keep `error: "VALIDATION_ERROR"` with a `message` array. New domain exceptions extend `DomainException` in `src/common/exceptions/domain.exception.ts`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Unknown slug; owner-only route called by a non-owner; non-`ready` video read by a non-owner |
| CHANNEL_NOT_FOUND | 404 | Channel not found | `POST /videos` by a user without a channel |
| VIDEO_UPLOAD_NOT_ACTIVE | 409 | Video upload is not active | Upload-session route (`/upload`, `/upload/parts`, `/upload/complete`) on a video whose `status` is not `draft` |
| INVALID_PART_NUMBER | 400 | Part number is out of range | `POST /videos/{slug}/upload/parts` with a part number greater than `partCount` |
| UPLOAD_INCOMPLETE | 422 | Upload is incomplete | `POST /videos/{slug}/upload/complete` with missing parts, total size different from `sizeBytes`, or a part set rejected by the storage |
| VIDEO_NOT_READY | 409 | Video is not ready | Owner calls `/stream`, `/download` or `/thumbnail` on a video whose `status` is not `ready` |

### Events/Messages

#### process-video (queue `video-processing`)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService.completeUpload` in the API, via `@InjectQueue('video-processing')` — `queue.add('process-video', { videoId }, { jobId: videoId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 } })`, issued inside the same database transaction that moves the video `draft → processing` (a failed enqueue rolls the status back) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`)
**Consumer:** `VideoProcessor` (`@Processor('video-processing', { concurrency: VIDEO_WORKER_CONCURRENCY })`, `WorkerHost`) running only in the `video-worker` container (`src/worker.ts` → `WorkerModule`) (per `phase-03-videos/TD-04`)
**Trigger:** `POST /videos/{slug}/upload/complete` succeeds (all parts present and the multipart upload completed in storage)
**Delivery semantics:** at-least-once (BullMQ; stalled jobs are re-delivered). Idempotency: `jobId = videoId` makes re-enqueue a no-op; the consumer processes only when the video is still `processing` and writes results with a compare-and-set (`processing → ready|failed`), overwriting the same thumbnail key on a repeat (per `phase-03-videos/TD-03`)
**Processing (per `phase-03-videos/TD-05`):** presign an internal `GET` URL for `video_key` (signed for `S3_ENDPOINT`) → `ffprobe -v error -print_format json -show_format -show_streams <url>` → require a video stream (none → `UnrecoverableError`) → thumbnail at `10%` of the duration (`0` when unknown) with `ffmpeg -ss <t> -i <url> -frames:v 1 -vf scale='min(1280,iw)':-2 -f image2pipe -vcodec mjpeg pipe:1` → `PutObject thumbnails/{videoId}.jpg` (`image/jpeg`) → `processing → ready` with `duration_seconds`, `metadata`, `thumbnail_key`, `processed_at`
**Failure outcome:** `UnrecoverableError` (invalid media) or the last of the 3 attempts failing → `processing → failed` with `failure_reason` and `processed_at`; earlier attempts are retried with exponential backoff (5 s, 10 s)

---

## Dependency Map

```
SI-03.1 (root — infra)
├── SI-03.2 — config namespaces need the new env keys
│   └── SI-03.3 — StorageService reads storageConfig
│       ├── SI-03.6 — createDraft opens the multipart upload
│       └── SI-03.9 — MediaProbe integration reads presigned URLs (+ SI-03.1 ffmpeg)
└── SI-03.4 — videos table/repository
    └── SI-03.6 (also needs SI-03.3)

SI-03.5 (root, independent — optional auth in the guard)

SI-03.6 + SI-03.5
└── SI-03.7 — upload session routes (owner check reuses createDraft's data)
    └── SI-03.8 — complete + queue producer
        └── SI-03.10 — worker consumes the job (+ SI-03.9)
            └── SI-03.11 — read/stream/download need ready videos (+ SI-03.5)
                └── SI-03.12 — OpenAPI + documentation reflect the final code
```

Linearized implementation order: SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.8 → SI-03.9 → SI-03.10 → SI-03.11 → SI-03.12

---

## Deliverables

- [ ] SI-03.1 — Infra: Dependencies, Compose Services and FFmpeg Image
- [ ] SI-03.2 — Configuration Namespaces for Storage, Queue and Video
- [ ] SI-03.3 — Storage Module (S3 client, multipart and presigned URLs)
- [ ] SI-03.4 — Video Entity, Migration and Repository
- [ ] SI-03.5 — Optional Authentication Mode in the Global JWT Guard
- [ ] SI-03.6 — Endpoint POST /videos (draft pre-registration + upload session)
- [ ] SI-03.7 — Endpoints GET /videos/{slug}/upload and POST /videos/{slug}/upload/parts (resume)
- [ ] SI-03.8 — Endpoint POST /videos/{slug}/upload/complete (queue producer)
- [ ] SI-03.9 — Media Probe Service (ffprobe metadata + ffmpeg thumbnail)
- [ ] SI-03.10 — Video Worker: Processor, Entrypoint and Compose Service
- [ ] SI-03.11 — Endpoints GET /videos/{slug}, /stream, /download, /thumbnail
- [ ] SI-03.12 — OpenAPI Artifact and AI Documentation Update

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
