import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health.controller';
import { AuthController } from './auth.controller';
import { ChatController } from './chat.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [HealthController, AuthController, ChatController],
})
export class AppModule {}
