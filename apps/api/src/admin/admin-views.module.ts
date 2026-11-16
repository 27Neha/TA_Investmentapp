import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminViewsController } from './admin-views.controller';

@Module({ imports: [AuthModule], controllers: [AdminViewsController] })
export class AdminViewsModule {}
