import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { MeModule } from '../me/me.module';
import { InvestingController } from './investing.controller';
import { TRANSACTION_PROVIDER, UnconfiguredProvider } from './transaction.provider';

@Module({ imports: [AuthModule, MeModule, FlagsModule], controllers: [InvestingController], providers: [{ provide: TRANSACTION_PROVIDER, useClass: UnconfiguredProvider }] })
export class InvestingModule {}
