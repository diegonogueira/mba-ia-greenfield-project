import { TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import { thumbnailObjectKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { generateSampleVideo } from '../test/sample-video';
import { buildVideo, createUserWithChannel } from '../test/video-fixtures';
import { createWorkerTestModule } from '../test/worker-test-module';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { VideoProcessor } from './video.processor';

describe('VideoProcessor (integration — DB + MinIO + ffmpeg)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let processor: VideoProcessor;
  let sample: Buffer;

  beforeAll(async () => {
    module = await createWorkerTestModule('bull-test-processor');
    await module.init();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    processor = module.get(VideoProcessor);
    sample = await generateSampleVideo({ durationSeconds: 3 });
  }, 60_000);

  afterAll(async () => {
    await module.close();
    delete process.env.QUEUE_PREFIX;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function processingVideoWith(body: Buffer, mime: string) {
    const { channel } = await createUserWithChannel(dataSource);
    const video = await dataSource.getRepository(Video).save(
      buildVideo(channel.id, {
        status: VideoStatus.PROCESSING,
        upload_id: null,
        size_bytes: body.length,
        mime_type: mime,
      }),
    );
    await storage.putObject(video.video_key, body, mime);
    return video;
  }

  const job = (videoId: string, attemptsMade = 0) =>
    ({ data: { videoId }, attemptsMade, opts: { attempts: 3 } }) as any;

  it('processes a real upload into a ready video with metadata and thumbnail', async () => {
    const video = await processingVideoWith(sample, 'video/mp4');

    await processor.process(job(video.id));

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeGreaterThan(2.9);
    expect(row.duration_seconds).toBeLessThan(3.1);
    expect(row.metadata).toMatchObject({
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(row.thumbnail_key).toBe(thumbnailObjectKey(video.id));
    expect(row.processed_at).toBeInstanceOf(Date);
    expect(await storage.headObject(row.thumbnail_key!)).toMatchObject({
      contentType: 'image/jpeg',
    });

    await storage.deleteObject(row.video_key);
    await storage.deleteObject(row.thumbnail_key!);
  }, 60_000);

  it('marks a non-video upload as failed without retrying', async () => {
    const video = await processingVideoWith(
      Buffer.from('this is plain text'),
      'video/mp4',
    );

    await expect(processor.process(job(video.id))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toBeTruthy();
    expect(row.thumbnail_key).toBeNull();
    await storage.deleteObject(row.video_key);
  });

  it('does nothing when the job is re-delivered for a ready video', async () => {
    const video = await processingVideoWith(sample, 'video/mp4');
    await processor.process(job(video.id));
    const first = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });

    await processor.process(job(video.id));

    const second = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(second.status).toBe(VideoStatus.READY);
    expect(second.updated_at).toEqual(first.updated_at);
    await storage.deleteObject(first.video_key);
    await storage.deleteObject(first.thumbnail_key!);
  }, 60_000);
});
