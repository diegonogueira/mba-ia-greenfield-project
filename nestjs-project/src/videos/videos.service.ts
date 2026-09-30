import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource, QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidPartNumberException,
  UploadIncompleteException,
  VideoNotFoundException,
  VideoUploadNotActiveException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import {
  StorageInvalidPartsError,
  StorageUploadNotFoundError,
} from '../storage/storage.errors';
import { videoObjectKey } from '../storage/storage.keys';
import type { UploadedPart } from '../storage/storage.types';
import type { CreateVideoDto } from './dto/create-video.dto';
import type { UploadStatusDto } from './dto/upload-status.dto';
import type {
  CreatedVideoResponseDto,
  UploadSessionDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { Video, VideoMetadata } from './entities/video.entity';
import { generateVideoSlug } from './video-slug.util';
import {
  PROCESS_VIDEO_JOB,
  PROCESS_VIDEO_JOB_OPTIONS,
  ProcessVideoJobData,
  VIDEO_FAILURE_REASON_MAX_LENGTH,
  VIDEO_PROCESSING_QUEUE,
  VideoStatus,
} from './videos.constants';
import { toVideoResponse } from './videos.mapper';
import { VideosRepository } from './videos.repository';

const PG_UNIQUE_VIOLATION = '23505';
const MAX_SLUG_ATTEMPTS = 5;

function isSlugConflict(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: string; detail?: string };
  return e.code === PG_UNIQUE_VIOLATION && !!e.detail?.includes('slug');
}

export interface ProcessingResult {
  durationSeconds: number | null;
  metadata: VideoMetadata;
  thumbnailKey: string;
}

export function computePartCount(sizeBytes: number, partSize: number): number {
  return Math.ceil(sizeBytes / partSize);
}

