import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import mailConfig from './mail.config';
import queueConfig from './queue.config';
import storageConfig from './storage.config';
import swaggerConfig from './swagger.config';
import videoConfig from './video.config';

/** Config namespaces loaded by both the API (`AppModule`) and the worker (`WorkerModule`). */
export const configFactories = [
  appConfig,
  authConfig,
  databaseConfig,
  mailConfig,
  swaggerConfig,
  storageConfig,
  queueConfig,
  videoConfig,
];
