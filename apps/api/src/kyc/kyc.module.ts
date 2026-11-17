import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { createKycProvider } from '../integrations/kyc/kyc.factory';
import { KYC_PROVIDER } from '../integrations/kyc/kyc.port';
import { KycAdminController, KycController, KycWebhookController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [AuthModule, FlagsModule],
  controllers: [KycController, KycAdminController, KycWebhookController],
  providers: [KycService, { provide: KYC_PROVIDER, useFactory: () => createKycProvider(process.env, process.env.NODE_ENV === 'production') }], // registry is empty: fails closed until a verified adapter is registered
})
export class KycModule {}
