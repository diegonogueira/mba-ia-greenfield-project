import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { usePublicEndpointInsideNetwork } from '../test/storage';
import {
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../test/video-fixtures';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const MIB = 1024 * 1024;

describe('VideosService (integration — DB + MinIO)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let storage: StorageService;

  beforeAll(async () => {
    usePublicEndpointInsideNetwork();
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(5 * MIB);
    const db = databaseConfig();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig],
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
        VideosModule,
      ],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('createDraft', () => {
    it('persists the draft and opens a real multipart upload', async () => {
      const { user, channel } = await createUserWithChannel(dataSource);

      const res = await service.createDraft(user.id, {
        title: 'Clip',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 12 * MIB,
      });

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: res.id });
      expect(row).toMatchObject({
        status: VideoStatus.DRAFT,
        channel_id: channel.id,
        video_key: `videos/${res.id}/original`,
        slug: res.slug,
      });
      expect(row.upload_id).toBeTruthy();
      expect(res.upload.partCount).toBe(3);
      await expect(
        storage.listParts(row.video_key, row.upload_id!),
      ).resolves.toEqual([]);
      await storage.abortMultipartUpload(row.video_key, row.upload_id!);
    });
  });
});
