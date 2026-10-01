import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { bullRootModule } from '../queue/bull-root.module';
import { VideoProcessingModule } from '../video-processing/video-processing.module';
import { VIDEO_TEST_ENTITIES } from './video-fixtures';

/** Worker module graph for integration tests, on an isolated queue prefix. */
export async function createWorkerTestModule(
  queuePrefix: string,
): Promise<TestingModule> {
  process.env.QUEUE_PREFIX = queuePrefix;
  const db = databaseConfig();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, videoConfig, queueConfig],
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.name,
        entities: VIDEO_TEST_ENTITIES,
        synchronize: false,
      }),
      bullRootModule(),
      VideoProcessingModule,
    ],
  }).compile();
}
