import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  buildVideo,
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../../test/video-fixtures';
import { VideoStatus } from '../videos.constants';
import { Video } from './video.entity';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES, {
      synchronize: false,
    });
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('defaults status to draft', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const withoutStatus = buildVideo(channel.id);
    delete withoutStatus.status;
    await videoRepository.insert(withoutStatus);

    const saved = await videoRepository.findOneByOrFail({
      id: withoutStatus.id,
    });
    expect(saved.status).toBe(VideoStatus.DRAFT);
  });

  it('rejects a duplicate slug', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    await videoRepository.save(buildVideo(channel.id, { slug: 'AAAAAAAAAAA' }));

    await expect(
      videoRepository.save(buildVideo(channel.id, { slug: 'AAAAAAAAAAA' })),
    ).rejects.toThrow(QueryFailedError);
  });

  it('rejects a status outside the enum', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = buildVideo(channel.id);
    await videoRepository.save(video);

    await expect(
      dataSource.query(
        `UPDATE "videos" SET "status" = 'published' WHERE id = $1`,
        [video.id],
      ),
    ).rejects.toThrow(QueryFailedError);
  });

  it('round-trips sizes above 2^31 and numeric durations as numbers', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = buildVideo(channel.id, {
      size_bytes: 10737418240,
      duration_seconds: 12.345,
    });
    await videoRepository.save(video);

    const saved = await videoRepository.findOneByOrFail({ id: video.id });
    expect(saved.size_bytes).toBe(10737418240);
    expect(saved.duration_seconds).toBe(12.345);
  });

  it('deletes the videos of a deleted channel (ON DELETE CASCADE)', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = buildVideo(channel.id);
    await videoRepository.save(video);

    await dataSource.getRepository(Channel).delete(channel.id);

    expect(await videoRepository.findOneBy({ id: video.id })).toBeNull();
  });
});
