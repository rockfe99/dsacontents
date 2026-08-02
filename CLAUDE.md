# CLAUDE.md — 교육 콘텐츠 웹 뷰어 및 관리 시스템

> 이 파일은 Claude Code가 이 프로젝트의 맥락을 이해하기 위한 설계 문서다.
> 모든 코드 작업은 이 문서의 아키텍처·규칙을 따른다.

# 언어
- 모든 응답, 요약(recap), 다음 단계(Next) 문장을 반드시 한국어로 작성한다.
- 코드 주석과 커밋 메시지도 한국어로 작성한다.

---

## 프로젝트 개요

회사(DSA)의 교육 콘텐츠 관리 통합 플랫폼. Google Apps Script(GAS) 기반.
강사가 사내 공유 드라이브에 올린 강의 교안(PPT/구글슬라이드)을, 수강생이
**편집·다운로드 없이 목차와 함께 열람**하게 하고, 강사는 파일 배포·실시간 설문·
시험문제 생성을 손쉽게 수행하는 관리 도구를 제공한다. 별도로 취업/연수생 엑셀
데이터를 분석·보고서화하는 기능도 포함한다.

핵심 원칙: **최대한 간단하게.** 기존 LMS를 수정하는 부담 없이 구글 워크스페이스
자원을 최대한 활용해 가볍게 개발한다.

---

## 시스템 구조 (독립형 GAS 프로젝트 4개 + AI 서버 + 공유 데이터)

각 시스템은 **독립형(standalone) GAS 프로젝트**이며, 별도 폴더 = 별도 clasp 프로젝트다.
서로 데이터(DB 스프레드시트·JSON·Supabase)를 공유한다.

| 폴더 | 시스템 | 실행 권한 | 접근 | 역할 |
|---|---|---|---|---|
| `publish-engine` | 게시엔진 (라이브러리) | 관리자 권한 | — | 슬라이드ID 추출·자동공유·목차추출·JSON저장·DB기록. 다른 프로젝트의 유일한 데이터 계층 |
| `system-a-viewer` | 시스템 A 수강생 뷰어 | 관리자 | 모든 사용자(로그인 불필요) | 게시된 슬라이드를 목차와 함께 표시. 읽기 전용. `?k=키워드` 접속 |
| `system-b-dashboard` | 시스템 B 강사 대시보드 | 강사 본인 | 조직 내 | 파일 배포·실시간 설문·AI 기능. 게시 작업은 게시엔진에 위임 |
| `system-c-excel` | 시스템 C 엑셀 분석 (미착수) | 관리자·실무자 | 조직 내 | 엑셀 업로드→스프레드시트 변환, 통계·보고서 자동생성 |
| `ai-server` | AI 전용 API 서버 (Cloud Run, Python) | — | 시스템 B만 (X-API-Key) | 모든 AI 기능의 실제 처리. FastAPI + LangChain/LangGraph + OpenAI |

