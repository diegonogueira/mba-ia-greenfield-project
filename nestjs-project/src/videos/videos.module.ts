import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosRepository } from './videos.repository';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    ChannelsModule,
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosRepository, VideosService],
  exports: [VideosRepository, VideosService],
})
export class VideosModule {}
