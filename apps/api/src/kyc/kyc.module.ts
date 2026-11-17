import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { KYC_PROVIDER, UnconfiguredKycProvider } from '../integrations/kyc/kyc.port';
import { KycAdminController, KycController, KycWebhookController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [AuthModule, FlagsModule],
  controllers: [KycController, KycAdminController, KycWebhookController],
  providers: [KycService, { provide: KYC_PROVIDER, useClass: UnconfiguredKycProvider }], // fails closed until a verified adapter exists
})
export class KycModule {}
