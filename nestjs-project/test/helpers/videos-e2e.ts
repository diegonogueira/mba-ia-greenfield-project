import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { Channel } from '../../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { User } from '../../src/users/entities/user.entity';

export const MIB = 1024 * 1024;

/** Queue prefix used by E2E tests so the running video-worker container never consumes their jobs. */
export const TEST_QUEUE_PREFIX = 'bull-test';

/**
 * Env overrides applied before AppModule boots: presigned URLs are signed for
 * the in-network MinIO host (the test process cannot reach the host's
 * localhost:9000) and jobs go to an isolated queue prefix.
 */
export function applyVideoTestEnv(
  overrides: Record<string, string> = {},
): void {
  process.env.S3_PUBLIC_ENDPOINT =
    process.env.S3_ENDPOINT ?? 'http://minio:9000';
  process.env.QUEUE_PREFIX = TEST_QUEUE_PREFIX;
  Object.assign(process.env, overrides);
}

export async function createVideosTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) =>
    b,
  extraImports: any[] = [],
): Promise<INestApplication<App>> {
  const moduleFixture = await customize(
    Test.createTestingModule({ imports: [AppModule, ...extraImports] }),
  ).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

export function clearThrottler(app: INestApplication): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
}

export interface TestUser {
  user: User;
  channel: Channel;
  accessToken: string;
}

/** Creates a confirmed user with a channel and logs in through POST /auth/login. */
export async function createLoggedUser(
  app: INestApplication<App>,
): Promise<TestUser> {
  const dataSource = app.get(DataSource);
  const suffix = randomBytes(4).toString('hex');
  const email = `video_${suffix}@example.com`;
  const password = 'password123';

  const user = await dataSource.getRepository(User).save({
    email,
    password: await argon2.hash(password),
    is_confirmed: true,
  });
  const channel = await dataSource.getRepository(Channel).save({
    name: `video${suffix}`,
    nickname: `video_${suffix}`,
    user_id: user.id,
  });

  clearThrottler(app);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return { user, channel, accessToken: res.body.access_token as string };
}

export async function putPart(url: string, body: Buffer): Promise<Response> {
  return fetch(url, { method: 'PUT', body: new Uint8Array(body) });
}
