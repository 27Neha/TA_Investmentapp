import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentController } from '../content/content.controller';
import { ExploreController } from './explore.controller';
import { MarketDataProvider } from './market.provider';

@Module({ imports: [AuthModule], controllers: [ExploreController, ContentController], providers: [MarketDataProvider], exports: [MarketDataProvider] })
export class MarketModule {}
