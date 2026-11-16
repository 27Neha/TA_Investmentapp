import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './common/config';

async function bootstrap() {
  const cfg = loadConfig(); // fails fast on unsafe production config
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: cfg.corsOrigins, credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(cfg.port);
  new Logger('Bootstrap').log(`API listening on :${cfg.port} (${cfg.nodeEnv})`);
}
bootstrap();
