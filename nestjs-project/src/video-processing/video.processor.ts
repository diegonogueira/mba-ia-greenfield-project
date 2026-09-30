import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import videoConfig from '../config/video.config';
import { thumbnailObjectKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import {
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
  VideoStatus,
} from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import { InvalidMediaError } from './media.errors';
import { MediaProbeService, thumbnailTimestamp } from './media-probe.service';

/** Lifetime of the internal URL FFmpeg reads the original from. */
const SOURCE_URL_TTL_SECONDS = 3600;

function isLastAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly storage: StorageService,
    private readonly media: MediaProbeService,
    @Inject(videoConfig.KEY)
    private readonly videoCfg: ConfigType<typeof videoConfig>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.videoCfg.workerConcurrency;
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videosService.findById(videoId);
    if (!video) {
      throw new UnrecoverableError(`Video ${videoId} not found`);
    }
    if (video.status === VideoStatus.DRAFT) {
      // The API commits draft → processing before enqueueing; a draft here means
      // that transition was compensated or not visible yet. Retry later.
      throw new Error(`Video ${videoId} is not ready for processing yet`);
    }
    if (video.status !== VideoStatus.PROCESSING) {
      // At-least-once delivery: a repeated job for a finished video is a no-op.
      this.logger.log(`Skipping video ${videoId} in status ${video.status}`);
      return;
    }

    try {
      const sourceUrl = await this.storage.presignGetObject(video.video_key, {
        ttlSeconds: SOURCE_URL_TTL_SECONDS,
        audience: 'internal',
      });
      const probe = await this.media.probe(sourceUrl);
      const jpeg = await this.media.captureThumbnail(
        sourceUrl,
        thumbnailTimestamp(probe.durationSeconds),
      );
      const thumbnailKey = thumbnailObjectKey(videoId);
      await this.storage.putObject(thumbnailKey, jpeg, 'image/jpeg');

      const { durationSeconds, ...metadata } = probe;
      await this.videosService.markReady(videoId, {
        durationSeconds,
        metadata,
        thumbnailKey,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof InvalidMediaError) {
        await this.videosService.markFailed(videoId, message);
        throw new UnrecoverableError(message);
      }
      if (isLastAttempt(job)) {
        await this.videosService.markFailed(
          videoId,
          `Processing failed after ${job.opts.attempts ?? 1} attempts: ${message}`,
        );
      }
      throw err;
    }
  }
}
