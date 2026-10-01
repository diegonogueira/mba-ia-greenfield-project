/** The file cannot be read as a video (no video stream, unreadable container). Not retryable. */
export class InvalidMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaError';
  }
}
