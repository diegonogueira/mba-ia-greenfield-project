---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: nestjs-project/test/videos-upload-session.e2e-spec.ts
---

# Upload Session (resume) Test Plan

## Application Overview

`GET /videos/{slug}/upload` reports which parts the storage already holds and `POST /videos/{slug}/upload/parts` re-signs part URLs, so the owner can resume an interrupted upload. Both are owner-only and only valid while the video is `draft`.

## Test Scenarios

### 1. Upload session

**Setup:** same bootstrap as the POST /videos spec (AppModule + global pipes/filters, `S3_PUBLIC_ENDPOINT = S3_ENDPOINT`, test `QUEUE_PREFIX`); `beforeEach` cleans tables; owner and a second confirmed user logged in; the owner creates a draft with `VIDEO_UPLOAD_PART_SIZE_BYTES` = 5 MiB and `sizeBytes` spanning 3 parts.

#### 1.1. lists-uploaded-parts-after-partial-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. PUT the first 5 MiB to `upload.parts[0].url`
    - expect: storage answers 200
  2. GET /videos/{slug}/upload as the owner
    - expect: status 200, `partCount` 3, `uploadedParts` = `[{ partNumber: 1, sizeBytes: 5242880 }]`

#### 1.2. re-signs-requested-parts

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos/{slug}/upload/parts as the owner with `{ "partNumbers": [2, 3] }`
    - expect: status 200, `parts` has part numbers 2 and 3 with URLs, `expiresAt` ≈ now + 1 h
  2. PUT part 2 bytes to the returned URL
    - expect: storage answers 200

#### 1.3. rejects-part-number-out-of-range

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. POST /videos/{slug}/upload/parts with `{ "partNumbers": [999] }`
    - expect: status 400, `error` = `"INVALID_PART_NUMBER"`
  2. POST /videos/{slug}/upload/parts with `{ "partNumbers": [] }`
    - expect: status 400, `error` = `"VALIDATION_ERROR"`

#### 1.4. hides-session-from-other-users-and-anonymous

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug}/upload and POST /videos/{slug}/upload/parts with the second user's token
    - expect: both status 404, `error` = `"VIDEO_NOT_FOUND"`
  2. Same requests without `Authorization`
    - expect: both status 401

#### 1.5. rejects-session-routes-after-completion

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. Upload all parts and POST /videos/{slug}/upload/complete as the owner
    - expect: status 202
  2. GET /videos/{slug}/upload and POST /videos/{slug}/upload/parts as the owner
    - expect: both status 409, `error` = `"VIDEO_UPLOAD_NOT_ACTIVE"`