개발 순서: **게시엔진 → 시스템 A → 시스템 B → ai-server → 시스템 C**.
`system-c-excel`을 제외한 나머지는 구현·배포 완료. 자세한 내용은
["구현 현황"](#구현-현황) 참고.

---

## 핵심 동작 원리

### 배포 워크플로 (강사의 최소 작업)
1. 강사가 PPT를 공유 드라이브에 올림
2. "구글 슬라이드로 저장"
3. 슬라이드 편집화면 URL 복사
4. 시스템 B 대시보드에서 **키워드 + 제목 + URL** 입력 후 [배포]
5. 게시엔진이 자동 처리: URL에서 슬라이드ID 추출 → 슬라이드 공유 설정
   (링크 있는 사람 보기) → 목차 추출 → 목차데이터/키워드.json 저장 → DB 기록
   → 슬라이드 본문 텍스트를 Supabase에 저장(AI 기능용 원문)
6. 대시보드가 수강생용 링크(`시스템A URL + ?k=키워드`) 안내

### 불변 요구사항 (핵심)
- 뷰어 주소는 **`?k=키워드`로 영구 고정**. 게시판에 올려두면 학생이 클릭해 들어옴.
- 교안 수정 시: 강사가 **같은 키워드에 새 URL을 재등록**하면, 주소는 그대로 두고
  내용만 갱신됨. (키워드가 변하는 슬라이드ID와 고정 뷰어주소 사이의 다리)
- 뷰어 열람은 **코드 없이 항상 자유** (강사 없는 복습 대응).

### 보안 정책 — 사용자 입력 처리 (XSS 방지)
- `?k=키워드`는 사용자가 URL에 직접 넣는 값이라 신뢰할 수 없다. 화면(HTML/JS)에
  이 값을 그대로 반영(echo)하면 스크립트 삽입이 가능해진다.
- **키워드를 못 찾았을 때 에러 메시지에 키워드 원문을 절대 넣지 않는다.** 고정
  문구만 표시: `"아직 관리자가 강의를 배포하지 않았거나 존재하지 않는 키워드입니다."`
- 사용자 입력(쿼리 파라미터 등)을 화면에 표시해야 하는 그 밖의 모든 곳에서도,
  HTML에 넣기 전 반드시 이스케이프한다(`system-b-dashboard/Dashboard.html`의
  `esc()` 함수와 같은 패턴 재사용). `innerHTML`/`document.write`/템플릿 문자열에
  사용자 입력을 이스케이프 없이 바로 꽂지 않는다.
- 목차 JSON을 `<script>` 블록에 주입할 때는 `</script` 조기 종료 방지용으로
  `<`를 이스케이프한다(`system-a-viewer/Code.js`).
- **리다이렉트 서비스 계획**: 회사 서버에 `www.datasa.net?lect=키워드` 형태의 짧은
  URL을 받아 JS로 시스템 A 뷰어(`?k=키워드`)로 이동시키는 리다이렉트 페이지를
  추가할 예정. 이 페이지에서도 `lect` 파라미터 값을 `encodeURIComponent()`로
  인코딩해 `location.href` 구성 용도로만 쓰고, 화면 표시나 `eval`류 실행에는
  쓰지 않는다.

---

## 데이터 저장 (3원화)

| 데이터 | 위치 | 형식 |
|---|---|---|
| 교안 메타(키워드·URL·제목·시각) | DB 스프레드시트 | 셀(행 단위) |
| 목차(TOC)·요약 | 목차데이터 폴더 | `키워드.json` |
| 슬라이드 본문·설문 답변·AI 결과 캐시 | Supabase PostgreSQL | 테이블 (pgvector 포함) |

### 확보된 ID (스크립트 속성에 저장할 것 — 하드코딩 금지)
```
PARENT_FOLDER_ID = 1AwU4YgMjPcgW36IIXZl94gsLNtKJgP-6   (시스템 파일 저장 기본 폴더)
DB_SHEET_ID      = 1eSXtQL5dVi2BFymrUMI0NabuSb600mehKUDMRJBga5o   (DB 스프레드시트)
```

### 목차데이터 폴더
- 기본 폴더(`PARENT_FOLDER_ID`) 아래 **"목차데이터"** 폴더를 이름으로 찾고, 없으면 생성.
- 배포 시 그 안에 `키워드.json` 생성/갱신(덮어쓰기).
- 별도 ID 불필요 — 이름으로 조회/생성.

### DB 스프레드시트 구조
- 키워드가 고유 키. 배포 시 같은 키워드 행이 있으면 갱신, 없으면 추가.
- `목차JSON` 컬럼은 JSON 원문을 셀에 넣지 않고, 목차데이터 폴더에 저장된
  `키워드.json` 파일의 Drive 링크만 기록한다.
- **시트는 위치(첫 번째 탭)가 아니라 이름 `"강의목록"`으로 찾는다** — 시트 순서가
  바뀌어도 안전하도록 `getDbSheet_(dbSheetId)`(`publish-engine/Publish.js`)가
  `getSheetByName('강의목록')`으로 조회하고, 없으면 에러를 던진다. 시스템 B의
  `getLectureList()`도 같은 방식.
- **1행(헤더) 컬럼 구성:**

| 열 | 헤더명 | 내용 |
|---|---|---|
| A | 키워드 | 뷰어 주소(`?k=`) 고정용 고유 키 |
| B | 강의제목 | 강의 제목 |
| C | 슬라이드ID | 구글 슬라이드 파일 ID |
| D | 게시URL | 강사가 입력한 슬라이드 편집 URL(원본) |
| E | 목차JSON | 목차데이터 폴더의 `키워드.json` Drive 링크 |
| F | 최종수정 | 마지막 배포/수정 시각 |

- **헤더 문자열이 위 표와 달라도(오타·변경) 안전하게 동작한다**: 열 순서(A~F)는
  고정이라는 전제하에, `getDbColumnIndexes(headerRow)`(`publish-engine/Publish.js`
  공개 함수)가 이름으로 먼저 찾고 못 찾으면 정해진 열 번호로 대체한다. 시스템 B의
  `getLectureList()`도 이 함수를 그대로 호출해 컬럼 위치를 가져온다 — DB 시트
  관련 코드를 새로 짤 때는 `header.indexOf(...)`를 직접 쓰지 말고 이 함수를 통할 것.

### Supabase
- 무료 티어 사용. **7일 비활성 일시정지** 방지: GAS 시간 트리거로 **3일마다 자동 핑**
  (`SELECT 1` 수준). 정책 위반 아님, 표준 관행.
- pgvector 무료 포함. API 키는 스크립트 속성에 보관.
- 테이블·인덱스·RLS·함수 정의는 저장소 루트의 **`DB구조.sql`이 단일
  소스(source of truth)** — 계정을 옮겨 새 Supabase 프로젝트를 만들 때도
  이 파일을 처음부터 끝까지 한 번에 실행하면 지금과 동일한 상태로 세팅된다.
- **`SUPABASE_KEY`는 예전 방식의 JWT service_role 키를 써야 한다.** 새
  `sb_secret_` 형식 키에는 브라우저 감지 가드가 있는데, `UrlFetchApp`은
  User-Agent 헤더를 커스텀 값으로 못 바꾸고 항상 구글 기본값을 보내기 때문에
  그 가드에 걸린다(코드로 우회 불가 — 키 값 자체를 예전 형식으로 발급해야 함).
- GAS는 `publish-engine/Survey.js`의 `supabaseRequest_()`를 통해서만 접근하고,
  ai-server는 `supabase_client.py`로 직접 조회한다. RLS는 모든 테이블에 켜져
  있지만 service_role 키는 RLS를 우회하므로 정상 동작에 영향이 없다(anon 키
  유출 대비 이중 방어).

---

## 실시간 설문 기능 (시스템 B)

수업 중 익명 실시간 설문. **동시에 여러 강사가 같은 교안으로 수업해도 격리**된다.

### 흐름
1. 강사가 대시보드에서 설문 생성(문제유형: 객관식·단답형·의견형, 질문 내용,
   [객관식이면] 선택지, [객관식·단답형이면] 정답) → **고유키** 발급(영소문자
   +숫자 4자리, `o`/`l`/`0`/`1`처럼 눈으로 헷갈리기 쉬운 글자는 제외하고 시프트
   키 없이 입력하도록 소문자로 통일 — `publish-engine/Survey.js`의
   `SURVEY_ACCESS_KEY_CHARS_`).
   - 의견형은 정답 없이 학생 의견만 취합하고 채점하지 않는다.
   - 객관식 정답은 텍스트가 아니라 **보기 번호**(1부터)로 받는다 — 학생 제출값도
     번호라 오타·표현 차이 문제가 사라진다.
   - 질문 수명은 지정하지 않음. 강사가 [설문종료]를 누를 때까지 열려 있다.
2. 학생은 뷰어의 **[답변하기]** → 고유키 입력 → 답변 제출.
   - 고유키가 다르면 동시간대 여러 강의실의 설문이 서로 안 섞인다.
   - 뷰어 열람 자체는 코드 없이 자유. 코드는 설문 참여 시에만 필요.
3. 강사가 [설문종료]를 누르면 응답을 집계한다(객관식·단답형은 GAS
   코드 안에서 직접 채점·정답률·분포 계산, 의견형은 ai-server의
   `POST /opinion-summary`로 AI 요약 시도) — **이 시점엔 결과 화면만 뜨고
   아직 저장되지 않는다.**
4. 결과 화면에서 강사가 **[설문결과 저장]** 또는 **[결과를 저장하지 않고
   종료]** 중 하나를 반드시 선택해야 창이 닫힌다(`system-b-dashboard/
   Dashboard.html`의 `saveSurveyResultConfirm()`/`discardSurveyResultConfirm()`).

### 저장 정책 (중요)
- **진행 중 문제·임시 답변은 Supabase의 작업용 테이블**
  (`survey_temp_questions`, `survey_temp_answers`)에 둔다. GAS `CacheService`를
  쓰지 않는 이유는 **대시보드와 뷰어가 서로 다른 GAS 배포라 캐시를 공유할 수
  없기 때문**이다 — Supabase가 두 웹앱 사이의 공유 상태 저장소 역할을 한다.
- **[설문결과 저장]**을 눌러야만(`finalize_survey()` RPC, 한 트랜잭션) 결과가
  영구 테이블 `survey_results`로 옮겨지고 동시에 작업 테이블에서는 삭제된다.
  덕분에 "작업 테이블에 남은 행 = 항상 미완료분"이라는 불변식이 유지된다.
- **[결과를 저장하지 않고 종료]**를 누르면(`discardSurveyQuestion()`) 작업
  테이블 행만 삭제되고 결과는 어디에도 남지 않는다 — 기록이 불필요한
  분위기 환기용 질문("지금 졸린가요?" 등)에 쓰는 경로.
- 학생 답변 제출은 `submit_survey_answer()` RPC로 처리한다. "조회 후 삽입"
  2단계로 나누면 그 사이에 강사가 종료할 수 있어(경쟁 상태), 한 트랜잭션
  안에서 조건부 삽입한다.
- 방치된(24시간 이상 지난) 미완료 설문은 스케줄러 없이, 새 설문을 공개하는
  시점에 자동 정리된다(`cleanupStaleSurveys_()`).

---

## AI 기능 (전용 API 서버 - ai-server)

### 정책: AI 기능은 전부 ai-server에서 개발한다
- **AI를 사용하는 기능은 GAS(system-b-dashboard)에서 모델 API를 직접 호출하지
  않는다.** 전부 `ai-server`(Cloud Run, Python + FastAPI + LangChain, 저장소의
  `ai-server/` 폴더)에 엔드포인트로 구현하고, GAS는 `UrlFetchApp`으로 그
  엔드포인트를 호출하는 역할만 한다.
- **모델 제공자는 OpenAI 하나로 통일한다.** 모든 기능이
  `ai-server/llm_provider.py`의 `get_openai_llm(temperature=0)` 하나를 공용으로
  써서 LangChain `ChatOpenAI` 인스턴스를 만든다 — 새 AI 기능을 추가할 때도 이
  함수를 그대로 재사용할 것. 실제 모델은 Cloud Run 환경변수 `OPENAI_MODEL`로
  정한다(미설정 시 코드 기본값 `gpt-4o`) — 값만 바꾸고 새 리비전을 배포하면
  코드 수정·재빌드 없이 모델을 바꿀 수 있다.
- **모델은 `gpt-4o`를 쓴다.** `gpt-4o-mini`는 동일한 grounding 규칙을 줘도
  없는 내용을 지어내는 빈도가 높아 상위 모델로 고정했다.
- 모델 제공자 API 키(`OPENAI_KEY`)는 GAS 스크립트 속성이 아니라 **ai-server의
  실행 환경변수**(Cloud Run 환경변수·`.env`)에 둔다. GAS는 ai-server 호출용
  공유 비밀키 `AI_SERVER_KEY`(`X-API-Key` 헤더)만 안다.
- **GAS 스크립트 속성과 Cloud Run 환경변수는 완전히 별도 저장소다.** 양쪽에서
  같은 값이 필요하면(예: `SUPABASE_URL`/`SUPABASE_KEY`) 각각 등록해야 한다.
- **AI_MODE 게이트(필수)**: `AI_MODE` 스크립트 속성이 `'true'`일 때만 AI 기능을
  쓸 수 있다. `'false'`(미설정 포함, 안전한 기본값)면 **ai-server를 아예 호출하지
  않고** "AI 기능을 이용하려면 AI 크레딧이 필요합니다." 안내 모달만 띄운다.
  대시보드는 `isAiEnabled()`로 서버 쪽 값을 확인하고, 새 AI 기능을 추가할 때마다
  실제 호출 전에 이 확인을 거치도록 한다(기존 `checkAiEnabled_()` +
  `showAiCreditModal()` 패턴 재사용).
- **호출 실패 시 화면 처리**: 원인 불문(오류·타임아웃·쿼터 초과 등) **"현재 AI
  기능을 사용할 수 없습니다."** 같은 고정 문구만 노출, 원인은 로그로만 남긴다
  (GAS는 `Logger.log()`, ai-server는 서버 로그). AI 기능이 실패해도 배포·목차
  추출 등 나머지 흐름은 그대로 진행되어야 한다(AI 기능은 부가 기능 취급).
- **레이트리밋 주의**: gpt-4o의 조직 분당 토큰 한도(TPM)는 이 프로젝트의 모든
  AI 기능이 공유한다. 여러 강사가 동시에 쓰거나 한 기능이 연속으로 대용량
  호출을 하면 순간적으로 429가 날 수 있다. 현재는 강의자료 평가의 웹검색
  단계에만 재시도 로직이 있고, 다른 기능에서도 반복 발생하면 같은 패턴 적용을
  검토한다.

### 기능별 ai-server 엔드포인트 현황
| 기능 | 상태 | 엔드포인트/경로 | 구현 방식 |
|---|---|---|---|
| 시험문제 생성 | 구현됨 | `POST /exam-questions` | LangChain 구조화 출력 1회 |
| 실시간 설문 - 의견형 결과 요약 | 구현됨 | `POST /opinion-summary` | LangChain 단발 호출 |
| 가상질문 생성 | 구현됨 | `POST /virtual-questions` | LangGraph 상태 유지형 순차 루프 |
| 강의자료 평가 | 구현됨 | `POST /lecture-evaluation` | 구조화 출력 1회 + 웹검색 2단계(부가) |
| 강의자료 요약(1페이지, 배포 시 생성) | 미구현(계획) | 신규 엔드포인트 필요 | — |
| 이해도 보고서(설문 답변 + 슬라이드 내용 분석) | 미구현(계획) | 신규 엔드포인트 필요 | — |

### 시험문제 생성
- 강사가 문제유형(객관식·단답형·서술형) × 문제수준(초급·중급·고급) × 개수를
  지정하면, 슬라이드 본문 전체를 근거로 생성한다.
  `with_structured_output`으로 Pydantic 모델을 직접 받아 프리폼 텍스트 파싱
  위험을 없앴다.
- **가상질문을 레벨에 맞춰 참고자료로 쓴다.** `virtual_question_personas`의
  `exam_level` 컬럼으로 요청 난이도와 매칭되는 페르소나를 찾고, 그 페르소나의
  가상질문 결과만 "학생들이 실제로 많이 질문한 내용"으로 프롬프트에 싣는다
  (`ai-server/supabase_client.py`의 `get_virtual_questions(keyword, exam_level)`).
  매칭되는 페르소나가 없거나 아직 가상질문을 안 만들었으면 빈 리스트 —
  레벨 안 맞는 참고자료를 섞어 쓰지 않고 슬라이드 내용만으로 진행한다.
  - `exam_level` 매핑은 이해도 서열이 아니라 "그 페르소나가 실제로 하는 질문의
    성격이 어느 시험 수준과 어울리는지"로 정했다: 초심자→초급,
    비전공(따라가는 중)→중급, 전공이론파·실무경험자→고급(실무경험자는 이해도가
    낮을 수 있어도 질문 자체는 종합응용형).
  - 문제 자체의 난이도는 참고자료 유무와 무관하게 `exam_generator.py`의
    `_LEVEL_INSTRUCTIONS`가 슬라이드 내용을 근거로 항상 적용한다.
- 생성 결과는 저장하지 않는다(일회성 — 새 탭 화면에서 복사해 사용).

### 실시간 설문 의견형 결과 요약
- `finishSurvey()` → `summarizeOpinions_()`(`system-b-dashboard/Code.js`)가
  ai-server의 `POST /opinion-summary`를 호출한다. 답변 결합은 GAS 쪽에서 미리
  처리한다 — 답변 배열을 `\n---\n` 구분자로 이어붙여 `answers_text` 단일
  문자열로 만들어 보낸다(ai-server는 다시 합칠 필요 없음).
- **프롬프트 규칙**(`ai-server/chains/opinion_summarizer.py`): 답변에 없는
  내용은 절대 지어내지 않는다, 해석 가능한 답변이 하나도 없으면 그대로 그렇게만
  답한다, 건수·인원수·퍼센트를 구체적 숫자로 언급하지 않는다(대신 과반=대부분/
  다수, 최다지만 과반 미만="가장 많이 나온 의견", 뚜렷한 쏠림 없이 비슷함=
  의견이 갈렸다, 1/5 이하=소수 의견 4단계 기준으로 내부 판단), 이 기준을 다수
  의견 판단과 분위기 판단에 동일하게 적용해 문단 전체에서 앞뒤 모순 없이
  유지한다, 다수 의견/전반적 분위기/유독 부정적인 답변(있을 때만) 세 가지만
  자연스러운 한 문단으로 요약한다.
- **이 기능만 실패 시 "AI 크레딧 필요" 모달을 띄우지 않는다.** 이미 수집된 학생
  응답은 요약 성공 여부와 무관하게 항상 확인할 수 있어야 하므로,
  `summarizeOpinions_()`가 `null`을 반환하면(원인 불문) 화면 상단에 "AI 서버
  접근 불가로 답변 원문을 표시합니다" 안내와 함께 학생 답변 원문 전체를
  나열한다. 요약이 성공했을 때도 AI 요약 박스 아래에 "전체 답변" 이름으로 원문
  전체를 항상 같이 보여준다(`Dashboard.html`의 `renderSurveyResult()`).
  답변이 0건이면 AI를 호출하지 않고 "제출된 답변이 없습니다"라고만 표시한다.

### 가상질문 생성
학생 페르소나 입장에서 강의 슬라이드를 앞에서부터 읽으며 궁금한 점을 뽑아내는
기능. 페르소나는 코드가 아니라 Supabase `virtual_question_personas` 테이블의
데이터로 관리한다(새 페르소나 추가 시 코드·스키마 변경 불필요).

- **화면 표기 규칙**: 페르소나를 선택하게 하거나 결과를 출력할 때는
  `학생1(초심자)`, `학생2(비전공, 따라가는 중)`처럼 **"학생N(페르소나 이름)"**
  형식을 쓴다 — N은 `display_order` 순서(1부터), 괄호 안은
  `virtual_question_personas.name` 그대로. 페르소나 코드값(`beginner` 등)이나
  설명(`description`)을 화면에 그대로 노출하지 않는다.
- **흐름**: [가상질문 생성] 버튼 → AI_MODE 게이트 → 학생 선택 모달 → 선택 즉시
  캐시 확인(`getVirtualQuestionCache`) → 있으면 바로 표시, 없으면 자동으로 생성
  시작(`generateVirtualQuestions`) → 결과가 준비되면 모달에는 페르소나 설명·생성
  시각·개수 같은 짧은 요약만 두고, Part 1/2/3 구간별 질문 전체는 새 탭으로
  연다(`openVqResultWindow`). 모달의 "다시 생성"으로 재생성, "새 탭에서 보기"로
  방금 그 결과를 다시 열 수 있다.
- **캐시 정책**: 키워드+페르소나 조합당 최신 결과 1건만 유지(히스토리 누적 안 함).
  "다시 생성"을 눌러야만 재호출하고, 그 외에는 항상 캐시를 먼저 보여준다 —
  시험문제 생성과 달리 결과를 보관하는 이유는 이 결과가 시험문제 생성·강의자료
  평가에서 참고자료로 재사용되기 때문.
- **GAS(`publish-engine/VirtualQuestion.js`)**: `getVirtualQuestionPersonas()`
  (활성 페르소나 목록, `display_order` 순 — prompt는 안 내려줌, ai-server가
  직접 조회), `getVirtualQuestions(keyword, personaId)`(캐시 조회),
  `saveVirtualQuestions(...)`(PostgREST upsert), `deleteVirtualQuestionsForKeyword(...)`.
- **ai-server(`chains/virtual_question_agent.py`)**: LangGraph `StateGraph`로
  `read_batch`(조건부 엣지로 Part 1→2→3 순차 루프) → `filter_questions`(END 직전,
  중복·유사 질문 정리) 그래프를 구성한다. 그래프 위상과 반복 횟수는 코드가
  고정하고, LLM은 각 노드에서 정해진 역할만 수행한다(도구 선택·종료 시점을
  LLM이 자율 결정하는 tool-calling 에이전트가 아님).
  - 페르소나 하나 안에서 구간은 반드시 직렬이다(앞 구간 내용을 알아야 다음
    구간을 판단할 수 있음).
  - 컨텍스트 관리: 전체 슬라이드 50장 이하면 지나온 구간 원문을 그대로 누적,
    50장 초과면 원문 대신 구간별 요약(`batch_summary`)을 누적 — 요약은 별도
    호출을 늘리지 않고 매 구간 질문 생성 호출의 구조화 출력에 함께 실어 받는다.
  - "질문 없음"도 정상 결과로 프롬프트에 명시 — 의미 있는 내용이 없거나 이미
    본 내용과 겹치면 억지로 질문을 만들지 않는다.
  - `filter_questions`가 만든 최종 정제본만 반환·저장한다.

### 강의자료 평가
슬라이드 본문·실시간 설문 결과·가상질문을 근거로 교안을 검토하는 기능. 근거가
될 설문·가상질문이 아직 하나도 없는 강의도 있으므로, 그 경우엔 슬라이드 구성만
으로 하는 검토로 자연스럽게 좁아지도록 설계했다(무엇이 부족한지 지어내지 않고
"반응 데이터 없음"을 명시).

- **흐름**: [강의자료 평가] 버튼 → AI_MODE 게이트 → 캐시 확인
  (`getLectureEvaluationCache`) → 있으면 바로 표시, 없으면 자동 생성
  (`generateLectureEvaluation`, 경과시간 표시) → 결과는 새 탭이 아니라 결과
  모달 안에 그대로 표시(문항 목록이 아니라 산문형 리포트라 모달에 다 담김) →
  [다시 평가]로 재생성.
- **캐시 정책**: 키워드당 최신 결과 1건만 유지(`lecture_evaluations` 테이블).
- **리포트 구성과 근거 표시(핵심 설계)**: 화면 맨 위에 "이 평가가 무엇을 근거로
  했는지"(슬라이드 몇 장, 실시간 설문 몇 건, 어느 가상 학생 질문 몇 개)를 항상
  먼저 보여준다. 이 문구는 **LLM이 아니라 ai-server 코드가 실제 조회 결과로
  직접 조립**한다(`chains/lecture_evaluator.py`의 `build_evidence_basis()`) —
  "무엇을 참고했다"는 사실 진술을 LLM에 맡기면 안 쓴 데이터를 썼다고 하거나
  개수를 틀리는 hallucination 위험이 생기기 때문. 그 아래로 구조 검토(항상) →
  실제/가상 반응 기반 검토(데이터가 하나라도 있을 때만, "실제 학생 응답"과
  "가상 학생 질문"을 프롬프트로 명확히 구분해 섞이지 않게 함) → AI 추가 의견 →
  개선 제안 순으로 표시한다.
- **AI 추가 의견(웹검색 기반) — 이 기능의 유일한 tool-calling 지점**: 나머지 세
  섹션은 이미 조회해둔 DB 데이터만으로 판단 가능해 고정 파이프라인(구조화 출력
  1회, `_generate_core()`)이면 충분하지만, "이 강의 내용 중 현재 최신 기술/버전과
  안 맞는 부분이 있는지"는 LLM이 검색 여부·검색어를 스스로 판단해야 해서 별도로
  분리했다. OpenAI 내장 웹검색(Responses API의 hosted `web_search_preview` 도구,
  `llm_provider.get_web_search_llm()`)을 쓴다 — 검색은 OpenAI 서버 쪽에서 수행
  되므로 클라이언트가 검색→재호출을 반복하는 ReAct 루프를 직접 구현할 필요가
  없고, 호출부는 `.invoke()` 한 번만 하면 된다. 새 검색 API 키 없이 기존
  `OPENAI_KEY`로 되고 "전부 OpenAI" 정책과도 맞아서 별도 검색 API(Tavily 등)
  대신 이걸 선택했다.
  - **검색과 요약을 2단계로 분리한 이유**: 웹검색 도구를 쓰는 호출 안에
    "한국어로 작성", "마크다운 링크 금지", "목록이 아니라 요약 의견으로" 같은
    스타일 지시를 같이 넣으면 잘 지켜지지 않는다(검색 결과 언어 그대로 영어로
    답하거나 원문을 글머리 기호 목록으로 인용). 검색 도구가 걸리면 모델이 스타일
    지시보다 "찾은 내용을 보고하는" 기본 동작 쪽으로 쏠린다. 그래서 ①
    `_run_web_search()`가 웹검색 도구로 원시 조사 결과만 받고(언어·형식 신경
    안 씀), ② `_rewrite_currency_review()`가 검색 도구 없는 일반 호출로 그 결과를
    한국어 요약 의견으로 다시 쓴다(도구 없는 순수 지시 따르기 호출이라 스타일
    지시가 안정적으로 지켜짐).
  - **검색 단계의 입력은 슬라이드 전체 텍스트가 아니라 `core.structure_review`**
    (이미 만들어진 짧은 요약)를 쓴다 — 핵심 평가 직후 전체 텍스트를 또 보내면
    분당 토큰 한도(TPM)에 걸리고, 검색 도구 입장에서도 핵심만 간결하게 받는 게
    낫다. TPM 초과(429)는 보통 1~2초 후 재시도가 권장되는 순간적인 초과라,
    짧게 대기(`_CURRENCY_RETRY_DELAY`) 후 1회 재시도한다.
  - **응답 파싱 주의**: Responses API로 웹검색 도구를 쓰면 `AIMessage.content`가
    문자열이 아니라 텍스트 블록과 도구 호출/검색 결과 블록이 섞인 **리스트**로
    오는 경우가 있다. `_extract_text_content()`가 두 형태를 모두 정규화한다.
    도구가 출처를 마크다운 링크로 자동 첨부하는 경우도 있어
    `_strip_markdown_links()`로 한 번 더 제거한다(화면이 마크다운을 렌더링하지
    않으므로).
  - **완전한 부가 기능이다.** 특별히 지적할 내용이 없으면 모델이 정확히 "NONE"만
    답하도록 프롬프트에 명시했고(억지로 만들어내지 않게), `_generate_currency_review()`는
    **안쪽에서 무슨 오류가 나든 예외를 절대 던지지 않고 항상 `None`으로 수렴**
    하도록 최상위 try/except로 감싸져 있다. 부가 기능 하나의 실패가 근거 명시·
    구조 검토 등 핵심 평가 전체를 끌고 내려가면 안 되기 때문 — 앞으로 웹검색
    쪽에서 새로운 종류의 오류가 나도 개별 패치 없이 "그 섹션만 조용히 빠짐"으로
    자동 처리된다(개발 규칙 10과 같은 원칙).
  - 짧은 timeout(기본 25초)을 걸고 `ThreadPoolExecutor.submit()` +
    `future.result(timeout=...)`로 하드 타임아웃을 강제한다. 이때
    `with ThreadPoolExecutor(...)` 컨텍스트 매니저를 쓰면 `__exit__`가
    `shutdown(wait=True)`를 호출해서 이미 타임아웃으로 포기한 뒤에도 스레드가
    끝날 때까지 다시 블로킹되므로, `executor.shutdown(wait=False)`를 직접
    호출한다.
- **DB**: `lecture_evaluations` 테이블(`DB구조.sql` 6-1번 섹션). 컬럼:
  `evidence_basis`(근거 스냅샷) · `structure_review` · `learner_signal_review`
  (nullable) · `currency_review`(nullable) · `suggestions`(jsonb 배열) ·
  `data_coverage`(`slide_only`/`slide_and_signals`).

### 채택된 확장 아이디어 (나중에)
난이도별 재설명, 실시간 응답 자동분석, 교안 개선 제안, 질문 패턴 분석.
**이해도 보고서**는 슬라이드 파일 1개 단위로 저장된 설문 답변 + 슬라이드 내용을
통째로 AI에 넣어 분석한다 — **벡터/RAG 불필요**(한 파일 범위라 통째 처리 가능).

---

## 권한·인가

- 사용자(관리자 계정 sypark@datasa.net, softsociety.net은 같은 조직 추가 도메인)는
  공유 드라이브 **관리자** 권한 보유 → 게시엔진을 이 계정 권한으로 실행하면
  슬라이드 공유 설정·웹게시가 가능.
- 강사 = 전 직원(교육 관련). 접근 제어는 구글 **"조직 내 사용자"** 액세스에 위임.
  별도 강사 명단 관리 불필요.
- 수강생에게는 **웹게시 URL(또는 뷰어 URL)만 노출**, 원본 파일 링크는 주지 않음
  → 편집·다운로드 차단.

---

## 개발 규칙 (Claude Code가 반드시 지킬 것)

1. **설정값(ID·API키)은 코드에 하드코딩하지 말고 스크립트 속성(PropertiesService)에서
   읽는다.** 계정 이전·값 변경이 쉬워야 함. 코드에는 자리표시자/기본값만.
2. **한 번에 하나의 기능씩** 구현·확인. 큰 덩어리를 한 번에 만들지 않는다.
3. Apps Script 전용 API(`SpreadsheetApp`, `DriveApp`, `SlidesApp`, `UrlFetchApp`,
   `HtmlService`, `PropertiesService`, `CacheService`, `ScriptApp` 등)를 정확히 사용.
   **존재하지 않는 메서드를 지어내지 않는다.** 불확실하면 표준적이고 검증된 방식 사용.
4. 공유 드라이브 대상 작업은 `supportsAllDrives: true` 필요(Drive 고급 서비스 사용 시).
   파일 단위 작업을 `DriveApp` 기본 서비스로 하는 경우는 해당 없음.
5. 각 프로젝트는 별도 폴더(별도 clasp). **push는 폴더 단위**로 이뤄짐을 전제.
6. GAS 6분 실행 제한을 고려(대량 처리는 배치/분할).
7. 웹앱의 실행 계정·액세스 대상 설정은 **코드로 못 바꿈** → 배포 시 수동 설정.
   그 점을 전제로 코드를 짜고, 필요한 배포 설정을 주석/문서로 안내.
8. 함수/변수명은 명확하게. 주석은 한국어로, 핵심 로직 위주로 간결하게.
9. 터미널에서의 질문과 설명은 모두 한국어로 한다.
10. **AI API 호출(ai-server 경유) 관련 기능은 실패를 항상 화면에서 흡수한다.**
    호출 불가·오류·타임아웃·사용량(쿼터) 소모로 인한 거부 등 원인을 막론하고
    사용자에게는 **"현재 AI 기능을 사용할 수 없습니다"** 같은 고정 안내만
    보여주고, 나머지 기능(배포·목차 추출·설문 등)은 영향 없이 계속 동작해야
    한다. 원인 파악용 상세 로그는 `Logger.log()`로만 남긴다.

---

## 개발 환경

- clasp(로컬↔구글 동기화) + Claude Code + Git.
- 최상위 저장소: `dsacontents` (GitHub `rockfe99/dsacontents` 연동). 각 시스템은 하위 폴더.
- `.gitignore`에 `.clasprc.json`(인증 토큰) 제외 완료.
- PowerShell 실행정책 RemoteSigned 설정 완료.

### 폴더 구조
```
dsacontents/
├── publish-engine/        (게시엔진 - 라이브러리)
├── system-a-viewer/       (시스템 A - 배포 완료)
├── system-b-dashboard/    (시스템 B - 배포 완료)
├── ai-server/             (AI 전용 API 서버 - Cloud Run)
├── system-c-excel/        (시스템 C - 예정)
├── DB구조.sql             (Supabase 스키마 단일 소스)
├── CLAUDE.md
├── .gitignore
└── README.md
```

### 작업 루프
- **GAS**: Claude Code 지시 → 코드 검토 → `clasp push --force`(해당 폴더에서) →
  구글에서 실행/배포 확인 → 문제시 수정 → 잘 되면 `git commit`.
- **ai-server**: 코드 수정 → GitHub main 브랜치에 push → Cloud Build 트리거가
  빌드→배포까지 자동 수행(사람 개입 없음).

---

## 구현 현황

### publish-engine (게시엔진)
- `Config.js` — **중앙 설정 허브**. 스크립트 속성에 공용 키(`PARENT_FOLDER_ID`,
  `DB_SHEET_ID`, `VIEWER_URL`, `AI_SERVER_URL`, `AI_MODE`)와 민감 키
  (`SUPABASE_URL`, `SUPABASE_KEY`, `AI_SERVER_KEY`)를 등록해두면, 다른 프로젝트는
  라이브러리로 붙여서 `PublishEngine.getConfig()` / `getPublicConfig()` /
  `getSetting(name)` / `getSecret(name)`으로 가져다 쓴다. `getSecret()`은
  화이트리스트에 등록된 키만 반환한다. `checkSettings()`로 등록 상태 점검 가능.
- `SlideParser.js`
  - `extractSlideId(url)` — 편집 URL에서 슬라이드ID 추출.
  - `extractSlideToc(slideId, method)` — `method`로 목차 추출 방식을 고른다.
    `'title'`(기본값, 제목 플레이스홀더 TITLE/CENTERED_TITLE만 사용, 대체 없음)
    또는 `'firstText'`(플레이스홀더 구분 없이 슬라이드 내 첫 텍스트 도형 사용).
    각 항목에 `objectId`도 포함 — 뷰어에서 목차 클릭 시 해당 슬라이드로 점프하는
    데 쓴다. **제목(또는 첫 텍스트)을 못 찾은 슬라이드는 목차 배열에서 아예
    제외**되고, 남은 항목의 `index`는 원래 슬라이드 위치를 그대로 유지(재번호
    없음 — 뷰어에 번호가 건너뛰며 보임).
  - `extractSlideContents(slideId)` — 목차용과 달리 모든 슬라이드의 텍스트 도형
    전체를 이어붙인 본문(AI 기능용 원문).
- `Publish.js`
  - `publishLecture(url, keyword, title, tocMethod)` — 배포 전체 흐름. PPT를
    "슬라이드로 저장" 안 하고 그냥 연 URL을 넣으면 오피스 호환 편집 화면의
    주소가 정식 구글 슬라이드 URL과 똑같은 형태라 ID 추출까지 통과해버리므로,
    `file.getMimeType() !== MimeType.GOOGLE_SLIDES` 체크로 미리 걸러 원인과
    해결법을 안내한다. 같은 키워드로 다시 호출하면 "배포 수정"이 된다.
  - `updateLectureTitle(keyword, title)` — 슬라이드 URL 없이 **제목만** 갱신하는
    가벼운 경로. 기존 슬라이드ID·목차는 그대로 두고(공유 재설정도, 목차 재추출도
    안 함), 목차데이터의 `키워드.json`과 DB 시트의 제목·최종수정만 바꾼다.
  - `unpublishLecture(keyword)` — 배포를 내린다(슬라이드 파일 자체는 안 지움).
    슬라이드 공유를 `PRIVATE`로 되돌리고, 목차데이터의 `키워드.json`은 휴지통
    이동, DB 행은 삭제(키워드 재사용 가능), 그 키워드의 Supabase 데이터(설문·
    슬라이드본문·가상질문·강의자료평가)도 전부 정리한다.
    **같은 슬라이드ID를 다른 키워드가 여전히 참조 중이면 슬라이드 공유는 건드리지
    않는다** — 그 키워드의 뷰어까지 같이 깨지지 않게 하기 위함.
  - `getTocData(keyword)` — 목차데이터 폴더의 `키워드.json`을 읽어
    `{keyword, title, slideId, toc}` 반환(없으면 `null`). **시스템 A 뷰어가
    데이터를 가져오는 유일한 통로.**
  - `getDbColumnIndexes(headerRow)` — 위 "DB 스프레드시트 구조" 참고(공개 함수).
  - `getDbSheet_(dbSheetId)`(비공개) — DB 시트를 이름(`"강의목록"`)으로 찾음.
  - `lectureExists(keyword)` — 신규 등록 중복 방지용.
- `SlideContent.js` — 슬라이드 본문 텍스트를 Supabase `slide_contents`에 저장/삭제.
  누적이 아니라 현재 슬라이드의 스냅샷이라 재배포 시 기존 행을 지우고 새로 채운다.
- `Survey.js` — 실시간 설문 데이터 계층(Supabase REST). `supabaseRequest_()`가
  service_role 키를 다루는 유일한 지점이고, 같은 프로젝트의 다른 파일
  (`SlideContent.js`, `VirtualQuestion.js`, `LectureEvaluation.js`)이 이 함수를
  그대로 재사용한다.
- `VirtualQuestion.js` / `LectureEvaluation.js` — 가상질문·강의자료 평가 결과의
  캐시 조회/저장(upsert)/삭제. AI 호출은 하지 않는 순수 DB 계층.
- `Test.js` — 편집기에서 직접 실행하는 검증용 함수 모음.

### system-a-viewer (시스템 A 뷰어) — 배포 완료
- `appsscript.json`: `PublishEngine` 라이브러리 연결, `webapp.executeAs:
  USER_DEPLOYING`, `webapp.access: ANYONE_ANONYMOUS`.
- `Code.js`의 `doGet(e)`: `?k=키워드` → `PublishEngine.getTocData(keyword)` 하나로만
  데이터를 가져온다. 키워드 없음/못 찾음/내부 오류 전부 **키워드 원문을 화면에
  노출하지 않는 고정 문구**로 처리(위 보안 정책). `getTocData()` 호출은
  try/catch로 감싸 내부 오류 메시지가 그대로 노출되지 않게 한다.
  실시간 설문 응답용 `getSurveyQuestion()`/`submitSurveyAnswer()`도 여기에 있다.
- `Portal.html` / `Sidebar.html`: 좌측 목차 사이드바(검색 가능) + 우측 슬라이드
  embed(iframe). 목차 클릭 시 `objectId`로 해당 슬라이드로 이동. `objectId`가 없는
  기존 데이터(재추출 전 강의)는 클릭해도 에러 없이 무반응 처리.
- `publish-engine`의 `VIEWER_URL` 스크립트 속성에 이 배포 URL이 등록되어 있어야
  시스템 B의 URL복사/뷰어열기 버튼이 동작한다.

### system-b-dashboard (시스템 B 대시보드) — 배포 완료
- `appsscript.json`: `webapp.executeAs = USER_ACCESSING`, `webapp.access = DOMAIN`
  — "강사 본인 실행 / 조직 내 사용자만 접근" 설계와 일치. `PublishEngine`
  라이브러리는 `developmentMode: true`(게시엔진 HEAD 최신 코드를 항상 사용).
  안정성이 필요하면 배포 전에 `false`로 바꾸고 고정 버전을 지정하는 것도 고려할 것.
- `Code.js`: `doGet(e)`가 `?page=help`면 `Help.html`, 아니면 `Dashboard.html`을
  렌더링. `getLectureList()`가 `PublishEngine.getPublicConfig()`로 설정을 받아
  강의 목록을 읽어 반환. 배포/삭제, 실시간 설문, AI 4종 기능의 진입점이 전부
  이 파일에 있다.
- `Dashboard.html`: 강의 목록 표 + 아이콘 버튼(URL복사·뷰어열기) + 각 기능 모달.
  강의 목록 헤더의 "기능" 열 옆에 `isAiEnabled()` 결과에 따라 `AI Mode : ON/OFF`
  배지를 표시한다(`.ai-mode-badge`). `alert()`/`confirm()` 대신 항상 공용
  확인/알림 모달(`showConfirmModal`)을 쓴다.
- `Help.html`: 기능별 사용법 안내 페이지.

### 새 강의 추가 / 배포 수정 / 삭제 흐름
강사가 시스템 B에서 키워드·제목·URL(+목차 추출 방식) 입력 → `google.script.run`
으로 `deployLecture(url, keyword, title, isNew, tocMethod)` 호출 → 성공 시 목록
새로고침.

- **새 강의 추가**(`isNew=true`): 키워드가 이미 DB에 있으면 등록 자체를 막는다
  (클라이언트 `onKeywordInput()` 즉시 체크 + 서버 `lectureExists()` 재확인).
  URL 필수.
- **배포 수정**(`isNew=false`): 키워드 입력칸 비활성화(고정). 모달을 열면
  URL 필드는 **비워진 채**로 열리고, 기존에 등록된 URL은 회색 placeholder로만
  보인다(참고용, 제출값 아님) — **URL 입력 여부로 동작이 갈린다**:
  - **URL 비움** → `updateLectureTitle()` 경로. 제목만 바뀌고 슬라이드·목차는
    그대로 유지. "제목만 수정합니다" 확인창.
  - **URL 입력** → `publishLecture()` 경로. 그 슬라이드로 전체 재배포, 목차도
    새로 생성. "새 슬라이드로 갱신합니다" 확인창.
  - 모달 하단 좌측에 **[배포 삭제]** 버튼(빨간색, 배포 수정 모드에서만 노출) →
    확인창(슬라이드는 안 지워지지만 공유 범위가 내부 접근으로 바뀌고, 목차 json
    삭제, 뷰어 링크 끊김, 목록에서 제거됨을 안내) → `deleteLecture(keyword)`.
- **목차 추출 방식**: URL 필드 아래 라디오 버튼으로 `'title'`(제목만, 기본값)
  / `'firstText'`(첫 텍스트 도형) 선택. 모달 열 때마다 `'title'`로 초기화.
- URL 에러(예: PPT를 그냥 연 주소를 넣었을 때)는 토스트가 아니라 URL 필드
  바로 아래 인라인 빨간 텍스트(`#urlError`)로 표시되고 줄바꿈이 유지된다.
  URL 필드를 다시 건드리면 사라진다.
- 모달은 바깥 영역을 클릭해도 닫히지 않는다(취소 버튼이나 우측 상단 × 로만 닫힘)
  — 실수로 입력 내용이 날아가는 것 방지.

### ai-server (AI 전용 API 서버) — 배포 완료
- Cloud Run 서비스 `dsacontents-ai-api`(리전 `asia-northeast3`)를 GitHub 저장소
  `rockfe99/dsacontents`(소스 하위 디렉터리 `ai-server`)와 연결. `ai-server`에
  커밋을 main 브랜치로 push하면 빌드→배포까지 자동으로 끝난다.
- **빌드는 반드시 `ai-server/cloudbuild.yaml`(Cloud Build 구성 파일) 유형으로
  한다.** 트리거의 "Dockerfile" 빌드 유형은 이미지를 Artifact Registry에
  빌드+푸시까지만 하고 Cloud Run에 배포하는 단계가 없어서, 빌드가 성공해도 새
  리비전이 생기지 않는다. `cloudbuild.yaml`이 빌드·푸시·`gcloud run deploy`를
  전부 명시한다. 이 파일 안에서는 트리거의 커스텀 대체 변수 대신 Artifact
  Registry 경로 등 실제 값을 직접 쓴다(유형을 바꾸는 과정에서 대체 변수 값이
  초기화되는 문제가 있음). 상세 절차는 `ai-server/DEPLOY.md` 참고.
- 저장소가 GAS 프로젝트 폴더와 함께 있는 모노레포라, 빌드 소스 디렉터리를
  `ai-server`로 지정해야 한다(저장소 루트를 보면 Dockerfile을 못 찾음).
- `main.py`에 AI 연동과 무관하게 항상 고정 문자열을 반환하는 헬스체크
  엔드포인트(`GET /`)가 있다 — 배포 경로 자체의 성공 여부와 AI 연동 성공 여부를
  분리해서 확인할 수 있다.
- **Cloud Run 환경변수**: `OPENAI_KEY`, `AI_SERVER_KEY`, `SUPABASE_URL`,
  `SUPABASE_KEY`(+ 선택적으로 `OPENAI_MODEL`). Supabase 값은 `/exam-questions`·
  `/virtual-questions`·`/lecture-evaluation`이 슬라이드 본문·페르소나·설문 결과를
  직접 읽는 데 필요하다.
- 파일 구성: `main.py`(엔드포인트) / `auth.py`(X-API-Key 검증) /
  `llm_provider.py`(ChatOpenAI 인스턴스 생성 공용) / `supabase_client.py`
  (PostgREST 읽기 전용 조회) / `chains/*.py`(기능별 체인).

### 미착수
- `system-c-excel` 프로젝트 자체가 아직 생성 안 됨.
- 강의자료 요약(1페이지), 이해도 보고서 — 계획 단계(위 "기능별 ai-server
  엔드포인트 현황" 표 참고).

---

## 실행/배포 시 주의사항

1. **HtmlService 페이지 내 링크는 상대경로로 쓰면 안 됨.**
   웹앱 화면은 실제로 `script.googleusercontent.com`의 iframe 안에서 렌더링되므로
   `href="?page=help"` 같은 상대경로는 그 iframe 주소 기준으로 풀려 엉뚱한 곳으로
   간다(새 탭은 뜨는데 내용이 빔). **`doGet`에서 `ScriptApp.getService().getUrl()`
   로 얻은 절대 URL을 템플릿 변수로 넘겨(`tpl.baseUrl = ...`) `<?= baseUrl ?>`로
   써야** 정상 동작한다(`Dashboard.html`/`Help.html`에 적용됨 — 새 화면 추가 시
   같은 패턴을 따를 것).
2. **`clasp push`는 코드 동기화일 뿐, 배포와 다르다.**
   웹앱 URL이 고정 버전 배포(`/exec`, 예: `@3`)라면 push 후에도 그 URL은 이전
   코드로 계속 응답한다. 반영하려면 Apps Script 편집기에서 **배포 관리 → 새 버전
   으로 배포**를 해야 한다. 반면 "테스트 배포"용 `/dev` URL이나 `@HEAD` 배포는
   push 직후 새로고침만 해도 최신 코드가 반영된다. 헷갈리면 지금 접속 중인 URL이
   `/dev`인지 `/exec`인지, 배포 버전이 몇 번인지부터 확인할 것.
3. **웹앱의 "실행 계정"·"액세스 대상"은 배포 화면에서 수동 설정.**
   `appsscript.json`의 `webapp.executeAs`/`webapp.access`는 새 배포 생성 시
   기본값으로 반영되긴 하지만, 실제로 그렇게 배포됐는지 배포 화면에서 한 번은
   육안으로 확인해야 한다(특히 접근 권한 "조직 내 사용자"로 뜨는지).
4. **라이브러리 호출은 호출자(현재 로그인한 강사) 권한으로 실행된다.**
   시스템 B가 `PublishEngine`을 GAS 라이브러리로 추가해서 부르는 방식이면,
   게시엔진 코드는 게시엔진 소유자가 아니라 **강사 본인의 Drive 권한**으로 실행
   된다. 공유 드라이브 관리자 권한이 필요한 동작(슬라이드 공유 설정 등)에서
   강사 계정에 권한이 없어 실패할 수 있다 — 그 경우 게시엔진을 별도로
   "관리자 실행" 웹앱/API 실행형으로 배포해두고 `UrlFetchApp`으로 호출하는
   방식으로 바꿔야 한다(아직 미결정 사항).
5. **배포 시스템별 실행/접근 조합 (설계 확정값)**

   | 시스템 | 실행(executeAs) | 접근(access) | 이유 |
   |---|---|---|---|
   | 시스템 A (뷰어) | 나(관리자, `USER_DEPLOYING`) | 모든 사용자(`ANYONE_ANONYMOUS`) | 수강생 로그인 없이 열람해야 함 |
   | 시스템 B (대시보드) | 액세스하는 사용자(`USER_ACCESSING`) | 조직 내(`DOMAIN`) | 강사 본인 권한으로 실행, 사내 인증 필요 |
   | 시스템 C (엑셀분석) | 액세스하는 사용자(`USER_ACCESSING`) | 조직 내(`DOMAIN`) | 시스템 B와 동일 원칙 |

6. **결과를 새 탭으로 여는 기능은 팝업 차단을 전제로 만든다.**
   `google.script.run` 비동기 콜백 안에서 바로 `window.open()`을 호출하면 사용자
   클릭이라는 "신뢰된 제스처" 범위를 벗어나 브라우저가 팝업으로 차단하는 경우가
   있다. 그래서 시험문제 생성·가상질문 생성은 먼저 결과 모달을 띄우고(경과시간
   표시하며 생성) 완료 시 새 탭을 자동으로 시도하되, 모달 하단에 [닫기]/
   [다시 생성]/**[새 탭에서 보기]** 버튼을 항상 남긴다 — 이 버튼 클릭은 진짜
   사용자 제스처라 차단되지 않는다.
7. **[알려진 제약] 구글 계정이 여러 개 동시 로그인된 브라우저에서 시스템 A
   (공개 뷰어)가 안 열릴 수 있다.**
   Apps Script 자체의 알려진 제약으로, 여러 구글 계정이 동시 로그인된 상태에서
   `script.google.com/macros/.../exec` 요청 시 계정 컨텍스트 충돌로 접속이 막힌다
   (`ANYONE_ANONYMOUS` 설정 여부와 무관, 코드 문제 아님). exec URL에
   `/a/gmail.com/`을 끼워 넣는 커뮤니티 우회법은 실기기 검증 결과 효과가 없어
   기각했다.
   - **단일 계정 로그인 또는 무로그인 상태는 항상 정상 접속된다.** 실제 수강생은
     대부분 이 경우라 서비스에는 영향이 없다고 판단하고, 코드 수정 없이 그대로
     둔다.
   - 관리자·직원 기기(회사계정+개인계정 동시 로그인)에서만 재현되며, 같은
     조건에서도 기기·계정마다 결과가 갈린다. 계정 권한 등급 차이는 원인이
     아닌 것으로 확인됐고(양쪽 다 워크스페이스 관리자가 아님), 브라우저 세션·
     쿠키 이력 쪽이 원인일 가능성이 남아 있다.
