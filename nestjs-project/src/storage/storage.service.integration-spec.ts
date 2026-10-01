import { randomUUID } from 'node:crypto';
import storageConfig from '../config/storage.config';
import { testStorageConfig } from '../test/storage';
import { StorageInvalidPartsError } from './storage.errors';
import { StorageService } from './storage.service';

const MIB = 1024 * 1024;

async function putPart(url: string, body: Buffer): Promise<Response> {
  return fetch(url, { method: 'PUT', body: new Uint8Array(body) });
}

describe('StorageService (integration — MinIO)', () => {
  let storage: StorageService;
  const keysToDelete: string[] = [];

  beforeAll(() => {
    storage = new StorageService(testStorageConfig());
  });

  afterAll(async () => {
    for (const key of keysToDelete) {
      await storage.deleteObject(key);
    }
    storage.onModuleDestroy();
  });

  function newKey(): string {
    const key = `test/${randomUUID()}`;
    keysToDelete.push(key);
    return key;
  }

  it('uploads a 2-part file through presigned part URLs and completes it', async () => {
    const key = newKey();
    const part1 = Buffer.alloc(5 * MIB, 1);
    const part2 = Buffer.from('tail-bytes');

    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const signed = await storage.presignUploadParts(key, uploadId, [1, 2], 60);
    expect(signed.map((s) => s.partNumber)).toEqual([1, 2]);

    expect((await putPart(signed[0].url, part1)).status).toBe(200);
    expect((await putPart(signed[1].url, part2)).status).toBe(200);

    const parts = await storage.listParts(key, uploadId);
    expect(parts.map((p) => [p.partNumber, p.sizeBytes])).toEqual([
      [1, part1.length],
      [2, part2.length],
    ]);

    await storage.completeMultipartUpload(key, uploadId, parts);

    const head = await storage.headObject(key);
    expect(head).toEqual({
      sizeBytes: part1.length + part2.length,
      contentType: 'video/mp4',
    });
  });

  it('serves byte ranges (206) through a presigned GET URL', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.alloc(1000, 7), 'video/mp4');

    const url = await storage.presignGetObject(key, {
      ttlSeconds: 60,
      audience: 'public',
    });
    const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('adds an attachment Content-Disposition for downloads', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.from('data'), 'video/mp4');

    const url = await storage.presignGetObject(key, {
      ttlSeconds: 60,
      audience: 'public',
      downloadFileName: 'my clip.mp4',
    });
    const res = await fetch(url);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      'attachment; filename="my clip.mp4"',
    );
  });

  it('deletes objects and reports missing keys as null', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.from('x'), 'text/plain');
    await storage.deleteObject(key);

    expect(await storage.headObject(key)).toBeNull();
  });

  it('aborts a multipart upload', async () => {
    const key = newKey();
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toMatchObject({
      name: 'StorageUploadNotFoundError',
    });
  });

  it('translates a non-final part below 5 MiB into StorageInvalidPartsError', async () => {
    const key = newKey();
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const signed = await storage.presignUploadParts(key, uploadId, [1, 2], 60);
    await putPart(signed[0].url, Buffer.from('too-small'));
    await putPart(signed[1].url, Buffer.from('last'));
    const parts = await storage.listParts(key, uploadId);

    await expect(
      storage.completeMultipartUpload(key, uploadId, parts),
    ).rejects.toBeInstanceOf(StorageInvalidPartsError);

    await storage.abortMultipartUpload(key, uploadId);
  });

  it('signs public URLs for S3_PUBLIC_ENDPOINT and internal ones for S3_ENDPOINT', async () => {
    const cfg = storageConfig();
    const signer = new StorageService(
      testStorageConfig({ publicEndpoint: 'http://public.example:9000' }),
    );

    const publicUrl = await signer.presignGetObject('k', {
      ttlSeconds: 60,
      audience: 'public',
    });
    const internalUrl = await signer.presignGetObject('k', {
      ttlSeconds: 60,
      audience: 'internal',
    });
    const [part] = await signer.presignUploadParts('k', 'upload-id', [1], 60);

    expect(new URL(publicUrl).host).toBe('public.example:9000');
    expect(new URL(part.url).host).toBe('public.example:9000');
    expect(new URL(internalUrl).host).toBe(new URL(cfg.endpoint).host);
    signer.onModuleDestroy();
  });
});
