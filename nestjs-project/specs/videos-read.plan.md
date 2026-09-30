---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-read.e2e-spec.ts
---

# Video Read, Stream, Download and Thumbnail Test Plan

## Application Overview

A video is reachable by its unique slug. When `ready`, anyone can read its metadata, stream it (302 to a presigned URL answered with `206` for range requests), download it (attachment disposition) and fetch its thumbnail; before that only the owner can see it. This spec also exercises the whole pipeline — upload → queue → worker → ready — against the real services.

## Test Scenarios

### 1. Full pipeline and public reads

**Setup:** AppModule bootstrap with global pipes/filters, `S3_PUBLIC_ENDPOINT = S3_ENDPOINT`, a test-only `QUEUE_PREFIX`, and the `VideoProcessingModule` processor running in the same test process on that prefix (the test worker plays the `video-worker` container's role); a sample MP4 generated with ffmpeg (`src/test/sample-video.ts`); `beforeEach` cleans tables and the test queue; owner and second user logged in.

#### 1.1. uploaded-video-becomes-ready-and-readable-anonymously

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. Owner creates the draft, PUTs the sample to the part URL(s) and calls complete
    - expect: 202 with `status: "processing"`
  2. Poll GET /videos/{slug} as the owner until `status` is `ready` (timeout 30 s)
    - expect: `status` = `"ready"`
  3. GET /videos/{slug} without `Authorization`
    - expect: status 200, `durationSeconds` ≈ sample length, `metadata.width`/`metadata.height` = sample size
    - expect: body has no `uploadId`, `videoKey`, `thumbnailKey` or `userId` fields

#### 1.2. stream-redirects-to-range-capable-url

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug}/stream anonymously (no redirect following)
    - expect: status 302 with a `Location` header
  2. GET the `Location` URL with `Range: bytes=0-1023`
    - expect: status 206, 1024 bytes, `Content-Range: bytes 0-1023/<size>`

#### 1.3. download-uses-attachment-disposition

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug}/download, then GET the `Location` URL
    - expect: 302 then 200 with `Content-Disposition` containing `attachment` and the original file name

#### 1.4. thumbnail-is-a-jpeg

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug}/thumbnail, then GET the `Location` URL
    - expect: 302 then 200 with `Content-Type: image/jpeg` and a body starting with `FF D8 FF`

### 2. Visibility of non-ready videos

**Setup:** same bootstrap; the owner creates and completes a video but the test worker is not started for this group, so the row stays `processing` (or the status is set directly in the DB).

#### 2.1. processing-video-hidden-from-others-visible-to-owner

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug} anonymously and with the second user's token
    - expect: both 404, `error` = `"VIDEO_NOT_FOUND"`
  2. GET /videos/{slug} with the owner's token
    - expect: 200, `status` = `"processing"`
  3. GET /videos/{slug}/stream with the owner's token
    - expect: 409, `error` = `"VIDEO_NOT_READY"`
  4. GET /videos/{slug}/stream anonymously
    - expect: 404, `error` = `"VIDEO_NOT_FOUND"`

#### 2.2. invalid-token-is-rejected-on-public-routes

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug}, /stream, /download and /thumbnail with `Authorization: Bearer invalid`
    - expect: 401 on each

#### 2.3. unknown-slug-is-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/AAAAAAAAAAA anonymously
    - expect: 404, `error` = `"VIDEO_NOT_FOUND"`

#### 2.4. response-never-exposes-internal-fields

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-09-30T18:42:00Z

**Steps:**
  1. GET /videos/{slug} as the owner
    - expect: body keys are exactly the `VideoResponse` fields of the API Contracts; no storage keys, upload id or user id
