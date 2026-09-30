import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { videoObjectKey } from '../storage/storage.keys';
import type { CreateVideoDto } from './dto/create-video.dto';
import type {
  CreatedVideoResponseDto,
  UploadSessionDto,
} from './dto/video-response.dto';
import { Video } from './entities/video.entity';
import { generateVideoSlug } from './video-slug.util';
import { VideoStatus } from './videos.constants';
import { toVideoResponse } from './videos.mapper';
import { VideosRepository } from './videos.repository';

const PG_UNIQUE_VIOLATION = '23505';
const MAX_SLUG_ATTEMPTS = 5;

function isSlugConflict(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: string; detail?: string };
  return e.code === PG_UNIQUE_VIOLATION && !!e.detail?.includes('slug');
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
