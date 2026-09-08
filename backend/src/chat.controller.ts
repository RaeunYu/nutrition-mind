import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LlmService } from './llm.service';
import { Pool } from 'pg';

/** 최소 기능 챗봇: 법령 RAG(pgvector) 근거 + LLM 합성(선택, 폴백 지원). */
@Controller('chat')
export class ChatController {
  private pg: Pool | null = null;

  constructor(private readonly llm: LlmService) {}

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
  async chat(@Body() body: { question?: string }) {
    const question = body?.question ?? '';
    if (!question) return { error: 'question이 필요합니다.' };

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
      notices,           // LLM 상태 안내(비활성/실패 사유)
      llm: llm.ok ? { provider: llm.provider, model: llm.model } : null,
      sources: rows.length,
      top1,
    };
  }
}
