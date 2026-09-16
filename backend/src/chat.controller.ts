import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LlmService } from './llm.service';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';
import { IngredientMappingService, MaterialInput, IngredientRule } from './ingredient-mapping.service';
import { AccessLogService } from './access-log.service';
import { RagSearchService, LegalSource } from './rag-search.service';
import { AgentHarnessService, InjectionMode } from './agent-harness.service';
import { RouterMethod } from './tool-router.service';

/**
 * 상담 보조 챗봇 (Epic #3 · T5 #37).
 *
 * 흐름: 라우팅(카테고리) → 도구 스키마 주입 → LLM tool_calls → 하네스가 MCP 실행 → 재호출 → 최종 답변.
 * - `mode`: 'prefill'(A, 사전 주입 — 기본) | 'discover'(B, list_tools 동적 발견)
 * - `router`: 'embedding'(기본) | 'llm'
 * - 응답에 `routing`·`trace`를 추가한다(하위호환: answer·notices·llm·sources·top1·customerContext 유지).
 * - LLM 비활성/하네스 실패 시 기존과 동일하게 **근거 조문 나열 폴백**으로 우아하게 내려간다.
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mapping: IngredientMappingService,
    private readonly accessLog: AccessLogService,
    private readonly rag: RagSearchService,
    private readonly harness: AgentHarnessService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('chat')
  async chat(
    @Body()
    body: {
      question?: string;
      customerId?: string;
      mode?: InjectionMode;
      router?: RouterMethod;
    },
    @Req() req: { user?: { email?: string; role?: string } },
  ) {
    const question = body?.question ?? '';
    if (!question) return { error: 'question이 필요합니다.' };

    const mode: InjectionMode = body?.mode === 'discover' ? 'discover' : 'prefill';
    const routerMethod: RouterMethod = body?.router === 'llm' ? 'llm' : 'embedding';

    // 고객 컨텍스트 개인화(이슈 #18): customerId가 있으면 고객 정보를 별도 블록으로 주입한다.
    // 고객이 없거나 조회 실패하면 일반 답변으로 우아하게 폴백한다(사유를 notices에 표기).
    let customerContext: string | undefined;
    let customerName: string | undefined;
    const noticesPre: string[] = [];
    if (body?.customerId) {
      const row = await this.prisma.customer.findUnique({
        where: { id: body.customerId },
        include: { ingredients: true, intakeProducts: true },
      });
      if (!row) {
        noticesPre.push('⚠️ 지정한 고객을 찾을 수 없어 일반 답변으로 처리합니다.');
      } else {
        await this.accessLog.record(req.user ?? {}, row.id).catch(() => undefined);
        customerName = row.name ?? '';

        const rules = await this.prisma.ingredient.findMany({ orderBy: { createdAt: 'asc' } });
        const ruleList: IngredientRule[] = rules.map((r) => ({ id: r.id, name: r.name, synonyms: r.synonyms, keywords: r.keywords }));
        const inputs: MaterialInput[] = [
          ...row.intakeProducts.map((p) => ({
            productName: p.productName,
            rawMaterialText: p.rawMaterials,
            source: 'intake_product' as const,
          })),
          ...row.ingredients.map((m) => ({
            productName: null,
            rawMaterialText: m.ingredientName,
            source: 'manual_ingredient' as const,
          })),
        ];
        const mapping = this.mapping.mapMaterials(inputs, ruleList);
        const coveredNames = mapping.matches.map((m) => m.ingredientName);
        const interestRows = await this.prisma.customerInterest.findMany({
          where: { customerId: row.id },
          include: { ingredient: true },
          orderBy: { ingredient: { createdAt: 'asc' } },
        });
        const interestNames = interestRows.map((r) => r.ingredient.name);

        // 고객 UUID를 컨텍스트에 포함한다 — 도구가 customer_id를 요구하므로 담당자가 고른 고객의 ID를 그대로 쓴다.
        const lines: string[] = [`고객명: ${customerName}`, `고객 ID: ${row.id}`];
        if (row.intakeProducts.length > 0) {
          lines.push('섭취 제품: ' + row.intakeProducts.map((p) => p.productName).join(', '));
        }
        if (interestNames.length > 0) {
          lines.push(`관심 성분: ${interestNames.join(', ')} (커버: ${coveredNames.join(', ') || '없음'})`);
        }
        const gapNames = interestNames.filter((n) => !coveredNames.includes(n));
        if (gapNames.length > 0) {
          lines.push(`성분 갭(미커버): ${gapNames.join(', ')}`);
        }
        customerContext = lines.join('\n');
        noticesPre.push('ℹ️ 고객 컨텍스트 적용: ' + customerName);
      }
    }

    const notices: string[] = [];
    let answer: string;
    let sources = 0;
    let top1 = 0;
    let routing: unknown = null;
    let trace: unknown[] = [];
    let llmEcho: { provider?: string; model?: string } | null = null;

    const status = this.llm.check();

    if (status.active) {
      // 하네스 루프 — 도구 라우팅·주입·실행·재호출.
      const run = await this.harness.run({
        question,
        customerContext,
        mode,
        router: routerMethod,
        actor: req.user,
      });
      routing = run.routing;
      trace = run.trace;

      if (run.legal) {
        sources = run.legal.count;
        top1 = run.legal.top1;
      }

      if (run.answer) {
        answer = run.answer;
        llmEcho = { provider: status.provider, model: status.model };
        notices.push(...run.notices);
      } else {
        // 하네스가 답변하지 못함 → 법령 질의면 근거 조문 나열, 그 외는 짧은 실패 안내.
        // (배송 질의에 무관한 법령 조문을 붙이면 사용자를 오도한다.)
        notices.push(...run.notices);
        const legalRoute = Boolean(run.legal) || Boolean(run.routing?.picked?.includes('법령·기능성'));
        if (legalRoute) {
          const rows = await this.rag.searchLegalProvisions(question, 5);
          answer = this.renderEvidence(question, rows);
          if (rows.length > 0) {
            sources = rows.length;
            top1 = Number(rows[0].score);
          }
          notices.push(`⚠️ ${run.reason ?? '도구 호출을 완료하지 못했습니다'} — 근거 조문 나열로 대응합니다.`);
        } else {
          answer =
            `도구 조회로 답변을 완성하지 못했습니다. ${run.reason ?? ''}`.trim() +
            ' 잠시 후 다시 시도하거나 질문을 더 구체적으로 알려주세요.';
          notices.push(`⚠️ ${run.reason ?? '도구 호출을 완료하지 못했습니다'}`);
        }
      }
    } else {
      // LLM 비활성 — 기존과 동일하게 근거 조문 나열(도구 호출 불가).
      const rows = await this.rag.searchLegalProvisions(question, 5);
      answer = this.renderEvidence(question, rows);
      sources = rows.length;
      top1 = rows[0] ? Number(rows[0].score) : 0;
      notices.push(`⚠️ ${status.reason} — 근거 조문 나열로 대응합니다.`);
    }

    return {
      answer,
      notices: [...noticesPre, ...notices],
      llm: llmEcho,
      sources,
      top1,
      customerContext: customerName
        ? { applied: true, customerId: body?.customerId, customerName }
        : { applied: false },
      // Epic #3 — 도구 라우팅·호출 추적(웹 UI의 추적 패널이 소비).
      mode,
      routing,
      trace,
    };
  }

  /** 근거 조문 나열 폴백 — LLM 비활성/하네스 실패 시 사용. */
  private renderEvidence(question: string, rows: LegalSource[]): string {
    const lines: string[] = [`**질문**: ${question}`, '', '**근거 조문**'];
    rows.forEach((r, i) => {
      const no = String(r.article_no).replace(/^제/, '');
      const title = r.article_title ? `(${r.article_title})` : '';
      lines.push(`[${i + 1}] ${r.law_name} ${no}${title} — 유사도 ${Number(r.score).toFixed(3)}`);
      lines.push(`    ${r.content.slice(0, 200).replace(/\n/g, ' ')}…`);
    });
    lines.push('');
    lines.push(
      '**출처(각주)**: ' +
        rows.map((r, i) => `[${i + 1}] ${r.law_name} ${String(r.article_no).replace(/^제/, '')}`).join('; '),
    );
    return lines.join('\n');
  }
}
