import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessor } from './video.processor';

/** Imported only by `WorkerModule`: registering it in the API would make the API consume jobs. */
@Module({
  imports: [VideosModule, StorageModule],
  providers: [VideoProcessor, MediaProbeService],
})
export class VideoProcessingModule {}
