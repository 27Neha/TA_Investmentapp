import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, loadConfig } from './common/config';
import { ConsentController } from './consent/consent.controller';
import { FlagsModule } from './flags/flags.module';
import { HealthController } from './health/health.controller';
import { GoalsModule } from './goals/goals.module';
import { SupportModule } from './support/support.module';
import { KycModule } from './kyc/kyc.module';
import { InvestingModule } from './investing/investing.module';
import { AccountModule } from './account/account.controller';
import { LearnModule } from './learn/learn.module';
import { FamilyModule } from './family/family.module';
import { InboxModule } from './inbox/inbox.module';
import { RiskModule } from './risk/risk.module';
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
    InvestingModule,
    KycModule,
    SupportModule,
    InboxModule,
    RiskModule,
    FamilyModule,
    LearnModule,
    AccountModule,
  ],
  controllers: [HealthController, ConsentController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
