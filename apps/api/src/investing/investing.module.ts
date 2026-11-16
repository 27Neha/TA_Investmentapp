import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { MeModule } from '../me/me.module';
import { InvestingGate } from './investing-gate.service';
import { InvestingController } from './investing.controller';
import { INVESTMENT_PROVIDER, UnconfiguredInvestmentProvider } from './investment-provider';
import { LifecycleService } from './lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ProviderWebhookController } from './provider-webhook.controller';
import { TRANSACTION_PROVIDER, UnconfiguredProvider } from './transaction.provider';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [AuthModule, MeModule, FlagsModule],
  controllers: [InvestingController, TransactionsController, OrdersController, ProviderWebhookController],
  providers: [
    { provide: TRANSACTION_PROVIDER, useClass: UnconfiguredProvider },
    { provide: INVESTMENT_PROVIDER, useClass: UnconfiguredInvestmentProvider }, // fails closed until a verified provider adapter is supplied
    InvestingGate, LifecycleService, OrdersService,
  ],
  exports: [LifecycleService],
})
export class InvestingModule {}
