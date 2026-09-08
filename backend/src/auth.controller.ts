import { Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  /** 데모 기본 로그인(JWT). 사용자 테이블 연동은 Task #7에서 확장. */
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    const demoEmail = process.env.DEMO_USER_EMAIL ?? 'demo@example.com';
    const demoPassword = process.env.DEMO_USER_PASSWORD ?? 'demo1234';
    const email = body?.email ?? demoEmail;
    const password = body?.password ?? demoPassword;
    if (email !== demoEmail || password !== demoPassword) {
      return { ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    }
    const token = await this.jwt.signAsync({ sub: email, email });
    return { ok: true, accessToken: token, email };
  }
}
