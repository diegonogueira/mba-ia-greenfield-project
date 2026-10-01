import type { DynamicModule } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';

/** Root TypeORM connection shared by the API and the worker. */
export function typeOrmRootModule(): DynamicModule {
  return TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [databaseConfig.KEY],
    useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
      type: 'postgres',
      host: dbConfig.host,
      port: dbConfig.port,
      username: dbConfig.username,
      password: dbConfig.password,
      database: dbConfig.name,
      autoLoadEntities: true,
      synchronize: false,
    }),
  });
}
