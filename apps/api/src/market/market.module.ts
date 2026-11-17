import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentController } from '../content/content.controller';
import { ExploreController, MarketController, WatchlistController } from './explore.controller';
import { INDEX_PROVIDER, UnconfiguredIndexProvider } from './index.provider';
import { MarketDataProvider } from './market.provider';

@Module({
  imports: [AuthModule],
  controllers: [ExploreController, WatchlistController, MarketController, ContentController],
  providers: [MarketDataProvider, { provide: INDEX_PROVIDER, useClass: UnconfiguredIndexProvider }],
  exports: [MarketDataProvider, INDEX_PROVIDER],
})
export class MarketModule {}
