import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InboxController } from './inbox.controller';
import { AuditService, InboxService } from './inbox.service';

@Global()
@Module({ imports: [AuthModule], controllers: [InboxController], providers: [InboxService, AuditService], exports: [InboxService, AuditService] })
export class InboxModule {}
