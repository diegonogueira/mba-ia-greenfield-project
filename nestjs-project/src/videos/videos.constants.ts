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
