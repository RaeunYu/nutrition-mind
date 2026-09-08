import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('chat')
export class ChatController {
  /** 최소 기능 챗봇 스텁. Task #4에서 LangGraph 6단계 파이프라인(법령 RAG·각주 출처·평가 지표)으로 교체. */
  @UseGuards(JwtAuthGuard)
  @Post('chat')
  async chat(@Body() body: { question?: string }) {
    const question = body?.question ?? '';
    return {
      answer:
        `[스텁 응답] "${question}"에 대한 법령 RAG 파이프라인은 Task #4에서 구현됩니다.\n` +
        '계획: 질문 이해/의도 분류 → 도구 선택/라우팅 → 법령 RAG 검색 → 기능성 구조화 조회 → 결과 합성 → 출처 표기 및 응답',
    };
  }
}
