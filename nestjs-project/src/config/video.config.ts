import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  uploadPartSizeBytes: parseInt(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || '67108864',
    10,
  ),
  uploadUrlTtlSeconds: parseInt(
    process.env.VIDEO_UPLOAD_URL_TTL_SECONDS || '3600',
    10,
  ),
  playbackUrlTtlSeconds: parseInt(
    process.env.VIDEO_PLAYBACK_URL_TTL_SECONDS || '21600',
    10,
  ),
  workerConcurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '1', 10),
}));
