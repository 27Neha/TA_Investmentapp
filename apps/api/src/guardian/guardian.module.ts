import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GuardianController } from './guardian.controller';
import { GuardianService } from './guardian.service';

@Module({ imports: [AuthModule, FlagsModule, NotificationsModule], controllers: [GuardianController], providers: [GuardianService] })
export class GuardianModule {}
