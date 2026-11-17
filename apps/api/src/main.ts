import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { assertProductionRuntime, loadConfig } from './common/config';
import { loadLocalEnv } from './common/load-env';

async function bootstrap() {
  loadLocalEnv(); // dev convenience only: skipped in production, never overrides existing env vars
  const cfg = loadConfig(); // fails fast on unsafe production config
  assertProductionRuntime();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app, cfg);
  await app.listen(cfg.port);
  new Logger('Bootstrap').log(`API listening on :${cfg.port} (${cfg.nodeEnv})`);
}
bootstrap();
