import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersController } from './providers.controller';

@Module({ imports: [AuthModule], controllers: [ProvidersController] })
export class ProvidersModule {}
