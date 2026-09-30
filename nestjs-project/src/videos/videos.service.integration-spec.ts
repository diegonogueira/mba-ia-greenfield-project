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
import { putPart } from '../test/storage';
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

  describe('upload session (resume)', () => {
    it('lists uploaded parts and re-signs a URL that accepts the missing part', async () => {
      const { user } = await createUserWithChannel(dataSource);
      const draft = await service.createDraft(user.id, {
        title: 'Resume',
        fileName: 'resume.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 12 * MIB,
      });
      const part1 = Buffer.alloc(5 * MIB, 1);
      await putPart(draft.upload.parts[0].url, part1);

      const session = await service.getUploadSession(draft.slug, user.id);
      expect(session.uploadedParts).toEqual([
        { partNumber: 1, sizeBytes: part1.length },
      ]);

      const resigned = await service.signUploadParts(draft.slug, user.id, [2]);
      const res = await putPart(resigned.parts[0].url, Buffer.alloc(5 * MIB, 2));
      expect(res.status).toBe(200);

      const after = await service.getUploadSession(draft.slug, user.id);
      expect(after.uploadedParts.map((p) => p.partNumber)).toEqual([1, 2]);

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: draft.id });
      await storage.abortMultipartUpload(row.video_key, row.upload_id!);
    });
  });
});
