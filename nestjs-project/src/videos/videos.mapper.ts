import type { VideoResponseDto } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';

/** Public shape of a video — never exposes storage keys, upload id or owner user id. */
export function toVideoResponse(video: Video): VideoResponseDto {
  return {
    id: video.id,
    slug: video.slug,
    title: video.title,
    status: video.status,
    mimeType: video.mime_type,
    sizeBytes: video.size_bytes,
    durationSeconds: video.duration_seconds,
    metadata: video.metadata,
    failureReason: video.failure_reason,
    channel: { id: video.channel.id, nickname: video.channel.nickname },
    createdAt: video.created_at,
    processedAt: video.processed_at,
  };
}
