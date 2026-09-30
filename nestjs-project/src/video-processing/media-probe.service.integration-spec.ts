import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import { generateSampleVideo } from '../test/sample-video';
import { testStorageConfig } from '../test/storage';
import { InvalidMediaError } from './media.errors';
import { MediaProbeService } from './media-probe.service';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function jpegWidth(jpeg: Buffer): number {
  // Walk JPEG segments until a SOFn marker, whose payload holds height/width.
  let offset = 2;
  while (offset < jpeg.length) {
    const marker = jpeg[offset + 1];
    const length = jpeg.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return jpeg.readUInt16BE(offset + 7);
    }
    offset += 2 + length;
  }
  throw new Error('No SOF marker');
}

describe('MediaProbeService (integration — ffmpeg + MinIO)', () => {
  const probe = new MediaProbeService();
  let storage: StorageService;
  let videoKey: string;
  let textKey: string;

  beforeAll(async () => {
    storage = new StorageService(testStorageConfig());
    videoKey = `test/${randomUUID()}.mp4`;
    textKey = `test/${randomUUID()}.txt`;
    await storage.putObject(
      videoKey,
      await generateSampleVideo({ durationSeconds: 2, width: 320, height: 240 }),
      'video/mp4',
    );
    await storage.putObject(
      textKey,
      Buffer.from('definitely not a video'),
      'text/plain',
    );
  }, 60_000);

  afterAll(async () => {
    await storage.deleteObject(videoKey);
    await storage.deleteObject(textKey);
    storage.onModuleDestroy();
  });

  const urlFor = (key: string) =>
    storage.presignGetObject(key, { ttlSeconds: 300, audience: 'internal' });

  it('reads duration and metadata over a presigned URL', async () => {
    const result = await probe.probe(await urlFor(videoKey));

    expect(result.durationSeconds).toBeGreaterThan(1.9);
    expect(result.durationSeconds).toBeLessThan(2.1);
    expect(result).toMatchObject({
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 25,
    });
    expect(result.formatName).toContain('mp4');
  });

  it('renders a JPEG thumbnail no wider than 1280 px', async () => {
    const jpeg = await probe.captureThumbnail(await urlFor(videoKey), 0.2);

    expect(jpeg.subarray(0, 3).equals(JPEG_MAGIC)).toBe(true);
    expect(jpegWidth(jpeg)).toBe(320);
  });

  it('scales thumbnails of wider videos down to 1280 px', async () => {
    const wideKey = `test/${randomUUID()}.mp4`;
    await storage.putObject(
      wideKey,
      await generateSampleVideo({ durationSeconds: 1, width: 1920, height: 1080 }),
      'video/mp4',
    );

    const jpeg = await probe.captureThumbnail(await urlFor(wideKey), 0.1);

    expect(jpegWidth(jpeg)).toBe(1280);
    await storage.deleteObject(wideKey);
  }, 60_000);

  it('raises InvalidMediaError for a non-video object', async () => {
    await expect(probe.probe(await urlFor(textKey))).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });
});
