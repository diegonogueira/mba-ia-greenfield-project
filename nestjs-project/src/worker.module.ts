import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configFactories } from './config/config.factories';
import { envValidationSchema } from './config/env.validation';
import { typeOrmRootModule } from './database/typeorm-root.module';
import { bullRootModule } from './queue/bull-root.module';
import { UsersModule } from './users/users.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

/**
 * Root module of the video worker process (`src/worker.ts`). It is the only
 * module graph that imports the queue processor — the API never consumes jobs.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configFactories,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    typeOrmRootModule(),
    bullRootModule(),
    // Registers the User entity: Channel (loaded with every video) relates to it.
    UsersModule,
    VideoProcessingModule,
  ],
})
export class WorkerModule {}
