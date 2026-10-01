---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-create.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

`POST /videos` pre-registers a video as `draft` in the caller's channel, generates its unique 11-char slug and opens an S3 multipart upload in MinIO, answering with presigned part URLs. The file bytes go straight from the client to the storage; the API only exchanges small JSON bodies.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeEach` → `cleanAllTables(dataSource)` + throttler storage cleared; `beforeAll` → `Test.createTestingModule({ imports: [AppModule] }).compile()` with the global `ValidationPipe` and filters of `main.ts`, `S3_PUBLIC_ENDPOINT` set to `S3_ENDPOINT` and a test-only `QUEUE_PREFIX` before bootstrap (presigned URLs must be reachable from inside the container); a confirmed user logged in via the auth endpoints.

#### 1.1. creates-draft-with-upload-session

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos with a valid bearer token and `{ title, fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 12000000 }`
    - expect: status 201
    - expect: body `status` is `"draft"`, `slug` matches `^[A-Za-z0-9_-]{11}$`, `upload.partCount` is 1 with the default 64 MiB part size and `upload.parts.length` equals `upload.partCount`
  2. Query the `videos` table by the returned id
    - expect: one row with `status = 'draft'`, `channel_id` = the caller's channel id, non-null `upload_id`, `video_key = videos/{id}/original`

#### 1.2. rejects-size-above-10-gib

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos with `sizeBytes: 10737418241`
    - expect: status 400, `error` = `"VALIDATION_ERROR"`
    - expect: no row inserted in `videos`

#### 1.3. rejects-non-video-mime-type

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos with `mimeType: "image/png"`
    - expect: status 400, `error` = `"VALIDATION_ERROR"`

#### 1.4. requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos without `Authorization`
    - expect: status 401

#### 1.5. ten-gib-upload-is-split-in-160-parts

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos with `sizeBytes: 10737418240`
    - expect: status 201, `upload.partSize` = 67108864, `upload.partCount` = 160, `upload.parts.length` = 160

#### 1.6. part-url-accepts-direct-put-to-storage

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos with `sizeBytes` equal to a small buffer's length
    - expect: status 201
  2. HTTP PUT the buffer to `upload.parts[0].url` (no API involvement)
    - expect: status 200 from the storage with an `ETag` header
