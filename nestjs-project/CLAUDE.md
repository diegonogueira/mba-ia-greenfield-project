# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis (queue):** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO (object storage):** `docker compose ps minio` shows `healthy`, and `minio-init` has exited with code 0 (it creates the `S3_BUCKET` bucket)
- **Video worker:** `docker compose logs video-worker` shows `Video worker started` (the worker is part of the infrastructure and starts with `docker compose up -d`; it runs `npm run start:worker:dev`, so it needs `node_modules` installed — it restarts until they are)

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP capture, SMTP `1025`, web UI/API `8025`
- `redis` — Redis 8 for the BullMQ queue, port `6379` (`--maxmemory-policy noeviction`, AOF on)
- `minio` — S3-compatible object storage (`pgsty/minio`, community build of MinIO), API `9000`, console `9001`; credentials are `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` from `.env`
- `minio-init` — one-shot `mc mb --ignore-existing` that creates the `S3_BUCKET` bucket
- `video-worker` — same image as `nestjs-api` (FFmpeg included), runs the queue consumer (`src/worker.ts`); no HTTP port

`compose.yaml` interpolates `S3_*` from `.env`: create it first with `cp .env.example .env`.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker:dev                 # Video worker in watch mode (what the video-worker container runs; output in dist-worker/)
npm run start:worker                     # Video worker from the compiled build (dist/worker.js)

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

### Tests that use storage, queue and FFmpeg

Video tests run against the real Compose services (no storage/queue mocks): MinIO, Redis and the `ffmpeg`/`ffprobe` binaries of the `nestjs-api` image. Keep `redis`, `minio` (+ `minio-init`) up before running them. Conventions:

- Presigned URLs used inside tests must be signed for the in-network endpoint: call `usePublicEndpointInsideNetwork()` / `testStorageConfig()` (`src/test/storage.ts`) or `applyVideoTestEnv()` (`test/helpers/videos-e2e.ts`) before bootstrapping.
- Tests use their own BullMQ `QUEUE_PREFIX` (e.g. `bull-test`), so the running `video-worker` container never consumes test jobs; the read E2E runs `VideoProcessingModule` in-process on that prefix.
- Sample videos are generated at test time by `generateSampleVideo()` (`src/test/sample-video.ts`); do not commit binary fixtures.

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `start:worker:dev`, `start:worker`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module
- Two entrypoints share the same code: `src/main.ts` (HTTP API, `AppModule`) and `src/worker.ts` (video worker, `WorkerModule`, application context without HTTP). Both load the same config (`src/config/config.factories.ts` + `env.validation.ts`), TypeORM root (`src/database/typeorm-root.module.ts`) and BullMQ root (`src/queue/bull-root.module.ts`)

### Videos module (Phase 03)

- `src/videos/` — `Video` entity (`videos` table, many-to-one `Channel`), `VideosRepository` (queries + compare-and-set `transitionStatus`), `VideosService`, `VideosController`, DTOs, `videos.mapper.ts` (public response shape — never exposes storage keys, upload id or the owner's user id)
- `src/storage/` — `StorageService` (AWS SDK v3): multipart upload, part/GET presigning, put/head/delete. Two clients: `S3_ENDPOINT` for server-side calls, `S3_PUBLIC_ENDPOINT` only to sign URLs handed to clients. Keys: `videos/{id}/original`, `thumbnails/{id}.jpg` (`storage.keys.ts`)
- `src/video-processing/` — `VideoProcessor` (BullMQ consumer of `process-video` on `video-processing`) and `MediaProbeService` (`ffprobe` metadata, `ffmpeg` thumbnail at 10% of the duration, max 1280 px wide, reading a presigned URL). Imported **only** by `WorkerModule` — never add it to `AppModule`, or the API would consume jobs
- Status: `draft` (created by `POST /videos`) → `processing` (upload completed, job enqueued after the status commit; an enqueue failure moves it back to `draft`) → `ready` | `failed` (worker). Invalid media fails immediately; other errors are retried (3 attempts in total, exponential backoff from 5 s) and the last failure sets `failed` with `failure_reason`

| Endpoint | Auth | Result |
|----------|------|--------|
| `POST /videos` | Bearer | `201` draft + presigned part URLs (`sizeBytes` ≤ 10737418240, parts of `VIDEO_UPLOAD_PART_SIZE_BYTES`) |
| `GET /videos/{slug}/upload` | Bearer, owner | `200` uploaded parts (resume) |
| `POST /videos/{slug}/upload/parts` | Bearer, owner | `200` re-signed part URLs |
| `POST /videos/{slug}/upload/complete` | Bearer, owner | `202` `processing` + job enqueued; `422 UPLOAD_INCOMPLETE` if parts are missing or sizes differ |
| `GET /videos/{slug}` | Public + optional Bearer | `200` metadata; non-`ready` videos only for the owner (others `404`) |
| `GET /videos/{slug}/stream` · `/download` · `/thumbnail` | Public + optional Bearer | `302` to a presigned URL (`VIDEO_PLAYBACK_URL_TTL_SECONDS`); storage answers `Range` with `206`; owner gets `409 VIDEO_NOT_READY` before `ready` |

Optional auth: routes marked `@Public()` + `@OptionalAuth()` accept anonymous calls, attach the user when a valid Bearer token is sent (`@OptionalCurrentUser()`), and return `401` for an invalid token. `VideosController` is `@SkipThrottle()` — rate limiting stays on the auth endpoints.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings; in test code (`*.spec.ts`, `*.integration-spec.ts`, `*.e2e-spec.ts`, `test/**`, `src/test/**`) the other `no-unsafe-*` rules, `unbound-method` and `require-await` are warnings too

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
