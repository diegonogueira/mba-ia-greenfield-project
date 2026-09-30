---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-30T12:56:33-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T15:35:37-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-30T15:36:25-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-30T12:56:49-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-09-30T12:56:49-03:00"
  docs/phases/phase-02-auth/context.md: "2026-09-30T12:56:49-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-09-30T12:56:49-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-09-30T12:56:33-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified in project-plan.md._ Neighbor boundaries: categories, title/description editing, custom thumbnail, public/unlisted visibility, draft → publication flow and channel panel belong to Fase 04; the player page, view counts and suggestions belong to Fase 05; listings and search belong to Fase 07.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — the video UI is out of scope for this phase (backend-only delivery); the cross-layer TDs define the contract a future frontend phase consumes.

**Sequencing notes:** Depende de: Fase 01, Fase 02.

**Neighbors (for boundary detection only):**

- **Phase 2:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 4:** Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ + Redis) | `@nestjs/bullmq@^12.0.0`, `bullmq@^6.3.10` |
| phase-03-videos/TD-02 | phase | Cross-layer | Large File Upload Strategy (up to 10GB) | decided | B (S3 multipart with presigned part URLs) | — |
| phase-03-videos/TD-03 | phase | Backend | Video Status Lifecycle and Processing Failure Policy | decided | A (Single guarded status enum + queue retries + terminal `failed`) | — |
| phase-03-videos/TD-04 | phase | Backend | Video Worker Runtime | decided | A (Separate container, same codebase, dedicated entrypoint) | — |
| phase-03-videos/TD-05 | phase | Backend | Media Metadata and Thumbnail Toolchain | decided | A (System ffprobe/ffmpeg via execFile over presigned URL) | — |
| phase-03-videos/TD-06 | phase | Cross-layer | Unique Video URL Identifier | decided | B (Random 11-char base64url slug + unique constraint + retry) | — |
| phase-03-videos/TD-07 | phase | Cross-layer | Streaming and Download Delivery | decided | B (302 redirect to short-lived presigned GET URL) | — |
| phase-03-videos/TD-08 | phase | Backend | Object Storage Client Library | decided | A (AWS SDK v3) | `@aws-sdk/client-s3@^3.1143.0`, `@aws-sdk/s3-request-presigner@^3.1143.0` |
| phase-03-videos/TD-09 | phase | Repo-wide | Bucket Layout, Object Keys and Provisioning | decided | A (One private bucket, prefixes per asset, init container) | — |
| phase-03-videos/TD-10 | phase | Backend | Access Policy for Video Reads (metadata, stream, download, thumbnail) | decided | A (Ready videos readable via slug; non-ready owner-only) | — |
| phase-03-videos/TD-11 | phase | Backend | Test Strategy for Storage, Queue and FFmpeg | decided | A (Real MinIO, Redis and FFmpeg from Compose, with test isolation) | — |
| phase-03-videos/TD-12 | phase | Repo-wide | Canonical Environment Keys for Storage, Queue and Worker | decided | A (Namespaced `S3_*`, `REDIS_*`, `VIDEO_*` keys) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-08, phase-03-videos/TD-09, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-12 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-03 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-11 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-11 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06, phase-03-videos/TD-10 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07, phase-03-videos/TD-10 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07, phase-03-videos/TD-10 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis — it is the queue integration documented by NestJS (`@nestjs/bullmq`) and gives attempts, exponential backoff, `UnrecoverableError` and `jobId` deduplication out of the box, which TD-03 relies on; Redis is a small dedicated container, so the queue becomes a real Compose service as the architecture diagram expects, instead of sharing load with PostgreSQL (pg-boss) or hand-building retry topologies (RabbitMQ).

**Libraries:** `@nestjs/bullmq@^12.0.0`, `bullmq@^6.3.10`

### phase-03-videos/TD-02

