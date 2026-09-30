import { QueryFailedError } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  ChannelNotFoundException,
  InvalidPartNumberException,
  UploadIncompleteException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoUploadNotActiveException,
} from '../common/exceptions/domain.exception';
import type { CreateVideoDto } from './dto/create-video.dto';
import { Video } from './entities/video.entity';
import {
  StorageInvalidPartsError,
  StorageUploadNotFoundError,
} from '../storage/storage.errors';
import { VideoStatus } from './videos.constants';
import { computePartCount, VideosService } from './videos.service';

const MIB = 1024 * 1024;
const PART_SIZE = 64 * MIB;
const TEN_GIB = 10 * 1024 * MIB;

const videoCfg = {
  uploadPartSizeBytes: PART_SIZE,
  uploadUrlTtlSeconds: 3600,
  playbackUrlTtlSeconds: 21600,
  workerConcurrency: 1,
};

function makeChannel(): Channel {
  return Object.assign(new Channel(), {
    id: 'channel-1',
    nickname: 'owner',
    user_id: 'user-1',
  });
}

function makeSlugConflict(): QueryFailedError {
  const err = new QueryFailedError('INSERT', [], new Error('dup')) as any;
  err.code = '23505';
  err.detail = 'Key (slug)=(abc) already exists.';
  return err;
}

const dto: CreateVideoDto = {
  title: 'Holiday',
  fileName: 'holiday.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 100 * MIB,
};

function setup() {
  const manager = { query: jest.fn().mockResolvedValue(undefined) };
  const videosRepository = {
    findBySlug: jest.fn(),
    findById: jest.fn(),
    transitionStatus: jest.fn().mockResolvedValue(true),
    insert: jest.fn(
      async (data: Partial<Video>) => Object.assign(new Video(), data) as Video,
    ),
  };
  const channelsService = {
    findByUserId: jest.fn().mockResolvedValue(makeChannel()),
  };
  const storage = {
    createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    listParts: jest.fn().mockResolvedValue([]),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    headObject: jest.fn().mockResolvedValue(null),
    presignGetObject: jest.fn().mockResolvedValue('https://signed'),
    presignUploadParts: jest.fn(
      async (_k: string, _u: string, parts: number[]) =>
        parts.map((partNumber) => ({ partNumber, url: `u${partNumber}` })),
    ),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
  const service = new VideosService(
    videosRepository as any,
    channelsService as any,
    storage as any,
    dataSource as any,
    videoCfg,
    queue as any,
  );
  return { service, manager, videosRepository, channelsService, storage, queue };
}

describe('computePartCount', () => {
  it.each([
    [1, 1],
    [PART_SIZE, 1],
    [PART_SIZE + 1, 2],
    [TEN_GIB, 160],
  ])('size %d → %d parts of 64 MiB', (size, expected) => {
    expect(computePartCount(size, PART_SIZE)).toBe(expected);
  });
});

describe('VideosService.createDraft', () => {
  it('creates a draft in the caller channel and signs every part', async () => {
    const { service, videosRepository, storage } = setup();

    const res = await service.createDraft('user-1', dto);

    const inserted = videosRepository.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      channel_id: 'channel-1',
      status: VideoStatus.DRAFT,
      upload_id: 'upload-1',
      size_bytes: dto.sizeBytes,
      video_key: `videos/${inserted.id}/original`,
    });
    expect(inserted.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      `videos/${inserted.id}/original`,
      'video/mp4',
    );
    expect(res.status).toBe(VideoStatus.DRAFT);
    expect(res.upload.partCount).toBe(2);
    expect(res.upload.parts.map((p) => p.partNumber)).toEqual([1, 2]);
  });

  it('opens 160 part URLs for a 10 GiB file', async () => {
    const { service } = setup();

    const res = await service.createDraft('user-1', {
      ...dto,
      sizeBytes: TEN_GIB,
    });

    expect(res.upload.partSize).toBe(PART_SIZE);
    expect(res.upload.parts).toHaveLength(160);
  });

  it('throws CHANNEL_NOT_FOUND when the user has no channel', async () => {
    const { service, channelsService, storage } = setup();
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(service.createDraft('user-1', dto)).rejects.toBeInstanceOf(
      ChannelNotFoundException,
    );
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('regenerates the slug on a unique violation inside a savepoint', async () => {
    const { service, videosRepository, manager } = setup();
    videosRepository.insert.mockRejectedValueOnce(makeSlugConflict());

    await service.createDraft('user-1', dto);

    const [first, second] = videosRepository.insert.mock.calls.map(
      (c) => c[0].slug,
    );
    expect(videosRepository.insert).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
    expect(manager.query).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT video_slug_1',
    );
  });

  it('aborts the multipart upload when the row cannot be inserted', async () => {
    const { service, videosRepository, storage } = setup();
    videosRepository.insert.mockRejectedValue(new Error('db down'));

    await expect(service.createDraft('user-1', dto)).rejects.toThrow('db down');
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/.+\/original$/),
      'upload-1',
    );
  });
});

function makeVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'video-1',
    slug: 'slug0000001',
    status: VideoStatus.DRAFT,
    size_bytes: 3 * PART_SIZE,
    video_key: 'videos/video-1/original',
    upload_id: 'upload-1',
    channel: makeChannel(),
    ...overrides,
  });
}

describe('VideosService upload session', () => {
  it('lists the parts already held by the storage', async () => {
    const { service, videosRepository, storage } = setup();
    videosRepository.findBySlug.mockResolvedValue(makeVideo());
    storage.listParts.mockResolvedValue([
      { partNumber: 1, etag: '"e1"', sizeBytes: PART_SIZE },
    ]);

    const res = await service.getUploadSession('slug0000001', 'user-1');

    expect(res).toEqual({
      partSize: PART_SIZE,
      partCount: 3,
      uploadedParts: [{ partNumber: 1, sizeBytes: PART_SIZE }],
    });
  });

  it('hides the session from a non-owner (VIDEO_NOT_FOUND)', async () => {
    const { service, videosRepository } = setup();
    videosRepository.findBySlug.mockResolvedValue(makeVideo());

    await expect(
      service.getUploadSession('slug0000001', 'someone-else'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('reports an unknown slug as VIDEO_NOT_FOUND', async () => {
    const { service, videosRepository } = setup();
    videosRepository.findBySlug.mockResolvedValue(null);

    await expect(
      service.signUploadParts('unknown', 'user-1', [1]),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('rejects session calls once the video left draft (VIDEO_UPLOAD_NOT_ACTIVE)', async () => {
    const { service, videosRepository } = setup();
    videosRepository.findBySlug.mockResolvedValue(
      makeVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
    );

    await expect(
      service.signUploadParts('slug0000001', 'user-1', [1]),
    ).rejects.toBeInstanceOf(VideoUploadNotActiveException);
  });

  it('rejects part numbers above the part count (INVALID_PART_NUMBER)', async () => {
    const { service, videosRepository, storage } = setup();
    videosRepository.findBySlug.mockResolvedValue(makeVideo());

    await expect(
      service.signUploadParts('slug0000001', 'user-1', [2, 4]),
    ).rejects.toBeInstanceOf(InvalidPartNumberException);
    expect(storage.presignUploadParts).not.toHaveBeenCalled();
  });

  it('signs only the requested parts', async () => {
    const { service, videosRepository } = setup();
    videosRepository.findBySlug.mockResolvedValue(makeVideo());

    const res = await service.signUploadParts('slug0000001', 'user-1', [2, 3]);

    expect(res.parts.map((p) => p.partNumber)).toEqual([2, 3]);
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('VideosService.completeUpload', () => {
  const fullParts = [
    { partNumber: 1, etag: '"1"', sizeBytes: PART_SIZE },
    { partNumber: 2, etag: '"2"', sizeBytes: PART_SIZE },
    { partNumber: 3, etag: '"3"', sizeBytes: PART_SIZE },
  ];

  function ready() {
    const ctx = setup();
    const video = makeVideo();
    ctx.videosRepository.findBySlug.mockResolvedValue(video);
    ctx.videosRepository.findById.mockResolvedValue(
      makeVideo({ status: VideoStatus.PROCESSING, upload_id: null }),
    );
    ctx.storage.listParts.mockResolvedValue(fullParts);
    return { ...ctx, video };
  }

  it('completes the storage upload, moves to processing and enqueues the job', async () => {
    const { service, storage, videosRepository, queue } = ready();

    const res = await service.completeUpload('slug0000001', 'user-1');

    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/original',
      'upload-1',
      fullParts,
    );
    expect(videosRepository.transitionStatus).toHaveBeenCalledWith(
      'video-1',
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      { upload_id: null },
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { videoId: 'video-1' },
      expect.objectContaining({ jobId: 'video-1', attempts: 3 }),
    );
    expect(res.status).toBe(VideoStatus.PROCESSING);
  });

  it.each([
    ['a missing part', fullParts.slice(0, 2)],
    [
      'sizes that do not add up to the declared size',
      [...fullParts.slice(0, 2), { partNumber: 3, etag: '"3"', sizeBytes: 1 }],
    ],
    [
      'an unexpected extra part',
      [...fullParts, { partNumber: 4, etag: '"4"', sizeBytes: 1 }],
    ],
  ])('rejects %s with UPLOAD_INCOMPLETE', async (_label, parts) => {
    const { service, storage, queue } = ready();
    storage.listParts.mockResolvedValue(parts);

    await expect(
      service.completeUpload('slug0000001', 'user-1'),
    ).rejects.toBeInstanceOf(UploadIncompleteException);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('maps a part set rejected by the storage to UPLOAD_INCOMPLETE', async () => {
    const { service, storage } = ready();
    storage.completeMultipartUpload.mockRejectedValue(
      new StorageInvalidPartsError(),
    );

    await expect(
      service.completeUpload('slug0000001', 'user-1'),
    ).rejects.toBeInstanceOf(UploadIncompleteException);
  });

  it('accepts a retry after the storage upload was already completed', async () => {
    const { service, storage, queue } = ready();
    storage.listParts.mockRejectedValue(new StorageUploadNotFoundError());
    storage.headObject.mockResolvedValue({ sizeBytes: 3 * PART_SIZE });

    await service.completeUpload('slug0000001', 'user-1');

    expect(queue.add).toHaveBeenCalled();
  });

  it('reports VIDEO_UPLOAD_NOT_ACTIVE when the status changed concurrently', async () => {
    const { service, videosRepository, queue } = ready();
    videosRepository.transitionStatus.mockResolvedValue(false);

    await expect(
      service.completeUpload('slug0000001', 'user-1'),
    ).rejects.toBeInstanceOf(VideoUploadNotActiveException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('commits processing before enqueueing (a fast worker must not see draft)', async () => {
    const { service, videosRepository, queue } = ready();
    const order: string[] = [];
    videosRepository.transitionStatus.mockImplementation(async () => {
      order.push('status');
      return true;
    });
    queue.add.mockImplementation(async () => {
      order.push('enqueue');
      return { id: 'job' };
    });

    await service.completeUpload('slug0000001', 'user-1');

    expect(order).toEqual(['status', 'enqueue']);
  });

  it('moves the video back to draft when the enqueue fails, then rethrows', async () => {
    const { service, videosRepository, queue } = ready();
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(
      service.completeUpload('slug0000001', 'user-1'),
    ).rejects.toThrow('redis down');
    expect(videosRepository.transitionStatus).toHaveBeenLastCalledWith(
      'video-1',
      VideoStatus.PROCESSING,
      VideoStatus.DRAFT,
      { upload_id: 'upload-1' },
    );
  });
});

describe('VideosService reads (visibility)', () => {
  const owner = { sub: 'user-1', email: 'o@example.com' };
  const stranger = { sub: 'user-2', email: 's@example.com' };
  const statuses = Object.values(VideoStatus);

  function withVideo(status: VideoStatus) {
    const ctx = setup();
    ctx.videosRepository.findBySlug.mockResolvedValue(
      makeVideo({
        status,
        original_filename: 'holiday.mp4',
        thumbnail_key: status === VideoStatus.READY ? 'thumbnails/video-1.jpg' : null,
      }),
    );
    return ctx;
  }

  it.each(statuses)('owner sees a %s video', async (status) => {
    const { service } = withVideo(status);
    await expect(service.getVideo('slug0000001', owner)).resolves.toMatchObject({
      status,
    });
  });

  it.each(statuses.filter((s) => s !== VideoStatus.READY))(
    'anonymous and non-owner get VIDEO_NOT_FOUND for a %s video',
    async (status) => {
      const { service } = withVideo(status);
      await expect(service.getVideo('slug0000001')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
      await expect(
        service.getVideo('slug0000001', stranger),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    },
  );

  it('anyone sees a ready video', async () => {
    const { service } = withVideo(VideoStatus.READY);
    await expect(service.getVideo('slug0000001')).resolves.toMatchObject({
      status: VideoStatus.READY,
    });
  });

  it('owner gets VIDEO_NOT_READY when streaming a processing video', async () => {
    const { service } = withVideo(VideoStatus.PROCESSING);
    await expect(
      service.getPlaybackUrl('slug0000001', owner, 'stream'),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
  });

  it('signs an inline URL for streaming and an attachment for download', async () => {
    const { service, storage } = withVideo(VideoStatus.READY);

    await service.getPlaybackUrl('slug0000001', undefined, 'stream');
    await service.getPlaybackUrl('slug0000001', undefined, 'download');

    expect(storage.presignGetObject).toHaveBeenNthCalledWith(
      1,
      'videos/video-1/original',
      { ttlSeconds: 21600, audience: 'public', downloadFileName: undefined },
    );
    expect(storage.presignGetObject).toHaveBeenNthCalledWith(
      2,
      'videos/video-1/original',
      { ttlSeconds: 21600, audience: 'public', downloadFileName: 'holiday.mp4' },
    );
  });

  it('signs the thumbnail key for a ready video', async () => {
    const { service, storage } = withVideo(VideoStatus.READY);

    await service.getThumbnailUrl('slug0000001', undefined);

    expect(storage.presignGetObject).toHaveBeenCalledWith(
      'thumbnails/video-1.jpg',
      { ttlSeconds: 21600, audience: 'public' },
    );
  });
});