@Injectable()
export class VideosService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly channelsService: ChannelsService,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
    @Inject(videoConfig.KEY)
    private readonly videoCfg: ConfigType<typeof videoConfig>,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly processingQueue: Queue<ProcessVideoJobData>,
  ) {}

  /**
   * Pre-registers the video as `draft` and opens the multipart upload in the
   * storage. The file never goes through the API: the client PUTs each part
   * to the returned presigned URLs.
   */
  async createDraft(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<CreatedVideoResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const id = randomUUID();
    const key = videoObjectKey(id);
    const partSize = this.videoCfg.uploadPartSizeBytes;
    const partCount = computePartCount(dto.sizeBytes, partSize);
    const uploadId = await this.storage.createMultipartUpload(
      key,
      dto.mimeType,
    );

    let video: Video;
    try {
      video = await this.insertDraftWithUniqueSlug({
        id,
        channel_id: channel.id,
        title: dto.title,
        status: VideoStatus.DRAFT,
        original_filename: dto.fileName,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        video_key: key,
        upload_id: uploadId,
      });
    } catch (err) {
      await this.storage.abortMultipartUpload(key, uploadId);
      throw err;
    }
    video.channel = channel;

    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
    const upload = await this.signParts(video, partNumbers, partSize);

    return { ...toVideoResponse(video), upload };
  }

  /** Upload state for resuming: which parts the storage already holds. */
  async getUploadSession(
    slug: string,
    userId: string,
  ): Promise<UploadStatusDto> {
    const video = await this.findOwnedDraft(slug, userId);
    const partSize = this.videoCfg.uploadPartSizeBytes;
    const uploaded = await this.storage.listParts(
      video.video_key,
      video.upload_id!,
    );
    return {
      partSize,
      partCount: computePartCount(video.size_bytes, partSize),
      uploadedParts: uploaded.map((p) => ({
        partNumber: p.partNumber,
        sizeBytes: p.sizeBytes,
      })),
    };
  }

  /** Fresh presigned URLs for parts to (re-)send — expired URLs or failed parts. */
  async signUploadParts(
    slug: string,
    userId: string,
    partNumbers: number[],
  ): Promise<Omit<UploadSessionDto, 'partSize' | 'partCount'>> {
    const video = await this.findOwnedDraft(slug, userId);
    const partSize = this.videoCfg.uploadPartSizeBytes;
    const partCount = computePartCount(video.size_bytes, partSize);
    if (partNumbers.some((n) => n > partCount)) {
      throw new InvalidPartNumberException();
    }
    const { expiresAt, parts } = await this.signParts(
      video,
      partNumbers,
      partSize,
    );
    return { expiresAt, parts };
  }

  /**
   * Completes the multipart upload from the storage's own part listing, moves
   * the video draft → processing and enqueues the processing job. Status change
   * and enqueue share one transaction: a failed enqueue keeps the video draft.
   */
  async completeUpload(
    slug: string,
    userId: string,
  ): Promise<VideoResponseDto> {
    const video = await this.findOwnedDraft(slug, userId);
    await this.completeStorageUpload(video);

    await this.dataSource.transaction(async (manager) => {
      const changed = await this.videosRepository.transitionStatus(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { upload_id: null },
        manager,
      );
      if (!changed) {
        throw new VideoUploadNotActiveException();
      }
      await this.processingQueue.add(
        PROCESS_VIDEO_JOB,
        { videoId: video.id },
        { jobId: video.id, ...PROCESS_VIDEO_JOB_OPTIONS },
      );
    });

    const updated = await this.videosRepository.findById(video.id);
    return toVideoResponse(updated!);
  }

  private async completeStorageUpload(video: Video): Promise<void> {
    const partCount = computePartCount(
      video.size_bytes,
      this.videoCfg.uploadPartSizeBytes,
    );
    try {
      const parts = await this.storage.listParts(
        video.video_key,
        video.upload_id!,
      );
      this.assertAllPartsUploaded(parts, partCount, video.size_bytes);
      await this.storage.completeMultipartUpload(
        video.video_key,
        video.upload_id!,
        parts,
      );
    } catch (err) {
      if (err instanceof StorageInvalidPartsError) {
        throw new UploadIncompleteException();
      }
      if (err instanceof StorageUploadNotFoundError) {
        // A previous call completed the upload in storage but did not reach the
        // status change: accept it when the object is there with the full size.
        const head = await this.storage.headObject(video.video_key);
        if (head?.sizeBytes === video.size_bytes) return;
        throw new UploadIncompleteException();
      }
      throw err;
    }
  }

  private assertAllPartsUploaded(
    parts: UploadedPart[],
    partCount: number,
    sizeBytes: number,
  ): void {
    const numbers = parts.map((p) => p.partNumber);
    const total = parts.reduce((sum, p) => sum + p.sizeBytes, 0);
    const complete =
      parts.length === partCount &&
      numbers.every((n, i) => n === i + 1) &&
      total === sizeBytes;
    if (!complete) {
      throw new UploadIncompleteException();
    }
  }

  async findById(id: string): Promise<Video | null> {
    return this.videosRepository.findById(id);
  }

  /** Worker success: processing → ready. Returns false when the video was not processing. */
  async markReady(id: string, result: ProcessingResult): Promise<boolean> {
    return this.videosRepository.transitionStatus(
      id,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      {
        duration_seconds: result.durationSeconds,
        metadata: result.metadata,
        thumbnail_key: result.thumbnailKey,
        failure_reason: null,
        processed_at: new Date(),
      },
    );
  }

  /** Worker failure (invalid media or retries exhausted): processing → failed. */
  async markFailed(id: string, reason: string): Promise<boolean> {
    return this.videosRepository.transitionStatus(
      id,
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
      {
        failure_reason: reason.slice(0, VIDEO_FAILURE_REASON_MAX_LENGTH),
        processed_at: new Date(),
      },
    );
  }

  /** Owner-only lookup of a video whose upload is still open (`draft`). */
  async findOwnedDraft(slug: string, userId: string): Promise<Video> {
    const video = await this.videosRepository.findBySlug(slug);
    if (!video || video.channel.user_id !== userId) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoUploadNotActiveException();
    }
    return video;
  }

  private async signParts(
    video: Video,
    partNumbers: number[],
    partSize: number,
  ): Promise<UploadSessionDto> {
    const ttl = this.videoCfg.uploadUrlTtlSeconds;
    const parts = await this.storage.presignUploadParts(
      video.video_key,
      video.upload_id!,
      partNumbers,
      ttl,
    );
    return {
      partSize,
      partCount: computePartCount(video.size_bytes, partSize),
      expiresAt: new Date(Date.now() + ttl * 1000),
      parts,
    };
  }

  /** Inserts the row, regenerating the slug on a unique violation (SAVEPOINT per attempt). */
  private async insertDraftWithUniqueSlug(
    data: Omit<Partial<Video>, 'slug'>,
  ): Promise<Video> {
    return this.dataSource.transaction(async (manager) => {
      for (let attempt = 1; ; attempt++) {
        const savepoint = `video_slug_${attempt}`;
        await manager.query(`SAVEPOINT ${savepoint}`);
        try {
          const video = await this.videosRepository.insert(
            { ...data, slug: generateVideoSlug() },
            manager,
          );
          await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
          return video;
        } catch (err) {
          await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          if (!isSlugConflict(err) || attempt >= MAX_SLUG_ATTEMPTS) {
            throw err;
          }
        }
      }
    });
  }
}
