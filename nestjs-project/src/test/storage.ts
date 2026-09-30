import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';

/**
 * Storage config for tests running inside the Compose network: presigned
 * "public" URLs are signed for the in-network endpoint so the test process
 * (which cannot reach the host's localhost:9000) can call them.
 */
export function testStorageConfig(
  overrides: Partial<ConfigType<typeof storageConfig>> = {},
): ConfigType<typeof storageConfig> {
  const base = storageConfig();
  return { ...base, publicEndpoint: base.endpoint, ...overrides };
}

/** Makes `storageConfig()` resolve public URLs to the in-network endpoint. */
export function usePublicEndpointInsideNetwork(): void {
  process.env.S3_PUBLIC_ENDPOINT =
    process.env.S3_ENDPOINT ?? 'http://minio:9000';
}
