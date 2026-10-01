import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/videos.constants';
import {
  applyVideoTestEnv,
  createLoggedUser,
  createVideosTestApp,
  MIB,
  putPart,
  TestUser,
} from './helpers/videos-e2e';

describe('Upload session — GET /videos/:slug/upload, POST /videos/:slug/upload/parts (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: TestUser;
  let other: TestUser;
  let slug: string;
  let partUrls: string[];

  const PART = 5 * MIB;

  beforeAll(async () => {
    applyVideoTestEnv({ VIDEO_UPLOAD_PART_SIZE_BYTES: String(PART) });
    app = await createVideosTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app
      .get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .obliterate({ force: true });
    await app.close();
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createLoggedUser(app);
    other = await createLoggedUser(app);
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Resumable',
        fileName: 'big.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2 * PART + 1024,
      })
      .expect(201);
    slug = res.body.slug;
    partUrls = res.body.upload.parts.map((p: { url: string }) => p.url);
  });

  const getSession = (token: string | null) => {
    const req = request(app.getHttpServer()).get(`/videos/${slug}/upload`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };
  const signParts = (token: string | null, partNumbers: number[]) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${slug}/upload/parts`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({ partNumbers });
  };

  // 1.1 — lists-uploaded-parts-after-partial-upload
  it('lists the uploaded parts after a partial upload', async () => {
    expect((await putPart(partUrls[0], Buffer.alloc(PART, 1))).status).toBe(
      200,
    );

    const res = await getSession(owner.accessToken).expect(200);

    expect(res.body.partCount).toBe(3);
    expect(res.body.uploadedParts).toEqual([
      { partNumber: 1, sizeBytes: PART },
    ]);
  });

  // 1.2 — re-signs-requested-parts
  it('re-signs the requested parts', async () => {
    const res = await signParts(owner.accessToken, [2, 3]).expect(200);

    expect(
      res.body.parts.map((p: { partNumber: number }) => p.partNumber),
    ).toEqual([2, 3]);
    const expiresInMs = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(3500 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(3600 * 1000);

    const put = await putPart(res.body.parts[0].url, Buffer.alloc(PART, 2));
    expect(put.status).toBe(200);
  });

  // 1.3 — rejects-part-number-out-of-range
  it('rejects part numbers out of range and an empty list', async () => {
    const outOfRange = await signParts(owner.accessToken, [999]).expect(400);
    expect(outOfRange.body.error).toBe('INVALID_PART_NUMBER');

    const empty = await signParts(owner.accessToken, []).expect(400);
    expect(empty.body.error).toBe('VALIDATION_ERROR');
  });

  // 1.4 — hides-session-from-other-users-and-anonymous
  it('hides the session from other users and anonymous callers', async () => {
    const a = await getSession(other.accessToken).expect(404);
    const b = await signParts(other.accessToken, [1]).expect(404);
    expect(a.body.error).toBe('VIDEO_NOT_FOUND');
    expect(b.body.error).toBe('VIDEO_NOT_FOUND');

    await getSession(null).expect(401);
    await signParts(null, [1]).expect(401);
  });

  // 1.5 — rejects-session-routes-after-completion
  it('rejects session routes once the upload is completed', async () => {
    await putPart(partUrls[0], Buffer.alloc(PART, 1));
    await putPart(partUrls[1], Buffer.alloc(PART, 2));
    await putPart(partUrls[2], Buffer.alloc(1024, 3));
    await request(app.getHttpServer())
      .post(`/videos/${slug}/upload/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(202);

    const a = await getSession(owner.accessToken).expect(409);
    const b = await signParts(owner.accessToken, [1]).expect(409);
    expect(a.body.error).toBe('VIDEO_UPLOAD_NOT_ACTIVE');
    expect(b.body.error).toBe('VIDEO_UPLOAD_NOT_ACTIVE');
  });
});
