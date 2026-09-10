import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { RagSearchService } from './rag-search.service';
import { LlmService } from './llm.service';

/**
 * 마케팅 담당자 API — 표시·광고 문구 검증 (이슈 #19).
 *
 * 흐름: 문구 입력 → 표시기준·법령 RAG 근거 검색(pgvector) → LLM 판정(허용/주의/금지)
 *       → 판정 + 근거 조문·출처 표기 반환.
 * 근거가 검색되지 않거나 판정할 수 없으면 판정 대신 사유를 명시한다(출처 없는 생성 금지).
 * 역할: 제품기획·마케팅 담당자 + 운영 확인을 위한 총관리자.
 */
@Controller('marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('marketing', 'admin')
export class MarketingController {
  constructor(
    private readonly rag: RagSearchService,
    private readonly llm: LlmService,
  ) {}

  @Post('copy-check')
  async copyCheck(@Body() body: { text?: string }) {
    const text = (body?.text ?? '').trim();
    if (!text) {
      return { verdict: 'undetermined', reason: '문구를 입력하세요.', citations: [], notices: [] };
    }
    if (text.length > 2000) {
      return { verdict: 'undetermined', reason: '문구는 2000자 이하로 입력하세요.', citations: [], notices: [] };
    }

    const sources = await this.rag.searchLegalProvisions(text, 5);
    if (sources.length === 0) {
      return {
        verdict: 'undetermined',
        reason: '관련 근거 조문이 검색되지 않아 판정을 보류합니다.',
        citations: [],
        notices: ['근거 검색 결과 0건 — 판정 보류(출처 없는 생성 금지)'],
      };
    }

    const verdict = await this.llm.judgeAdvertisement(text, sources);
    if (!verdict.ok) {
      return {
        verdict: 'undetermined',
        reason: `판정 실패 — ${verdict.reason ?? 'LLM 호출 실패'}. 근거 조문은 아래와 같습니다.`,
        citations: sources.map((s) => ({
          law_name: s.law_name,
          law_type: s.law_type,
          article_no: s.article_no,
          excerpt: s.content.slice(0, 200),
        })),
        notices: ['⚠️ LLM 판정 실패 — 근거 조문 나열로 대응합니다(판정 보류).'],
      };
    }

    return {
      verdict: verdict.verdict,
      reason: verdict.reason,
      citations: sources.map((s) => ({
        law_name: s.law_name,
        law_type: s.law_type,
        article_no: s.article_no,
        excerpt: s.content.slice(0, 200),
      })),
      notices: [],
    };
  }
}