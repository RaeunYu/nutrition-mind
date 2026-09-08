### 고시기능성 API는 공식적으로 공개된 API가 아님. 식품안전나라 홈페이지에 공개된 `기능성원료(고시)` 메뉴에서 Chrome DevTools로 확인된 네트워크 요청을 분석하여 리스트를 불러오는 API를 확인했음.
- 요청 인자 중 `show_cnt` 파라미터의 범위 제한은 없는것으로 추정됨.
	- 응답 body의 `total_cnt`가 61로 확인되지만, `show_cnt`를 70으로 요청해도, 61개 항목 반환
- 고시기능성 원료는 식약처에서 자체적으로 공표하는 원료들이므로, 추가되는 주기가 상당히 느리고, 그 빈도도 많지 않음.

---
- https://www.foodsafetykorea.go.kr/portal/healthyfoodlife/searchMtral.do?start_idx=1&show_cnt=5
```json
{
    "total_cnt": 61,
    "list": [
		// 첫번째 원소 `"no": "61"`인 element는 다른 element들과 형태가 다른 이유를 알 수 없음.
        {
            "cd_nm": "구아바잎 추출물",
            "no": "61",
            "mtral_hrnk_cd": "00100030",
            "mtral_cd": "00202540",
            "hrnk_cd_nm": "페놀류"
        },
        {
            "cd_nm": "구아바잎 추출물",
            "no": "60",
            "mtral_hrnk_cd": "00100030",
            "mtral_cd": "00202540",
            "hrnk_cd_nm": "페놀류",
            "file_dvs_1": "1",
            "atch_file_no_1": "5547",
            "file_type_cd_1": "pdf",
            "file_path_1": "/upload/20141126",
            "logic_file_nm_1": "2-11_구아바잎_추출물.pdf",
            "physic_file_nm_1": "20141126050949_1416989389073.pdf",
            "file_mg_1": "96695",
            "file_dvs_2": "2",
            "atch_file_no_2": "5548",
            "file_type_cd_2": "jpg",
            "file_path_2": "/upload/20141126",
            "logic_file_nm_2": "구아바잎추출물.jpg",
            "physic_file_nm_2": "20141126050949_1416989389100.jpg",
            "file_mg_2": "107846"
        },
        {
            "cd_nm": "달맞이꽃종자추출물",
            "no": "59",
            "mtral_hrnk_cd": "00100030",
            "mtral_cd": "00202530",
            "hrnk_cd_nm": "페놀류",
            "file_dvs_1": "1",
            "atch_file_no_1": "5545",
            "file_type_cd_1": "pdf",
            "file_path_1": "/upload/20141126",
            "logic_file_nm_1": "2-15_달맞이꽃종자_추출물.pdf",
            "physic_file_nm_1": "20141126050929_1416989369867.pdf",
            "file_mg_1": "109662",
            "file_dvs_2": "2",
            "atch_file_no_2": "5546",
            "file_type_cd_2": "jpg",
            "file_path_2": "/upload/20141126",
            "logic_file_nm_2": "달맞이꽃_종자추출물.jpg",
            "physic_file_nm_2": "20141126050929_1416989369897.jpg",
            "file_mg_2": "110043"
        },
        {
            "cd_nm": "바나바잎추출물",
            "no": "58",
            "mtral_hrnk_cd": "00100030",
            "mtral_cd": "00202520",
            "hrnk_cd_nm": "페놀류",
            "file_dvs_1": "1",
            "atch_file_no_1": "5543",
            "file_type_cd_1": "pdf",
            "file_path_1": "/upload/20141126",
            "logic_file_nm_1": "2-12_바나나잎_추출물1.pdf",
            "physic_file_nm_1": "20141126050904_1416989344365.pdf",
            "file_mg_1": "100591",
            "file_dvs_2": "2",
            "atch_file_no_2": "5544",
            "file_type_cd_2": "jpg",
            "file_path_2": "/upload/20141126",
            "logic_file_nm_2": "바나바잎추출물.jpg",
            "physic_file_nm_2": "20141126050904_1416989344402.jpg",
            "file_mg_2": "107639"
        },
        {
            "cd_nm": "은행잎추출물",
            "no": "57",
            "mtral_hrnk_cd": "00100030",
            "mtral_cd": "00202510",
            "hrnk_cd_nm": "페놀류",
            "file_dvs_1": "1",
            "atch_file_no_1": "5541",
            "file_type_cd_1": "pdf",
            "file_path_1": "/upload/20141126",
            "logic_file_nm_1": "2-13_은행잎_추출물.pdf",
            "physic_file_nm_1": "20141126050843_1416989323752.pdf",
            "file_mg_1": "121083",
            "file_dvs_2": "2",
            "atch_file_no_2": "5542",
            "file_type_cd_2": "jpg",
            "file_path_2": "/upload/20141126",
            "logic_file_nm_2": "은행잎추출물.jpg",
            "physic_file_nm_2": "20141126050843_1416989323784.jpg",
            "file_mg_2": "427728"
        }
    ]
}
```
