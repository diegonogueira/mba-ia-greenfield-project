import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  applyVideoTestEnv,
  createLoggedUser,
  createVideosTestApp,
  putPart,
  TestUser,
} from './helpers/videos-e2e';

describe('POST /videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: TestUser;

  const validBody = {
    title: 'My first upload',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 12_000_000,
  };

  beforeAll(async () => {
    applyVideoTestEnv();
    app = await createVideosTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createLoggedUser(app);
  });

  function post(body: object, token: string | null = owner.accessToken) {
    const req = request(app.getHttpServer()).post('/videos');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  // 1.1 — creates-draft-with-upload-session
  it('creates a draft with an upload session', async () => {
    const res = await post(validBody).expect(201);

    expect(res.body.status).toBe('draft');
    expect(res.body.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(res.body.upload.partCount).toBe(1);
    expect(res.body.upload.parts).toHaveLength(res.body.upload.partCount);

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: res.body.id });
    expect(row.status).toBe('draft');
    expect(row.channel_id).toBe(owner.channel.id);
    expect(row.upload_id).toBeTruthy();
    expect(row.video_key).toBe(`videos/${res.body.id}/original`);
  });

  // 1.2 — rejects-size-above-10-gib
  it('rejects a size above 10 GiB', async () => {
    const res = await post({ ...validBody, sizeBytes: 10737418241 }).expect(
      400,
    );

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  // 1.3 — rejects-non-video-mime-type
  it('rejects a non-video MIME type', async () => {
    const res = await post({ ...validBody, mimeType: 'image/png' }).expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  // 1.4 — requires-authentication
  it('requires authentication', async () => {
    await post(validBody, null).expect(401);
  });

  // 1.5 — ten-gib-upload-is-split-in-160-parts
  it('splits a 10 GiB upload in 160 parts of 64 MiB', async () => {
    const res = await post({ ...validBody, sizeBytes: 10737418240 }).expect(
      201,
    );

    expect(res.body.upload.partSize).toBe(67108864);
    expect(res.body.upload.partCount).toBe(160);
    expect(res.body.upload.parts).toHaveLength(160);
  });

  // 1.6 — part-url-accepts-direct-put-to-storage
  it('accepts the part bytes directly on the storage URL', async () => {
    const bytes = Buffer.from('tiny video payload');
    const res = await post({ ...validBody, sizeBytes: bytes.length }).expect(
      201,
    );

    const put = await putPart(res.body.upload.parts[0].url, bytes);

    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toBeTruthy();
  });
});
