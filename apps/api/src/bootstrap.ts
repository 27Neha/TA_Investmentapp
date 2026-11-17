import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from './common/config';

/** Shared by main.ts and the integration tests so tests exercise the real pipeline. */
export function configureApp(app: NestExpressApplication, cfg: AppConfig) {
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: cfg.corsOrigins, credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
}
