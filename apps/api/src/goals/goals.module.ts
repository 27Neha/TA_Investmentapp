import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { HomeController } from '../home/home.controller';
import { MeModule } from '../me/me.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({ imports: [AuthModule, MeModule, FlagsModule], controllers: [GoalsController, HomeController], providers: [GoalsService], exports: [GoalsService] })
export class GoalsModule {}
