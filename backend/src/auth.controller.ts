import { Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 로그인(JWT): users 테이블 조회 + bcrypt 비밀번호 검증.
   * JWT에 역할(role) 클레임을 포함해 간소화 RBAC(roles.guard)가 사용한다.
   */
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body?.email ?? '';
    const password = body?.password ?? '';
    if (!email || !password) {
      return { ok: false, error: '이메일과 비밀번호를 입력하세요.' };
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return { ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.roleId,
    });
    return {
      ok: true,
      accessToken: token,
      email: user.email,
      role: user.roleId,
      roleLabel: user.role.label,
    };
  }
}