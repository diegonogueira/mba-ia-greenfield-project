/** The multipart upload id does not exist (never created, aborted or already completed). */
export class StorageUploadNotFoundError extends Error {
  constructor(message = 'Multipart upload not found') {
    super(message);
    this.name = 'StorageUploadNotFoundError';
  }
}

/** The storage refused the part set (missing/invalid part or a non-final part below 5 MiB). */
export class StorageInvalidPartsError extends Error {
  constructor(message = 'Invalid multipart part set') {
    super(message);
    this.name = 'StorageInvalidPartsError';
  }
}
