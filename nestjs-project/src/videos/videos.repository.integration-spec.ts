import { DataSource } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  buildVideo,
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../test/video-fixtures';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';
import { VideosRepository } from './videos.repository';

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: VideosRepository;

  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES, {
      synchronize: false,
    });
    await dataSource.initialize();
    repository = new VideosRepository(dataSource.getRepository(Video));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('finds a video by slug with its channel loaded', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = await repository.insert(buildVideo(channel.id));

    const found = await repository.findBySlug(video.slug);

    expect(found?.id).toBe(video.id);
    expect(found?.channel.user_id).toBe(channel.user_id);
  });

  it('returns null for an unknown slug', async () => {
    expect(await repository.findBySlug('unknownslug')).toBeNull();
  });

  it('transitions only from the expected status and applies the patch', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = await repository.insert(buildVideo(channel.id));

    const changed = await repository.transitionStatus(
      video.id,
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      { upload_id: null },
    );

    const saved = await repository.findById(video.id);
    expect(changed).toBe(true);
    expect(saved?.status).toBe(VideoStatus.PROCESSING);
    expect(saved?.upload_id).toBeNull();
  });

  it('does not change a row that is not in the expected status', async () => {
    const { channel } = await createUserWithChannel(dataSource);
    const video = await repository.insert(buildVideo(channel.id));

    const changed = await repository.transitionStatus(
      video.id,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
    );

    const saved = await repository.findById(video.id);
    expect(changed).toBe(false);
    expect(saved?.status).toBe(VideoStatus.DRAFT);
  });
});
