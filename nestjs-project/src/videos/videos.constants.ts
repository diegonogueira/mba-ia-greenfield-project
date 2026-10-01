export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

/** 10 GiB — maximum declared size of an uploaded video. */
export const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

export const VIDEO_TITLE_MAX_LENGTH = 100;
export const VIDEO_FILENAME_MAX_LENGTH = 255;
export const VIDEO_FAILURE_REASON_MAX_LENGTH = 500;
export const VIDEO_SLUG_LENGTH = 11;

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export interface ProcessVideoJobData {
  videoId: string;
}

export const PROCESS_VIDEO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800 },
} as const;
