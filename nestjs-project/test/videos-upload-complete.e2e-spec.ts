import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/videos.constants';
import {
  applyVideoTestEnv,
  createLoggedUser,
  createVideosTestApp,
  MIB,
  putPart,
  TestUser,
} from './helpers/videos-e2e';

describe('POST /videos/:slug/upload/complete (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let queue: Queue;
  let storage: StorageService;
  let owner: TestUser;
  let other: TestUser;
  let draft: { id: string; slug: string; urls: string[] };

  const PART = 5 * MIB;
  const SIZE = PART + 4096;

  beforeAll(async () => {
    applyVideoTestEnv({ VIDEO_UPLOAD_PART_SIZE_BYTES: String(PART) });
    app = await createVideosTestApp();
    dataSource = app.get(DataSource);
    queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    owner = await createLoggedUser(app);
    other = await createLoggedUser(app);
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Two parts',
        fileName: 'two.mp4',
        mimeType: 'video/mp4',
        sizeBytes: SIZE,
      })
      .expect(201);
    draft = {
      id: res.body.id,
      slug: res.body.slug,
      urls: res.body.upload.parts.map((p: { url: string }) => p.url),
    };
  });

  const complete = (token: string | null) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${draft.slug}/upload/complete`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  async function uploadAllParts(): Promise<void> {
    expect((await putPart(draft.urls[0], Buffer.alloc(PART, 1))).status).toBe(
      200,
    );
    expect((await putPart(draft.urls[1], Buffer.alloc(4096, 2))).status).toBe(
      200,
    );
  }

  // 1.1 — completes-and-enqueues-processing
  it('completes the upload and enqueues processing', async () => {
    await uploadAllParts();

    const res = await complete(owner.accessToken).expect(202);

    expect(res.body.status).toBe('processing');
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: draft.id });
    expect(row.status).toBe('processing');
    expect(row.upload_id).toBeNull();
    const job = await queue.getJob(draft.id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: draft.id });
    expect(await storage.headObject(row.video_key)).toMatchObject({
      sizeBytes: SIZE,
    });
    await storage.deleteObject(row.video_key);
  });

  // 1.2 — second-complete-is-rejected-without-duplicate-job
  it('rejects a second complete without creating another job', async () => {
    await uploadAllParts();
    await complete(owner.accessToken).expect(202);

    const res = await complete(owner.accessToken).expect(409);

    expect(res.body.error).toBe('VIDEO_UPLOAD_NOT_ACTIVE');
    expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed')).toBe(
      1,
    );
    await storage.deleteObject(`videos/${draft.id}/original`);
  });

  // 1.3 — missing-part-returns-422-and-keeps-draft
  it('returns 422 for a missing part and keeps the draft', async () => {
    await putPart(draft.urls[0], Buffer.alloc(PART, 1));

    const res = await complete(owner.accessToken).expect(422);

    expect(res.body.error).toBe('UPLOAD_INCOMPLETE');
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: draft.id });
    expect(row.status).toBe('draft');
    expect(row.upload_id).not.toBeNull();
    expect(await queue.getJob(draft.id)).toBeUndefined();
  });

  // 1.4 — owner-only
  it('is owner-only', async () => {
    const res = await complete(other.accessToken).expect(404);
    expect(res.body.error).toBe('VIDEO_NOT_FOUND');

    await complete(null).expect(401);
  });
});
