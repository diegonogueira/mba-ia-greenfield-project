export function videoObjectKey(videoId: string): string {
  return `videos/${videoId}/original`;
}

export function thumbnailObjectKey(videoId: string): string {
  return `thumbnails/${videoId}.jpg`;
}
