import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { MeModule } from '../me/me.module';
import { InvestingGate } from './investing-gate.service';
import { InvestingController } from './investing.controller';
import { INVESTMENT_PROVIDER, UnconfiguredInvestmentProvider } from './investment-provider';
import { createSchemeRiskometer, SCHEME_RISKOMETER } from './scheme-riskometer';
import { SuitabilityController } from './suitability.controller';
import { SuitabilityService } from './suitability.service';
import { LifecycleService } from './lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ProviderWebhookController } from './provider-webhook.controller';
import { TRANSACTION_PROVIDER, UnconfiguredProvider } from './transaction.provider';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [AuthModule, MeModule, FlagsModule],
  controllers: [SuitabilityController, InvestingController, TransactionsController, OrdersController, ProviderWebhookController],
  providers: [
    { provide: TRANSACTION_PROVIDER, useClass: UnconfiguredProvider },
    { provide: INVESTMENT_PROVIDER, useClass: UnconfiguredInvestmentProvider }, // fails closed until a verified provider adapter is supplied
    { provide: SCHEME_RISKOMETER, useFactory: () => createSchemeRiskometer(process.env, process.env.NODE_ENV === 'production') },
    SuitabilityService, InvestingGate, LifecycleService, OrdersService,
  ],
  exports: [LifecycleService, SuitabilityService],
})
export class InvestingModule {}
