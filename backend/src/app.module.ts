import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health.controller';
import { AuthController } from './auth.controller';
import { ChatController } from './chat.controller';
import { CustomersController } from './customers.controller';
import { IngredientsController } from './ingredients.controller';
import { ProductsController } from './products.controller';
import { AdminController } from './admin.controller';
import { MarketingController } from './marketing.controller';
import { PrismaModule } from './prisma.module';
import { LlmService } from './llm.service';
import { ProductsService } from './products.service';
import { CryptoService } from './crypto.service';
import { AccessLogService } from './access-log.service';
import { IngredientMappingService } from './ingredient-mapping.service';
import { RecommendationService } from './recommendation.service';
import { RagSearchService } from './rag-search.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [HealthController, AuthController, ChatController, CustomersController, IngredientsController, ProductsController, AdminController, MarketingController],
  providers: [LlmService, ProductsService, CryptoService, AccessLogService, IngredientMappingService, RecommendationService, RagSearchService],
})
export class AppModule {}