**Recommendation:** S3 multipart with presigned part URLs — the only option in which the API never carries the 10GB body, with native resume (list parts + re-sign) and no extra server. Parameters: max file size 10 GiB (10737418240 bytes), part size 64 MiB (≤ 160 parts, well within S3's 10,000-part and 5 MiB-minimum limits), part URL TTL 1 hour; the API completes the upload from the storage's own part listing (ListParts) and checks that all expected parts are present and that their total equals the declared size before calling CompleteMultipartUpload.

**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** Option A — a single guarded enum keeps the draft pre-registration and the processing lifecycle observable in one column, while BullMQ retries (TD-01) absorb transient failures and `UnrecoverableError` stops retrying media that FFmpeg cannot read; the compare-and-set guard makes the at-least-once delivery harmless.

**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** Option A — the worker is a real separate container as in the diagram, while reusing the NestJS modules already in `nestjs-project/` (a new subproject would duplicate them); the processor lives only in `WorkerModule`, so the API never consumes jobs.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Option A — reading through a short-lived presigned URL lets FFmpeg seek without copying up to 10GB to the worker disk, and avoids the deprecated `fluent-ffmpeg`. Thumbnail = one JPEG frame at 10% of the duration (0 s for streams without duration), scaled to at most 1280 px wide; metadata stored: duration (s), width, height, video/audio codec, container format, bit rate, frame rate. A file with no video stream is invalid media (unrecoverable, TD-03).

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Option B — 64 random bits make collisions practically impossible, the unique index guarantees "sem conflito" even in that case (retry on `23505`, same pattern as channel nicknames in phase 02), and the slug is short and not enumerable.

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Option B — the storage serves range requests natively, so streaming and download cost the API one redirect instead of the full transfer, matching the "Frontend → streams from Object Storage" relation of the diagram. Playback/download URL TTL: 6 hours (long videos keep issuing range requests during playback). Presigned URLs handed to clients are signed against `S3_PUBLIC_ENDPOINT`; server-side calls (API, worker) use `S3_ENDPOINT` (Compose service name).

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** Option A — the AWS SDK v3 speaks the production API natively and exposes the multipart + presign primitives TD-02 and TD-07 need; MinIO is reached by pointing `endpoint` at it with path-style addressing.

**Libraries:** `@aws-sdk/client-s3@^3.1143.0`, `@aws-sdk/s3-request-presigner@^3.1143.0`

### phase-03-videos/TD-09

**Recommendation:** Option A — one private bucket with id-derived keys keeps API and worker in agreement without extra config, and a one-shot init container keeps provisioning in infrastructure. Everything stays private; clients only get presigned URLs (TD-07).

**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** Option A — it delivers streaming/download to any viewer with the unique URL without exposing unfinished uploads; write operations (upload session, complete) stay owner-only behind the global JWT guard. Phase 04 will layer publication/visibility on top of `status = ready`.

**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** Option A — the upload protocol (TD-02) and delivery (TD-07) only exist on a real S3 API, so a filesystem adapter would leave the core of the phase untested; `nestjs-project/CLAUDE.md` already requires tests to run inside the Compose stack. The testing guide's external-systems reference is updated to reflect it.

**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** Option A — provider-neutral names keep the MinIO → S3 swap a pure configuration change, and separating `S3_ENDPOINT` (in-network) from `S3_PUBLIC_ENDPOINT` (client-facing) is what makes presigned URLs usable from outside the Docker network without breaking the "service name as host" rule for service-to-service traffic.

**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive.

**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip. Option C is rejected: it solves a problem (server-side revocation) the project does not have.

**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh). Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving.

**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions. (2) **Aligned with shadcn's canonical form primitive** — `npx shadcn@latest add form` produces react-hook-form wrappers. (3) **Zod-first developer ergonomics match the rest of the FE foundation.** Option B is rejected for impedance with shadcn's primitive; Option C for the per-field boilerplate.

**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment** — Route Handlers are the BFF surface; every mutation visible under `app/api/**`. (2) **Test scaffold already exists** for Route-Handlers-as-functions. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07.

**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it.

**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint. (2) **Single integration pattern across both flows** — "RSC owns the token, Client Component owns the input". (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo.

**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Ambos) — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging) — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI").

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | The umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred. |

## UI Inventory

_No screen inventory — UI↔API sync deferred. Run /screen-inventory 3 and then rerun /plan-context 3 to activate UI checks._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`.

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Queue consumer / processor (`artifacts/future-types.md`) | Unit (mock deps) for business logic + Integration (real DB/storage) for side effects |
| Exception Filter | Unit + E2E |

### next-frontend

_Deferred subproject — no video UI in this phase._
