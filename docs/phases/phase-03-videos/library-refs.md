---
libs:
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-09-30T15:36:02-03:00"
  "bullmq":
    version: "^6.3.10"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-09-30T15:36:02-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1143.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-30T15:36:02-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1143.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-30T15:36:02-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T15:35:37-03:00"
---

# Library references — phase-03-videos

Distilled from Context7 (`resolve-library-id` + `query-docs`), limited to the surfaces the decided TDs use. Versions are the latest published on npm at fetch time; `@nestjs/bullmq@12` declares peer support for `@nestjs/common`/`@nestjs/core` `^10 || ^11 || ^12` and `bullmq` `^3 … ^6` (compatible with the installed NestJS 11).

## @nestjs/bullmq

Used by `phase-03-videos/TD-01` (producer in the API, consumer in the worker — `phase-03-videos/TD-04`).

- Root connection, async: `BullModule.forRootAsync({ inject: [...], useFactory: (...) => ({ connection: { host, port }, prefix }) })`. Root options (`connection`, `prefix` — default `bull` — and `defaultJobOptions`) are passed to every BullMQ `Queue`.
- Queue registration: `BullModule.registerQueue({ name: 'video-processing' })` in the module that produces or consumes.
- Producer: `constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}` (`Queue` imported from `bullmq`).
- Consumer: class decorated with `@Processor('video-processing')` extending `WorkerHost`, implementing `async process(job: Job<Data, Result, Name>)`. Worker options (e.g. `concurrency`) go in the second argument: `@Processor('video-processing', { concurrency: n })`. Worker events via `@OnWorkerEvent('failed' | 'completed' | ...)` on methods of the processor class.
- Components are registered automatically on `onModuleInit`; a processor is only started by the Nest context that imports its module — keep it out of the API's module graph.

## bullmq

Used by `phase-03-videos/TD-01`, `phase-03-videos/TD-03`.

- Job options on `queue.add(name, data, opts)`: `jobId` (custom id — adding a job whose id already exists is a no-op, which gives idempotent enqueue), `attempts`, `backoff: { type: 'exponential', delay: ms }`, `removeOnComplete` / `removeOnFail` (`true`, a count, or `{ age, count }`).
- `throw new UnrecoverableError(msg)` (from `bullmq`) moves the job to the failed set immediately, ignoring remaining `attempts`.
- Delivery is **at-least-once**: a job whose lock is lost (process crash, blocked event loop) is considered stalled and restarted (`maxStalledCount`, default 1) → processors must be idempotent.
- Graceful shutdown: `worker.close()` stops fetching and waits for the active job (Nest calls it on application shutdown when `enableShutdownHooks()` is on).
- Redis requirements: version ≥ 5 (≥ 6.2 recommended); `maxmemory-policy noeviction` is the **only** safe policy (BullMQ warns otherwise); AOF persistence recommended.
- `queue.getJobs(['waiting', 'delayed', ...])` / `queue.getJob(id)` for assertions in tests; `queue.obliterate({ force: true })` wipes a queue (test cleanup).

## @aws-sdk/client-s3

Used by `phase-03-videos/TD-08` (with `phase-03-videos/TD-02`, `TD-05`, `TD-07`, `TD-09`).

- Client for MinIO: `new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true })`. For AWS S3 the same code runs without `endpoint`/`forcePathStyle`.
- Multipart: `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`; `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` (PartNumber 1–10000, every part except the last ≥ 5 MiB) → `ETag`; `ListPartsCommand({ Bucket, Key, UploadId, PartNumberMarker })` → `Parts[{ PartNumber, ETag, Size }]`, paginated by `IsTruncated`/`NextPartNumberMarker` (max 1000 per page); `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }] } })`; `AbortMultipartUploadCommand({ Bucket, Key, UploadId })`.
- Objects: `PutObjectCommand({ Bucket, Key, Body, ContentType })`, `HeadObjectCommand` (→ `ContentLength`, `ContentType`), `GetObjectCommand` (supports `Range`, `ResponseContentDisposition`, `ResponseContentType`), `DeleteObjectCommand`.
- Errors are thrown as `S3ServiceException` subclasses with `name` (e.g. `NoSuchUpload`, `NoSuchKey`, `EntityTooSmall`, `InvalidPart`) and `$metadata.httpStatusCode`.
- Recent v3 releases compute request checksums by default; for presigned URLs that third-party clients will call, set `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'` on the client so no checksum query parameters/headers are required from the uploader.

## @aws-sdk/s3-request-presigner

Used by `phase-03-videos/TD-02` (part upload URLs) and `phase-03-videos/TD-07` (stream/download/thumbnail URLs), and by the worker (`phase-03-videos/TD-05`, internal read URL).

- `getSignedUrl(client, command, { expiresIn })` — `expiresIn` in seconds (default 900, SigV4 maximum 7 days). Works with `UploadPartCommand` and `GetObjectCommand`.
- The URL embeds the host of the client's `endpoint` in the signature: a URL signed by a client configured with `http://minio:9000` only works inside the Docker network; URLs for clients outside it must be signed by a second `S3Client` configured with the public endpoint (signing is local, no request is sent).
- `GetObjectCommand({ Bucket, Key, ResponseContentDisposition: 'attachment; filename="..."' })` makes the storage answer with that `Content-Disposition` (download); without it the browser plays inline. Range requests against the signed URL return `206 Partial Content`.
- Headers can be forced into the signature with `signableHeaders` / `unhoistableHeaders` (not needed here).
