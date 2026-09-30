import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import {
  StorageInvalidPartsError,
  StorageUploadNotFoundError,
} from './storage.errors';
import type {
  PresignGetOptions,
  SignedPart,
  UploadedPart,
} from './storage.types';

const INVALID_PARTS_ERROR_NAMES = new Set([
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
]);

function buildClient(
  cfg: ConfigType<typeof storageConfig>,
  endpoint: string,
): S3Client {
  return new S3Client({
    endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Presigned URLs are called by third-party clients: never require SDK checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  /** Talks to the storage inside the Docker network (S3_ENDPOINT). */
  private readonly internalClient: S3Client;
  /** Only signs URLs handed to clients outside the network (S3_PUBLIC_ENDPOINT). */
  private readonly publicSigner: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    cfg: ConfigType<typeof storageConfig>,
  ) {
    this.internalClient = buildClient(cfg, cfg.endpoint);
    this.publicSigner = buildClient(cfg, cfg.publicEndpoint);
    this.bucket = cfg.bucket;
  }

  onModuleDestroy(): void {
    this.internalClient.destroy();
    this.publicSigner.destroy();
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const res = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) {
      throw new Error('Storage did not return an UploadId');
    }
    return res.UploadId;
  }

  async presignUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
    ttlSeconds: number,
  ): Promise<SignedPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicSigner,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: ttlSeconds },
        ),
      })),
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    try {
      do {
        const res = await this.internalClient.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        );
        for (const part of res.Parts ?? []) {
          parts.push({
            partNumber: part.PartNumber ?? 0,
            etag: part.ETag ?? '',
            sizeBytes: part.Size ?? 0,
          });
        }
        marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
      } while (marker);
    } catch (err) {
      throw this.translate(err);
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    try {
      await this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      );
    } catch (err) {
      throw this.translate(err);
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (err) {
      throw this.translate(err);
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Returns the object's size and type, or `null` when the key does not exist. */
  async headObject(
    key: string,
  ): Promise<{ sizeBytes: number; contentType?: string } | null> {
    try {
      const res = await this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType,
      };
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async presignGetObject(
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    const client =
      options.audience === 'public' ? this.publicSigner : this.internalClient;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.downloadFileName
          ? contentDisposition(options.downloadFileName)
          : undefined,
      }),
      { expiresIn: options.ttlSeconds },
    );
  }

  private translate(err: unknown): unknown {
    if (err instanceof S3ServiceException) {
      if (err.name === 'NoSuchUpload') {
        return new StorageUploadNotFoundError(err.message);
      }
      if (INVALID_PARTS_ERROR_NAMES.has(err.name)) {
        return new StorageInvalidPartsError(err.message);
      }
    }
    return err;
  }
}
