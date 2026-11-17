import { Module } from '@nestjs/common';
import { EmailService } from './email.provider';

@Module({ providers: [EmailService], exports: [EmailService] })
export class NotificationsModule {}
