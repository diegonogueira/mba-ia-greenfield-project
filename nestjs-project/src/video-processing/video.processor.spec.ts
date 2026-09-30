import { UnrecoverableError } from 'bullmq';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { InvalidMediaError } from './media.errors';
import { VideoProcessor } from './video.processor';

const probeResult = {
  durationSeconds: 10,
  width: 320,
  height: 240,
  videoCodec: 'h264',
  audioCodec: 'aac',
  formatName: 'mp4',
  bitRate: 1000,
  frameRate: 25,
};

function makeJob(attemptsMade = 0, attempts = 3): any {
  return { data: { videoId: 'video-1' }, attemptsMade, opts: { attempts } };
}

function setup(status = VideoStatus.PROCESSING) {
  const videosService = {
    findById: jest.fn().mockResolvedValue(
      Object.assign(new Video(), {
        id: 'video-1',
        status,
        video_key: 'videos/video-1/original',
      }),
    ),
    markReady: jest.fn().mockResolvedValue(true),
    markFailed: jest.fn().mockResolvedValue(true),
  };
  const storage = {
    presignGetObject: jest.fn().mockResolvedValue('http://minio/src'),
    putObject: jest.fn().mockResolvedValue(undefined),
  };
  const media = {
    probe: jest.fn().mockResolvedValue(probeResult),
    captureThumbnail: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8])),
  };
  const processor = new VideoProcessor(
    videosService as any,
    storage as any,
    media as any,
    { workerConcurrency: 1 } as any,
  );
  return { processor, videosService, storage, media };
}

describe('VideoProcessor', () => {
  it('extracts metadata, stores the thumbnail and marks the video ready', async () => {
    const { processor, videosService, storage, media } = setup();

    await processor.process(makeJob());

    expect(storage.presignGetObject).toHaveBeenCalledWith(
      'videos/video-1/original',
      expect.objectContaining({ audience: 'internal' }),
    );
    expect(media.captureThumbnail).toHaveBeenCalledWith('http://minio/src', 1);
    expect(storage.putObject).toHaveBeenCalledWith(
      'thumbnails/video-1.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    const { durationSeconds, ...metadata } = probeResult;
    expect(videosService.markReady).toHaveBeenCalledWith('video-1', {
      durationSeconds,
      metadata,
      thumbnailKey: 'thumbnails/video-1.jpg',
    });
  });

  it('skips a video that is no longer processing (idempotent redelivery)', async () => {
    const { processor, videosService, storage, media } = setup(
      VideoStatus.READY,
    );

    await processor.process(makeJob());

    expect(media.probe).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(videosService.markReady).not.toHaveBeenCalled();
    expect(videosService.markFailed).not.toHaveBeenCalled();
  });

  it('retries (plain error, no side effects) when the video is still draft', async () => {
    const { processor, videosService, media } = setup(VideoStatus.DRAFT);

    const error = await processor.process(makeJob()).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(media.probe).not.toHaveBeenCalled();
    expect(videosService.markFailed).not.toHaveBeenCalled();
  });

  it('fails without retries when the video row does not exist', async () => {
    const { processor, videosService } = setup();
    videosService.findById.mockResolvedValue(null);

    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('marks invalid media as failed and stops retrying', async () => {
    const { processor, videosService, media } = setup();
    media.probe.mockRejectedValue(
      new InvalidMediaError('No video stream found'),
    );

    await expect(processor.process(makeJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(videosService.markFailed).toHaveBeenCalledWith(
      'video-1',
      'No video stream found',
    );
  });

  it('rethrows a transient error on attempt 1 of 3 without marking failed', async () => {
    const { processor, videosService, storage } = setup();
    storage.putObject.mockRejectedValue(new Error('storage timeout'));

    await expect(processor.process(makeJob(0, 3))).rejects.toThrow(
      'storage timeout',
    );
    expect(videosService.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed when the last attempt fails, then rethrows', async () => {
    const { processor, videosService, storage } = setup();
    storage.putObject.mockRejectedValue(new Error('storage timeout'));

    await expect(processor.process(makeJob(2, 3))).rejects.toThrow(
      'storage timeout',
    );
    expect(videosService.markFailed).toHaveBeenCalledWith(
      'video-1',
      'Processing failed after 3 attempts: storage timeout',
    );
  });
});
