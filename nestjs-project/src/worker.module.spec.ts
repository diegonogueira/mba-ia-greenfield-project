import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from './app.module';
import { VideoProcessor } from './video-processing/video.processor';
import { VIDEO_PROCESSING_QUEUE } from './videos/videos.constants';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  beforeAll(() => {
    process.env.QUEUE_PREFIX = 'bull-test-worker-module';
  });

  afterAll(() => {
    delete process.env.QUEUE_PREFIX;
  });

  it('compiles the worker graph and resolves the processor', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);
    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await module.close();
  });

  it('keeps the processor out of the API module graph', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(() => module.get(VideoProcessor, { strict: false })).toThrow();
    await module.close();
  });
});
