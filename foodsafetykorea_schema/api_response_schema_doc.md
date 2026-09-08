
---

- I-0040

|key|description|
|--|--|
|HF_FNCLTY_MTRAL_RCOGN_NO|인정번호|
|PRMS_DT|인정일자|
|BSSH_NM|업체명|
|INDUTY_NM|업종|
|ADDR|주소|
|APLC_RAWMTRL_NM|신청원료명|
|FNCLTY_CN|기능성 내용|
|DAY_INTK_CN|1일 섭취량|
|IFTKN_ATNT_MATR_CN|섭취시 주의사항|

---

- I-0050

|key|description|
|--|--|
|HF_FNCLTY_MTRAL_RCOGN_NO|원료인정번호|
|DAY_INTK_HIGHLIMIT|1일 섭취량 상한선|
|DAY_INTK_LOWLIMIT|1일 섭취량 하한선|
|WT_UNIT|중량 단위|
|RAWMTRL_NM|원재료 명|
|IFTKN_ATNT_MATR_CN|섭취시 주의 사항 내용|
|PRIMARY_FNCLTY|주된 기능성|

---

- I0030

|key|description|
|--|--|
|LCNS_NO|인허가번호|
|BSSH_NM|업소_명|
|PRDLST_REPORT_NO|품목제조번호|
|PRDLST_NM|품목_명|
|PRMS_DT|허가_일자|
|POG_DAYCNT|소비기한_일수|
|DISPOS|제품형태|
|NTK_MTHD|섭취방법|
|PRIMARY_FNCLTY|주된기능성|
|IFTKN_ATNT_MATR_CN|섭취시주의사항|
|CSTDY_MTHD|보관방법|
|PRDLST_CDNM|유형|
|STDR_STND|기준규격|
|HIENG_LNTRT_DVS_NM|고열량저영양여부|
|PRODUCTION|생산종료여부|
|CHILD_CRTFC_YN|어린이기호식품품질인증여부|
|PRDT_SHAP_CD_NM|제품_형태_코드_명|
|FRMLC_MTRQLT|포장재질|
|RAWMTRL_NM|품목유형(기능지표성분)|
|INDUTY_CD_NM|업종|
|LAST_UPDT_DTM|최종수정일자|
|INDIV_RAWMTRL_NM|기능성 원재료|
|ETC_RAWMTRL_NM|기타 원재료|
|CAP_RAWMTRL_NM|캡슐 원재료|
|FRMLC_MTHD|포장방법|
|FRMLC_MTRQLT|포장재질|

---

- C003

|key|description|
|--|--|
|LCNS_NO|인허가번호|
|BSSH_NM|업소명|
|PRDLST_REPORT_NO|품목제조번호|
|PRDLST_NM|품목명|
|PRMS_DT|보고일자|
|POG_DAYCNT|소비기한|
|DISPOS|성상|
|NTK_MTHD|섭취방법|
|PRIMARY_FNCLTY|주된기능성|
|IFTKN_ATNT_MATR_CN|섭취시주의사항|
|CSTDY_MTHD|보관방법|
|SHAP|형태|
|STDR_STND|기준규격|
|RAWMTRL_NM|원재료|
|CRET_DTM|최초생성일시|
|LAST_UPDT_DTM|최종수정일시|
|PRDT_SHAP_CD_NM|제품형태|

---

- 공통 응답 코드

api 응답에서 "RESULT" 객체 안의 값 (모든 API 동일)
```json
{
	"RESULT": {
		"MSG": "정상처리되었습니다.",
		"CODE": "INFO-000"
	}
}
```

|CODE|MSG|
|--|--|
|INFO-000|정상 처리되었습니다.|
|INFO-100|인증키가 유효하지 않습니다. 인증키가 없는 경우, 홈페이지에서 인증키를 신청하십시오.|
|INFO-110|인증키는 확인되었으나 해당 서비스의 활용신청 내역이 없습니다. 홈페이지에서 활용신청 후 이용하십시오.|
|INFO-120|서비스 신청상태가 유효하지 않습니다. 홈페이지에서 서비스신청상태를 확인해주세요.|
|INFO-200|해당하는 데이터가 없습니다.|
|INFO-300|유효 호출건수를 이미 초과하셨습니다.|
|INFO-310|샘플키로 더 이상 호출할 수 없습니다. 이용신청을 해주십시오.|
|INFO-320|증분 파라미터를 사용하지 않으면 1시간당 100회까지만 호출할 수 있습니다.|
|INFO-330|파일 다운로드는 인증키당 서비스별로 1일 10회까지 가능합니다.|
|INFO-400|권한이 없습니다. 관리자에게 문의하십시오.|
|INFO-500|현재 접속 중인 인증키입니다. 잠시 후에 다시 시도하십시오.|
|INFO-600|인증키가 만료되었습니다.|
|INFO-700|오늘날짜에 생성 및 변경된 데이터는 19시 이후에 호출이 가능합니다.|
|ERROR-300|필수 값이 누락되어 있습니다. 요청인자를 참고 하십시오.|
|ERROR-301|파일타입 값이 누락 혹은 유효하지 않습니다. 요청인자 중 TYPE을 확인하십시오.|
|ERROR-302|요청인자의 값 형식이 올바르지 않습니다. 날짜조건은 YYYYMMDD 8자리 단일값으로 입력하십시오.|
|ERROR-303|호출일자 기준 최대 7일까지 증분 데이터만 호출할 수 있습니다.|
|ERROR-310|해당하는 서비스를 찾을 수 없습니다. 요청인자 중 SERVICE를 확인하십시오.|
|ERROR-331|요청시작위치 값을 확인하십시오. 요청인자 중 START_INDEX를 확인하십시오.|
|ERROR-332|요청종료위치 값을 확인하십시오. 요청인자 중 END_INDEX를 확인하십시오.|
|ERROR-334|종료위치보다 시작위치가 더 큽니다. 요청시작조회건수는 정수를 입력하세요.|
|ERROR-336|데이터요청은 한번에 최대 1000건을 넘을 수 없습니다.|
|ERROR-500|서버오류입니다.|
|ERROR-503|09시~19시에는 서비스가 제한됩니다. 이용에 참고바랍니다.|
|ERROR-601|SQL 문장 오류입니다.|

---

## ⚠️ 호출 제한 사항 (운영 시 반드시 준수)

- **ERROR-503**: 식품안전나라 openapi(`http://openapi.foodsafetykorea.go.kr/api`)는 **KST 09:00 ~ 19:00에 호출이 차단**된다.
  → 수집/증분 갱신 잡은 **KST 19:00 이후 ~ 09:00 전**에 실행할 것. (cron 등 예약 실행 시 KST 기준 19시 이후 스케줄 권장)
- **INFO-700**: 오늘 생성/변경된 데이터는 **19시 이후**에만 조회 가능.
- **ERROR-303**: 증분 파라미터는 호출일 기준 최대 7일까지만 지원.
- **ERROR-336**: 1회 요청 최대 1,000건. 페이징(START/END_INDEX)으로 분할 호출할 것.
- **INFO-320**: 증분 파라미터 미사용 시 시간당 100회 제한.

> 운영 요약: 총량(total_count) 확인 → 19시 이후 증분 구간(최대 7일)만 호출 → 1,000건 단위 페이징.
