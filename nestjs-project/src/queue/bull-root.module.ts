import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';

/** Root BullMQ connection shared by the API (producer) and the worker (consumer). */
export function bullRootModule(): DynamicModule {
  return BullModule.forRootAsync({
    inject: [queueConfig.KEY],
    useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
      connection: { host: cfg.host, port: cfg.port },
      prefix: cfg.prefix,
    }),
  });
}
