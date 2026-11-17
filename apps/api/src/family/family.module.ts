import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoalsModule } from '../goals/goals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

@Module({ imports: [AuthModule, GoalsModule, NotificationsModule], controllers: [FamilyController], providers: [FamilyService] })
export class FamilyModule {}
