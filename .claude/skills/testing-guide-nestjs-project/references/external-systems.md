> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# External System Strategies

How each external system is handled in tests. These strategies were confirmed with the team.

---

## PostgreSQL — Real (Docker)

**Strategy:** Real database via the Docker `db` service (already in `compose.yaml`).

**Connection config for tests:**
```typescript
{
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'streamtube',
  password: process.env.DB_PASSWORD ?? 'streamtube',
  database: process.env.DB_DATABASE ?? 'streamtube',
  synchronize: true, // auto-create tables in test setup
}
```

**Test isolation:**
- Use `dataSource.query('DELETE FROM "table_name"')` to clean tables between tests
- Do NOT use `repository.delete({})` — throws `Empty criteria(s) are not allowed`
- Alternative: `repository.clear()` (truncates the table)
- For complex foreign key chains, delete in reverse dependency order or use `TRUNCATE ... CASCADE`
- Use `beforeEach` for cleanup to ensure each test starts with a clean state

**Entity setup:**
- Use `synchronize: true` in test DataSource to auto-create tables from entities
- For integration tests, import only the entities needed by the test — not all entities
- For E2E tests, import `AppModule` which includes all entities via their domain modules

---

## Object Storage — Real MinIO (Docker)

**Strategy:** Real S3-compatible storage — the `minio` service of `compose.yaml` (bucket created by `minio-init`). No filesystem adapter and no SDK mocks: the upload protocol (S3 multipart + presigned part URLs) and delivery (presigned GET, `206` range responses) only exist on a real S3 API (`phase-03-videos/TD-11`).

**Access:** `StorageService` (`src/storage/storage.service.ts`) is the only storage client. It talks to `S3_ENDPOINT` (`http://minio:9000`) and signs client-facing URLs for `S3_PUBLIC_ENDPOINT`. The test process runs inside the Compose network and cannot reach the host's `localhost:9000`, so tests sign "public" URLs for the in-network endpoint:

```typescript
import { testStorageConfig, usePublicEndpointInsideNetwork, putPart } from '../test/storage';

// Plain service (integration):
const storage = new StorageService(testStorageConfig());

// Nest module / AppModule bootstrap: set the env before compiling
usePublicEndpointInsideNetwork();
```

**Test isolation:**
- Use random keys (`test/${randomUUID()}`) and delete the objects you create in `afterAll` / at the end of the test.
- Abort multipart uploads a test leaves open (`abortMultipartUpload`); MinIO also expires stale incomplete uploads on its own.
- Upload parts with `putPart(url, buffer)` — the same HTTP `PUT` a browser does against a presigned URL.

**Media fixtures:** generate videos at test time with `generateSampleVideo()` (`src/test/sample-video.ts`, `ffmpeg -f lavfi`); FFmpeg is installed in the `nestjs-api` image. Never commit binary fixtures.

---

## Message Queue — Real Redis + BullMQ (Docker)

**Strategy:** Real broker — the `redis` service of `compose.yaml` with BullMQ (`@nestjs/bullmq`), queue `video-processing`, job `process-video`.

**Test isolation:** tests use their own `QUEUE_PREFIX` (e.g. `bull-test`, `bull-test-integration`), set before the module compiles, so the running `video-worker` container (prefix `bull`) never consumes test jobs. Clean with `queue.obliterate({ force: true })` in `beforeEach`/`afterAll`.

**Setup pattern:**
```typescript
import { getQueueToken } from '@nestjs/bullmq';
import { bullRootModule } from '../queue/bull-root.module';

process.env.QUEUE_PREFIX = 'bull-test-integration';
// imports: [ConfigModule.forRoot({ isGlobal: true, load: [queueConfig, ...] }), bullRootModule(), VideosModule]
const queue = module.get<Queue>(getQueueToken('video-processing'));
```

- **Publisher tests:** assert the job exists with the expected id/data (`queue.getJob(videoId)` — the job id is the video id).
- **Consumer tests:** call `VideoProcessor.process(job)` directly with `{ data, attemptsMade, opts: { attempts } }` against real DB/MinIO/FFmpeg (`src/video-processing/video.processor.integration-spec.ts`); for the full pipeline, import `VideoProcessingModule` next to `AppModule` so the processor consumes the test prefix in-process (`test/videos-read.e2e-spec.ts`).

---

## Email — Mailpit (Real SMTP Capture)

**Strategy:** Mailpit — a local SMTP server that captures all emails for inspection via its API. No emails are actually delivered.

**Setup:**
- Add Mailpit to `compose.yaml`:
```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI / API
```

**NestJS configuration:**
```typescript
// In mail module or config
{
  transport: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
  },
}
```

**Integration test:**
```typescript
describe('MailService (integration)', () => {
  beforeEach(async () => {
    // Clear all captured emails via Mailpit API
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  });

  it('should send confirmation email', async () => {
    await mailService.sendConfirmation('user@test.com', 'token-123');

    // Query Mailpit API for captured emails
    const response = await fetch('http://localhost:8025/api/v1/messages');
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].To[0].Address).toBe('user@test.com');
    expect(data.messages[0].Subject).toContain('confirm');
  });
});
```

**Key points:**
- Mailpit captures ALL emails — no mocking, no side effects
- Use Mailpit's REST API (`http://localhost:8025/api/v1/messages`) to inspect sent emails
- Clear captured emails in `beforeEach` to ensure test isolation
- Web UI at `http://localhost:8025` for manual debugging
- Tests the full SMTP transport path — if the SMTP config is wrong, the test fails
