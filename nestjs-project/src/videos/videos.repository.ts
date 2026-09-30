import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoStatus } from './videos.constants';

export type VideoPatch = Partial<
  Pick<
    Video,
    | 'upload_id'
    | 'thumbnail_key'
    | 'duration_seconds'
    | 'metadata'
    | 'failure_reason'
    | 'processed_at'
    | 'size_bytes'
  >
>;

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video) private readonly repo: Repository<Video>,
  ) {}

  async insert(video: Partial<Video>, manager?: EntityManager): Promise<Video> {
    const repo = manager ? manager.getRepository(Video) : this.repo;
    return repo.save(repo.create(video));
  }

  async findBySlug(slug: string): Promise<Video | null> {
    return this.repo.findOne({ where: { slug }, relations: ['channel'] });
  }

  async findById(id: string): Promise<Video | null> {
    return this.repo.findOne({ where: { id }, relations: ['channel'] });
  }

  /**
   * Compare-and-set status transition: updates only when the row is still in
   * `from`. Returns whether a row changed.
   */
  async transitionStatus(
    id: string,
    from: VideoStatus,
    to: VideoStatus,
    patch: VideoPatch = {},
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(Video) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(Video)
      .set({ ...patch, status: to })
      .where('id = :id AND status = :from', { id, from })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
