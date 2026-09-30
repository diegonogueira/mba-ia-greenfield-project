import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { bullRootModule } from '../queue/bull-root.module';
import { VIDEO_TEST_ENTITIES } from '../test/video-fixtures';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('compiles with BullModule, StorageModule and ChannelsModule wired', async () => {
    const db = databaseConfig();
    const module = await Test.createTestingModule({
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
        VideosModule,
      ],
    }).compile();

    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await module.close();
  });
});
