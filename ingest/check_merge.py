"""결함 회귀 루프: fixture(건기법 API 응답)를 law_collector.iter_articles에 통과시켜
병합 정합성을 검증한다. RED = 항·호 본문 누락 / 조문 덮어쓰기.
사용: python check_merge.py [collector.py 경로]
"""
import json, os, sys, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "law_fixture.json")  # 건강기능식품에 관한 법률 (MST=259283, efYd=20250103)
spec = importlib.util.spec_from_file_location("law_collector", sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "law_collector.py"))
lc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lc)

with open(FIXTURE) as f:
    law = json.load(f)["법령"]

arts = list(lc.iter_articles(law))
by_no = {}
fails = []
def check(name, cond, detail):
    if cond:
        print(f"  ✅ {name}")
    else:
        fails.append(name)
        print(f"  ❌ {name}\n     {detail}")

def find(no):
    for a in arts:
        if a["article_no"] == no:
            return a
    return None

# 1) 조문 수: 조문여부=조문 단위 62개 전부 산출(전문·부칙 제외)
n_units = sum(1 for u in law["조문"]["조문단위"] if u.get("조문여부") == "조문")
n_buchim = len((law.get("부칙") or {}).get("부칙단위") or [])
n_law = sum(1 for a in arts if not a["article_no"].startswith("부칙"))
n_bu = sum(1 for a in arts if a["article_no"].startswith("부칙"))
check(f"조문 단위 수 보존({n_units})", n_law == n_units, f"산출 {n_law} != API 조문단위 {n_units} (덮어쓰기 소실)")
check(f"부칙 단위 수 보존({n_buchim})", n_bu == n_buchim, f"산출 {n_bu} != API 부칙단위 {n_buchim}")

# 2) 제5조: 항·호 본문 병합 확인
a5 = find("5")
ok = a5 and "①" in a5["content"] and "허가를 받아야 한다" in a5["content"] and "시설기준을 갖추지 못한 경우" in a5["content"]
check("제5조 항(①~⑥)+호 본문 포함", ok, repr((a5 or {}).get("content", ""))[:200])
check("제5조 article_title 유지", a5 and a5["article_title"] == "영업의 허가 등", repr((a5 or {}).get("article_title")))

# 3) 제3조(단일 항·호 축소형): 호 본문 포함
a3 = find("3")
ok = a3 and "\"건강기능식품\"이란" in a3["content"] and "맞춤형건강기능식품" in a3["content"]
check("제3조 호 본문(단일항 축소형) 포함", ok, repr((a3 or {}).get("content", ""))[:200])

# 4) 가지번호 조문 보존: 제10조/의2/의3 모두 별개 행
a10, a10b, a10c = find("10"), find("10의2"), find("10의3")
check("제10조/의2/의3 개별 보존", all(x and x["content"] for x in (a10, a10b, a10c)),
      f"의2={bool(a10b)} 의3={bool(a10c)}")

# 5) 전문(장/절 제목) 단위는 조문 행으로 저장하지 않음
bad = [a for a in arts if a["content"].startswith("제1장") or a["content"].startswith("제4장")]
check("전문(장/절 제목) 행 없음", not bad, f"{len(bad)}개 장/절 제목 행")

# 6) 부칙 content에 Python list repr 잔존 없음
bu_repr = [a for a in arts if a["article_no"].startswith("부칙") and a["content"].lstrip().startswith("[")]
check("부칙 list repr 없음", not bu_repr, f"{len(bu_repr)}행 repr 잔존")

# 7) 중복 article_no 없음 (덮어쓰기 원천 차단)
dups = {n for n in (a["article_no"] for a in arts) if list(x["article_no"] for x in arts).count(n) > 1}
check("중복 article_no 없음", not dups, str(dups))

print()
if fails:
    print(f"❌ RED — 실패 {len(fails)}건: {fails}")
    sys.exit(1)
print("✅ GREEN — 병합 정합성 통과")
