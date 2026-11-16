import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, loadConfig } from './common/config';
import { ConsentController } from './consent/consent.controller';
import { FlagsModule } from './flags/flags.module';
import { HealthController } from './health/health.controller';
import { GoalsModule } from './goals/goals.module';
import { MarketModule } from './market/market.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { Global } from '@nestjs/common';

@Global()
@Module({ providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }], exports: [APP_CONFIG] })
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120, skipIf: () => process.env.THROTTLE_DISABLED === 'true' }]),
    PrismaModule,
    AuthModule,
    FlagsModule,
    ProvidersModule,
    MeModule,
    GoalsModule,
    MarketModule,
  ],
  controllers: [HealthController, ConsentController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
