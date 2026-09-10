import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LlmService } from './llm.service';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';
import { IngredientMappingService, MaterialInput, IngredientRule } from './ingredient-mapping.service';
import { AccessLogService } from './access-log.service';
import { Pool } from 'pg';

/** 상담 보조 챗봇: 법령 RAG(pgvector) 근거 + LLM 합성(선택, 폴백 지원) + 고객 컨텍스트 개인화(이슈 #18). */
@Controller('chat')
export class ChatController {
  private pg: Pool | null = null;

  constructor(
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mapping: IngredientMappingService,
    private readonly accessLog: AccessLogService,
  ) {}

  private pool() {
    if (!this.pg) {
      const url =
        process.env.DATABASE_URL ??
        'postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind';
      this.pg = new Pool({ connectionString: url });
    }
    return this.pg;
  }

  @UseGuards(JwtAuthGuard)
  @Post('chat')
  async chat(
    @Body() body: { question?: string; customerId?: string },
    @Req() req: { user?: { email?: string; role?: string } },
  ) {
    const question = body?.question ?? '';
    if (!question) return { error: 'question이 필요합니다.' };

    // 고객 컨텍스트 개인화(이슈 #18): customerId가 있으면 고객 정보를 근거와 별도 블록으로 주입.
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
        const coveredSet = new Set(mapping.matches.map((m) => m.ingredientId));
        const interestNames = interestRows.map((r) => r.ingredient.name);
        void coveredSet;

        const lines: string[] = [`고객명: ${customerName}`];
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

    // 1) 질문 임베딩 (Ollama — 임베딩은 항상 로컬)
    const ollama = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
    const model = process.env.EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b';
    const embRes = await fetch(`${ollama}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: question }),
    });
    const emb = (await embRes.json()) as { embeddings: number[][] };
    const vec = emb.embeddings[0];

    // 2) pgvector 검색 (top 5)
    const res = await this.pool().query(
      `SELECT law_name, law_type, article_no, article_title, content,
              1 - (embedding <=> $1::vector) AS score
       FROM legal_provisions
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT 5`,
      [`[${vec.map((x) => x.toFixed(6)).join(',')}]`],
    );
    const rows = res.rows as Array<{
      law_name: string;
      article_no: string;
      article_title: string | null;
      content: string;
      score: number;
    }>;

    // 3) 합성: LLM(선택) 성공 → 자연어 답변 / 실패·비활성 → 근거 나열 폴백
    const llm = await this.llm.synthesize(
      question,
      rows.map((r) => ({
        law_name: r.law_name,
        article_no: r.article_no,
        article_title: r.article_title,
        content: r.content,
      })),
      customerContext,
    );

    const notices: string[] = [];
    let answer: string;
    if (llm.ok && llm.answer) {
      answer = llm.answer;
    } else {
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
          rows
            .map((r, i) => `[${i + 1}] ${r.law_name} ${String(r.article_no).replace(/^제/, '')}`)
            .join('; '),
      );
      answer = lines.join('\n');
      if (llm.reason) notices.push(`⚠️ ${llm.reason} — 근거 조문 나열로 대응합니다.`);
    }

    const top1 = rows[0] ? Number(rows[0].score) : 0;
    return {
      answer,
      notices: [...noticesPre, ...notices], // 고객 컨텍스트 상태 + LLM 상태 안내
      llm: llm.ok ? { provider: llm.provider, model: llm.model } : null,
      sources: rows.length,
      top1,
      customerContext: customerName
        ? { applied: true, customerId: body?.customerId, customerName }
        : { applied: false },
    };
  }
}
