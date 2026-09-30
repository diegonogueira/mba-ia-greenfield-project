import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage, queue and video keys', () => {
  it.each(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])(
    'should require %s',
    (key) => {
      const env: Record<string, string | undefined> = { ...requiredEnv };
      delete env[key];
      const { error } = envValidationSchema.validate(env, {
        allowUnknown: true,
        abortEarly: false,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    },
  );

  it('should apply the documented defaults', () => {
    const { value, error } = validate({}) as {
      value: Record<string, unknown>;
      error?: Error;
    };
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'streamtube-media',
      S3_FORCE_PATH_STYLE: 'true',
      REDIS_HOST: 'redis',
      REDIS_PORT: 6379,
      QUEUE_PREFIX: 'bull',
      VIDEO_UPLOAD_PART_SIZE_BYTES: 67108864,
      VIDEO_UPLOAD_URL_TTL_SECONDS: 3600,
      VIDEO_PLAYBACK_URL_TTL_SECONDS: 21600,
      VIDEO_WORKER_CONCURRENCY: 1,
    });
  });

  it('should reject a part size below the 5 MiB S3 minimum', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '1048576' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_UPLOAD_PART_SIZE_BYTES');
  });

  it('should accept exactly 5 MiB as part size', () => {
    const { error } = validate({ VIDEO_UPLOAD_PART_SIZE_BYTES: '5242880' });
    expect(error).toBeUndefined();
  });

  it('should reject a worker concurrency of 0', () => {
    const { error } = validate({ VIDEO_WORKER_CONCURRENCY: '0' });
    expect(error).toBeDefined();
  });
});
