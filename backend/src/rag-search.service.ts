import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

/** 근거 조문 검색 결과 — 법령 RAG(pgvector) 공용 스냅샷. */
export interface LegalSource {
  law_name: string;
  law_type: string;
  article_no: string;
  article_title: string | null;
  content: string;
  score: number;
}

/**
 * 법령 RAG 공용 검색 서비스 — 질의 텍스트를 Ollama로 임베딩해 pgvector에서 근거 조문을 검색한다.
 * 챗봇(chat.controller)과 마케팅 문구 검증(marketing.controller)이 함께 사용한다.
 */
@Injectable()
export class RagSearchService {
  private pg: Pool | null = null;

  private pool(): Pool {
    if (!this.pg) {
      const url =
        process.env.DATABASE_URL ??
        'postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind';
      this.pg = new Pool({ connectionString: url });
    }
    return this.pg;
  }

  /** 질문 임베딩(Ollama qwen3-embedding) + pgvector 검색(기본 top 5). */
  async searchLegalProvisions(question: string, k = 5): Promise<LegalSource[]> {
    const ollama = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
    const model = process.env.EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b';
    const embRes = await fetch(`${ollama}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: question }),
    });
    const emb = (await embRes.json()) as { embeddings: number[][] };
    const vec = emb.embeddings[0];

    const res = await this.pool().query(
      `SELECT law_name, law_type, article_no, article_title, content,
              1 - (embedding <=> $1::vector) AS score
       FROM legal_provisions
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT $2`,
      [`[${vec.map((x) => x.toFixed(6)).join(',')}]`, k],
    );
    return res.rows as LegalSource[];
  }
}