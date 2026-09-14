"""Claude Desktop stdio 진입점 (이슈 #30) — Docker 없이 호스트에서 FastMCP를 stdio로 실행.

Claude Desktop(claude_desktop_config.json)의 mcpServers 항목에서
이 파일을 command로 지정하면 Claude Desktop이 서버 프로세스를 자체 실행하므로
네트워크 노출(SSE/HTTP)·헤더 인증이 불필요하다.

실행 절차(README 참조):
  cd mcp-server && uv venv && uv pip install -r requirements.txt
  → claude_desktop_config.json의 command를 .venv/bin/python으로 지정

.env(프로젝트 루트)에서 DATABASE_URL(호스트 5433)·OLLAMA_BASE_URL을 읽는다.
MCP_TOKEN은 stdio에서 미사용(HTTP 인증 미들웨어가 없는 경로).
"""
import os
import sys
from pathlib import Path

# .env 로드 — 프로젝트 루트(mcp-server의 상위)에서 DATABASE_URL(호스트 5433)·OLLAMA_BASE_URL을 읽는다
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# 호스트 실행: 기본값이 컨테이너 네트워크(db:5432·host.docker.internal)를 가리키므로
# .env에 값이 없으면 호스트 측 기본값으로 교체한다.
os.environ.setdefault("DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind")
os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")
# stdio는 HTTP 미들웨어를 통과하지 않으므로 토큰 불필요 — server.py import 시 참조만 되면 무해
os.environ.setdefault("MCP_TOKEN", "stdio-no-token")

# server.py에서 FastMCP 인스턴스를 가져온다(도구 4종 등록 포함).
# Starlette HTTP 앱 구성은 import 시 실행되지만 stdio 모드에서는 mcp.run()이 우선한다.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import mcp  # noqa: E402

if __name__ == "__main__":
    mcp.run(transport="stdio")