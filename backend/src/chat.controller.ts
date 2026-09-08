import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from './prisma.service';
import { Pool } from 'pg';

/** 최소 기능 챗봇: 법령 RAG(pgvector) 근거 응답. 기능성 구조화 조회는 MCP 도구로 분기. */
@Controller('chat')
export class ChatController {
  private pg: pgPool | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private pool() {
    if (!this.pg) {
      const url = process.env.DATABASE_URL ?? 'postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind';
      this.pg = new (require('pg').Pool)({ connectionString: url });
    }
    return this.pg;
  }

  @UseGuards(JwtAuthGuard)
  @Post('chat')
  async chat(@Body() body: { question?: string }) {
    const question = body?.question ?? '';
    if (!question) return { error: 'question이 필요합니다.' };

    // 1) 질문 임베딩 (Ollama)
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

    // 3) 근거 조문 합성 + 각주 출처
    const rows = res.rows as Array<{
      law_name: string; article_no: string; article_title: string | null; content: string; score: number;
    }>;
    const lines: string[] = [`**질문**: ${question}`, '', '**근거 조문**'];
    rows.forEach((r, i) => {
      const no = String(r.article_no).replace(/^제/, '');
      const title = r.article_title ? `(${r.article_title})` : '';
      lines.push(`[${i + 1}] ${r.law_name} ${no}${title} — 유사도 ${Number(r.score).toFixed(3)}`);
      lines.push(`    ${r.content.slice(0, 200).replace(/\n/g, ' ')}…`);
    });
    lines.push('');
    lines.push('**출처(각주)**: ' + rows.map((r, i) =>
      `[${i + 1}] ${r.law_name} ${String(r.article_no).replace(/^제/, '')}`).join('; '));
    const top1 = rows[0] ? Number(rows[0].score) : 0;
    lines.push(`_(검색 지표) top1 유사도: ${top1.toFixed(4)}, 근거 수: ${rows.length}_`);

    return { answer: lines.join('\n'), sources: rows.length, top1: top1 };
  }
}

interface pgPool { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> }
