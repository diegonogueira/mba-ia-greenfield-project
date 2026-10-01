export interface UploadedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface SignedPart {
  partNumber: number;
  url: string;
}

export type UrlAudience = 'public' | 'internal';

export interface PresignGetOptions {
  ttlSeconds: number;
  audience: UrlAudience;
  /** When set, the storage answers with `Content-Disposition: attachment; filename="..."`. */
  downloadFileName?: string;
}
