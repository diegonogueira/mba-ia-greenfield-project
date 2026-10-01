import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateSampleVideo } from '../src/test/sample-video';
import { buildVideo } from '../src/test/video-fixtures';
import { VideoProcessingModule } from '../src/video-processing/video-processing.module';
import { Video } from '../src/videos/entities/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoStatus,
} from '../src/videos/videos.constants';
import {
  applyVideoTestEnv,
  createLoggedUser,
  createVideosTestApp,
  putPart,
  TestUser,
} from './helpers/videos-e2e';

const VIDEO_RESPONSE_KEYS = [
  'channel',
  'createdAt',
  'durationSeconds',
  'failureReason',
  'id',
  'metadata',
  'mimeType',
  'processedAt',
  'sizeBytes',
  'slug',
  'status',
  'title',
];

describe('Video read, stream, download and thumbnail (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue;
  let sample: Buffer;
  let owner: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    applyVideoTestEnv();
    // The test app also runs the processor (on the test queue prefix), playing
    // the role of the video-worker container for this suite.
    app = await createVideosTestApp((b) => b, [VideoProcessingModule]);
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    sample = await generateSampleVideo({ durationSeconds: 3 });
  }, 60_000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createLoggedUser(app);
    other = await createLoggedUser(app);
  });

  const http = () => request(app.getHttpServer());

  async function waitForStatus(slug: string, token: string, status: string) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const res = await http()
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body.status === status) return res;
      if (Date.now() > deadline) {
        const job = await queue.getJob(res.body.id);
        throw new Error(
          `Video ${slug} stuck in ${res.body.status} (job state: ${job ? await job.getState() : 'missing'}, attempts: ${job?.attemptsMade}, reason: ${job?.failedReason})`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function uploadAndProcess(): Promise<{ slug: string; id: string }> {
    const created = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Pipeline',
        fileName: 'pipeline clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: sample.length,
      })
      .expect(201);
    const { slug, id } = created.body;
    for (const part of created.body.upload.parts) {
      expect((await putPart(part.url, sample)).status).toBe(200);
    }
    const completed = await http()
      .post(`/videos/${slug}/upload/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(202);
    expect(completed.body.status).toBe('processing');
    await waitForStatus(slug, owner.accessToken, 'ready');
    return { slug, id };
  }

  async function cleanupObjects(id: string): Promise<void> {
    await storage.deleteObject(`videos/${id}/original`);
    await storage.deleteObject(`thumbnails/${id}.jpg`);
  }

  describe('full pipeline and public reads', () => {
    // 1.1 — uploaded-video-becomes-ready-and-readable-anonymously
    it('turns an upload into a ready video readable anonymously', async () => {
      const { slug, id } = await uploadAndProcess();

      const res = await http().get(`/videos/${slug}`).expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.durationSeconds).toBeGreaterThan(2.9);
      expect(res.body.durationSeconds).toBeLessThan(3.1);
      expect(res.body.metadata).toMatchObject({ width: 320, height: 240 });
      expect(Object.keys(res.body).sort()).toEqual(VIDEO_RESPONSE_KEYS);
      await cleanupObjects(id);
    }, 60_000);

    // 1.2 — stream-redirects-to-range-capable-url
    // 1.3 — download-uses-attachment-disposition
    // 1.4 — thumbnail-is-a-jpeg
    it('streams with range requests, downloads as attachment and serves the thumbnail', async () => {
      const { slug, id } = await uploadAndProcess();

      const stream = await http().get(`/videos/${slug}/stream`).expect(302);
      const ranged = await fetch(stream.headers.location, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe(
        `bytes 0-1023/${sample.length}`,
      );
      expect((await ranged.arrayBuffer()).byteLength).toBe(1024);

      const download = await http().get(`/videos/${slug}/download`).expect(302);
      const file = await fetch(download.headers.location);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toContain(
        'attachment; filename="pipeline clip.mp4"',
      );
      expect((await file.arrayBuffer()).byteLength).toBe(sample.length);

      const thumb = await http().get(`/videos/${slug}/thumbnail`).expect(302);
      const jpeg = await fetch(thumb.headers.location);
      expect(jpeg.status).toBe(200);
      expect(jpeg.headers.get('content-type')).toBe('image/jpeg');
      const bytes = Buffer.from(await jpeg.arrayBuffer());
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      await cleanupObjects(id);
    }, 60_000);
  });

  describe('visibility of non-ready videos', () => {
    async function processingVideo(): Promise<string> {
      const video = await dataSource.getRepository(Video).save(
        buildVideo(owner.channel.id, {
          status: VideoStatus.PROCESSING,
          upload_id: null,
        }),
      );
      return video.slug;
    }

    // 2.1 — processing-video-hidden-from-others-visible-to-owner
    it('hides a processing video from others and shows it to its owner', async () => {
      const slug = await processingVideo();

      const anon = await http().get(`/videos/${slug}`).expect(404);
      const stranger = await http()
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(404);
      expect(anon.body.error).toBe('VIDEO_NOT_FOUND');
      expect(stranger.body.error).toBe('VIDEO_NOT_FOUND');

      const mine = await http()
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(mine.body.status).toBe('processing');

      const notReady = await http()
        .get(`/videos/${slug}/stream`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(409);
      expect(notReady.body.error).toBe('VIDEO_NOT_READY');

      const anonStream = await http().get(`/videos/${slug}/stream`).expect(404);
      expect(anonStream.body.error).toBe('VIDEO_NOT_FOUND');
    });

    // 2.2 — invalid-token-is-rejected-on-public-routes
    it('rejects an invalid token on every public read route', async () => {
      const slug = await processingVideo();

      for (const path of ['', '/stream', '/download', '/thumbnail']) {
        await http()
          .get(`/videos/${slug}${path}`)
          .set('Authorization', 'Bearer invalid')
          .expect(401);
      }
    });

    // 2.3 — unknown-slug-is-404
    it('returns 404 for an unknown slug', async () => {
      const res = await http().get('/videos/AAAAAAAAAAA').expect(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    // 2.4 — response-never-exposes-internal-fields
    it('never exposes storage keys, upload id or the owner user id', async () => {
      const slug = await processingVideo();

      const res = await http()
        .get(`/videos/${slug}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(VIDEO_RESPONSE_KEYS);
      expect(Object.keys(res.body.channel).sort()).toEqual(['id', 'nickname']);
    });
  });
});
