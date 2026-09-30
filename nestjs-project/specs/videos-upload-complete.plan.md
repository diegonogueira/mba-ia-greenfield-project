---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/{slug}/upload/complete Test Plan

## Application Overview

Completing the upload closes the multipart upload from the storage's own part listing, moves the video `draft → processing` and publishes the `process-video` job on the `video-processing` queue. It is owner-only and must reject incomplete uploads without losing the draft.

## Test Scenarios

### 1. Complete upload

**Setup:** AppModule bootstrap with global pipes/filters, `S3_PUBLIC_ENDPOINT = S3_ENDPOINT`, a test-only `QUEUE_PREFIX` (so the running `video-worker` container never consumes these jobs) and `VIDEO_UPLOAD_PART_SIZE_BYTES` = 5 MiB; `beforeEach` cleans tables and obliterates the test queue; owner and second user logged in; the owner creates a 2-part draft.

#### 1.1. completes-and-enqueues-processing

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. PUT both parts to their presigned URLs
    - expect: storage answers 200 for each
  2. POST /videos/{slug}/upload/complete as the owner
    - expect: status 202, body `status` = `"processing"`
  3. Read the `videos` row and the test queue
    - expect: row `status = 'processing'`, `upload_id` null
    - expect: the queue `video-processing` has a job named `process-video` with id = video id and `data.videoId` = video id
    - expect: the object `videos/{id}/original` exists in the bucket with the declared size

#### 1.2. second-complete-is-rejected-without-duplicate-job

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. After a successful complete, POST /videos/{slug}/upload/complete again
    - expect: status 409, `error` = `"VIDEO_UPLOAD_NOT_ACTIVE"`
    - expect: the test queue still holds exactly one job for the video

#### 1.3. missing-part-returns-422-and-keeps-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. PUT only part 1, then POST /videos/{slug}/upload/complete
    - expect: status 422, `error` = `"UPLOAD_INCOMPLETE"`
    - expect: row still `status = 'draft'` with `upload_id` set; no job in the queue

#### 1.4. owner-only

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos/{slug}/upload/complete with the second user's token
    - expect: status 404, `error` = `"VIDEO_NOT_FOUND"`
  2. Same request without `Authorization`
    - expect: status 401
