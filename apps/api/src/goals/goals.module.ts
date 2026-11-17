import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { HomeController } from '../home/home.controller';
import { RiskModule } from '../risk/risk.module';
import { MarketModule } from '../market/market.module';
import { MeModule } from '../me/me.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({ imports: [MarketModule, RiskModule, AuthModule, MeModule, FlagsModule], controllers: [GoalsController, HomeController], providers: [GoalsService], exports: [GoalsService] })
export class GoalsModule {}
