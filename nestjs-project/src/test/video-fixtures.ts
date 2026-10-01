import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';

export const VIDEO_TEST_ENTITIES = [User, Channel, Video];

let counter = 0;

export async function createUserWithChannel(
  dataSource: DataSource,
): Promise<{ user: User; channel: Channel }> {
  const n = ++counter;
  const user = await dataSource.getRepository(User).save({
    email: `video_owner_${n}_${Date.now()}@example.com`,
    password: 'hashed',
    is_confirmed: true,
  });
  const channel = await dataSource.getRepository(Channel).save({
    name: `owner${n}`,
    nickname: `owner_${n}_${randomBytes(3).toString('hex')}`,
    user_id: user.id,
  });
  return { user, channel };
}

export function buildVideo(
  channelId: string,
  overrides: Partial<Video> = {},
): Partial<Video> {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    channel_id: channelId,
    slug: randomBytes(8).toString('base64url'),
    title: 'My video',
    status: VideoStatus.DRAFT,
    original_filename: 'clip.mp4',
    mime_type: 'video/mp4',
    size_bytes: 1024,
    video_key: `videos/${id}/original`,
    upload_id: 'upload-id',
    ...overrides,
  };
}
