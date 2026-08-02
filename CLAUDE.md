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

## 시스템 구조 (독립형 GAS 프로젝트 4개 + 공유 데이터)

각 시스템은 **독립형(standalone) GAS 프로젝트**이며, 별도 폴더 = 별도 clasp 프로젝트다.
서로 데이터(DB 스프레드시트·JSON·Supabase)를 공유한다.

| 폴더 | 시스템 | 실행 권한 | 접근 | 역할 |
|---|---|---|---|---|
| `publish-engine` | 게시엔진 (라이브러리) | 관리자 권한 | — | 슬라이드ID 추출·자동공유·목차추출·JSON저장·DB기록 |
| `system-a-viewer` | 시스템 A 수강생 뷰어 | 관리자 | 모든 사용자(로그인 불필요) | 게시된 슬라이드를 목차와 함께 표시. 읽기 전용. `?k=키워드` 접속 |
| `system-b-dashboard` | 시스템 B 강사 대시보드 | 강사 본인 | 조직 내 | 파일 배포·실시간 설문·시험문제 생성. 게시 작업은 게시엔진에 위임 |
| `system-c-excel` | 시스템 C 엑셀 분석 | 관리자·실무자 | 조직 내 | 엑셀 업로드→스프레드시트 변환, 통계·보고서·홍보자료 자동생성 (별도 대시보드) |

개발 순서: **게시엔진 → 시스템 A → 시스템 B → 시스템 C**.
현재 `publish-engine`(설정 허브 완성) + `system-b-dashboard`(기본 골격 완성, 목록 조회까지 동작)
생성됨. `system-a-viewer`, `system-c-excel`은 아직 미생성. 자세한 진행 상황은 아래
["진행 상황"](#진행-상황-2026-07-27-기준) 참고.

---

## 핵심 동작 원리

### 배포 워크플로 (강사의 최소 작업)
1. 강사가 PPT를 공유 드라이브에 올림
2. "구글 슬라이드로 저장"
3. 슬라이드 편집화면 URL 복사
4. 시스템 B 대시보드에서 **키워드 + 제목 + URL** 입력 후 [배포]
5. 게시엔진이 자동 처리: URL에서 슬라이드ID 추출 → 슬라이드 공유 설정
   (링크 있는 사람 보기) → 목차 추출 → 목차데이터/키워드.json 저장 → DB 기록
6. 대시보드가 수강생용 링크(`시스템A URL + ?k=키워드`) 안내

### 불변 요구사항 (핵심)
- 뷰어 주소는 **`?k=키워드`로 영구 고정**. 게시판에 올려두면 학생이 클릭해 들어옴.
- 교안 수정 시: 강사가 **같은 키워드에 새 URL을 재등록**하면, 주소는 그대로 두고
  내용만 갱신됨. (키워드가 변하는 슬라이드ID와 고정 뷰어주소 사이의 다리)
- 뷰어 열람은 **코드 없이 항상 자유** (강사 없는 복습 대응).

### 보안 유의사항 — 시스템 A 뷰어 구현 시 반드시 반영 (XSS 방지)
- `?k=키워드`는 사용자가 URL에 직접 넣는 값이라 신뢰할 수 없다. 화면(HTML/JS)에
  이 값을 그대로 반영(echo)하면 스크립트 삽입이 가능해진다.
- **키워드를 못 찾았을 때 에러 메시지에 키워드 원문을 절대 넣지 않는다.** 고정
  문구만 표시: `"아직 관리자가 강의를 배포하지 않았거나 존재하지 않는 키워드입니다."`
  (예전 테스트 코드에서 메시지 끝에 `(키워드: <입력값>)`을 붙였다가 그 값이 그대로
  실행되는 문제가 있었음 — 실제 구현 시 이 형태를 재현하지 않는다.)
- 사용자 입력(쿼리 파라미터 등)을 화면에 표시해야 하는 그 밖의 모든 곳에서도,
  HTML에 넣기 전 반드시 이스케이프한다(`system-b-dashboard/Dashboard.html`의
  `esc()` 함수와 같은 패턴 재사용). `innerHTML`/`document.write`/템플릿 문자열에
  사용자 입력을 이스케이프 없이 바로 꽂지 않는다.
- **리다이렉트 서비스 계획과 연결**: 회사 서버에 `www.datasa.net?lect=키워드`
  형태의 짧은 URL을 받아 JS로 시스템 A 뷰어(`?k=키워드`)로 이동시키는 리다이렉트
  페이지를 추가할 예정. 이 페이지에서도 `lect` 파라미터 값을 `encodeURIComponent()`로
  인코딩해 `location.href` 구성 용도로만 쓰고, 화면 표시나 `eval`류 실행에는
  쓰지 않는다.

---

## 데이터 저장 (3원화)

| 데이터 | 위치 | 형식 |
|---|---|---|
| 교안 메타(키워드·URL·제목·시각) | DB 스프레드시트 | 셀(행 단위) |
| 목차(TOC)·요약 | 목차데이터 폴더 | `키워드.json` |
| 학생 설문 답변(누적·분석용) | Supabase PostgreSQL | 테이블 (pgvector 포함) |

### 확보된 ID (스크립트 속성에 저장할 것 — 하드코딩 금지)
```
PARENT_FOLDER_ID = 1AwU4YgMjPcgW36IIXZl94gsLNtKJgP-6   (시스템 파일 저장 기본 폴더)
DB_SHEET_ID      = 1eSXtQL5dVi2BFymrUMI0NabuSb600mehKUDMRJBga5o   (DB 스프레드시트)
```

### 목차데이터 폴더
- 기본 폴더(`PARENT_FOLDER_ID`) 아래 **"목차데이터"** 폴더를 이름으로 찾고, 없으면 생성.
- 배포 시 그 안에 `키워드.json` 생성/갱신(덮어쓰기).
- 별도 ID 불필요 — 이름으로 조회/생성.

### DB 스프레드시트 구조 (게시엔진이 없으면 헤더 자동 생성)
- 키워드가 고유 키. 배포 시 같은 키워드 행이 있으면 갱신, 없으면 추가.
- `목차JSON` 컬럼은 JSON 원문을 셀에 넣지 않고, 목차데이터 폴더에 저장된
  `키워드.json` 파일의 Drive 링크만 기록한다(`publish-engine/Publish.js` 구현).
- **시트는 위치(첫 번째 탭)가 아니라 이름 `"강의목록"`으로 찾는다** — 시트 순서가
  바뀌어도 안전하도록 `getDbSheet_(dbSheetId)`(`publish-engine/Publish.js`)가
  `getSheetByName('강의목록')`으로 조회하고, 없으면 에러를 던진다. 시스템 B의
  `getLectureList()`도 같은 방식.
- **1행(헤더) 실제 컬럼 구성 — 코드에서 컬럼을 찾을 때 반드시 이 헤더명 그대로 사용:**

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

---

## 실시간 설문 기능 (시스템 B) — 구현 완료(2026-08-01)

수업 중 익명 실시간 설문. **동시에 여러 강사가 같은 교안으로 수업해도 격리**되어야 함.

### 흐름
1. 강사가 대시보드에서 설문 생성(문제유형: 객관식·단답형·의견형, 질문 내용,
   [객관식이면] 선택지, [객관식·단답형이면] 정답) → **고유키** 발급(영소문자
   +숫자 4자리, `o`/`l`/`0`/`1`처럼 눈으로 헷갈리기 쉬운 글자는 제외 —
   시프트 키 없이 입력하도록 소문자로 통일함, `publish-engine/Survey.js`의
   `SURVEY_ACCESS_KEY_CHARS_`).
   - 의견형은 정답 없이 학생 의견만 취합하고 채점하지 않는다.
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
  (`survey_temp_questions`, `survey_temp_answers`)에 둔다 — 애초 검토했던
  GAS CacheService 대신 Supabase로 확정됐다(대시보드와 뷰어가 서로 다른
  GAS 배포라 CacheService를 공유할 수 없기 때문).
- **[설문결과 저장]**을 눌러야만(`finalize_survey()` RPC, 한 트랜잭션) 결과가
  영구 테이블 `survey_results`로 옮겨지고 동시에 작업 테이블에서는 삭제된다.
- **[결과를 저장하지 않고 종료]**를 누르면(`discardSurveyQuestion()`) 작업
  테이블 행만 삭제되고 결과는 어디에도 남지 않는다 — 기록이 불필요한
  분위기 환기용 질문("지금 졸린가요?" 등)에 쓰는 경로.
- 방치된(24시간 이상 지난) 미완료 설문은 스케줄러 없이, 새 설문을 공개하는
  시점에 자동 정리된다(`cleanupStaleSurveys_()`).

### Supabase
- 무료 티어 사용. **7일 비활성 일시정지** 방지: GAS 시간 트리거로 **3일마다 자동 핑**
  (`SELECT 1` 수준). 정책 위반 아님, 표준 관행.
- pgvector 무료 포함. API 키는 스크립트 속성에 보관.
- 테이블·인덱스·RLS·함수 정의는 저장소 루트의 **`DB구조.sql`이 단일
  소스(source of truth)** — 계정을 옮겨 새 Supabase 프로젝트를 만들 때도
  이 파일을 처음부터 끝까지 한 번에 실행하면 지금과 동일한 상태로 세팅된다.

---

## AI 기능 (전용 API 서버 - ai-server)

### 정책(2026-07-30 변경): AI 기능은 전부 ai-server에서 개발한다
- **AI를 사용하는 기능은 GAS(system-b-dashboard)에서 모델 API를 직접 호출하지
  않는다.** 전부 `ai-server`(Cloud Run, Python + FastAPI + LangChain, 저장소의
  `ai-server/` 폴더)에 엔드포인트로 구현하고, GAS는 `UrlFetchApp`으로 그
  엔드포인트를 호출하는 역할만 한다 — 기존 시험문제 생성(`/exam-questions`)과
  동일한 패턴을 모든 AI 기능에 적용.
- 모델 제공자 API 키(OpenAI·Gemini 등)는 GAS 스크립트 속성이 아니라 **ai-server의
  실행 환경변수**(Cloud Run 환경변수·`.env`)에 둔다. GAS는 ai-server 호출용
  공유 비밀키 `AI_SERVER_KEY`(`X-API-Key` 헤더)만 안다.
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

### 실시간 설문 의견형 결과 요약 - 구현 완료(2026-08-01)
- `finishSurvey()` → `summarizeOpinions_()`(`system-b-dashboard/Code.js`)가
  ai-server의 `POST /opinion-summary`를 호출하고(`AI_SERVER_URL`/
  `AI_SERVER_KEY`, 시험문제 생성과 동일한 패턴), ai-server 쪽
  `chains/opinion_summarizer.py`가 OpenAI로 요약을 생성하는 것까지
  end-to-end로 동작 확인됨. 답변 결합은 GAS 쪽에서 미리 처리한다 -
  `summarizeOpinions_()`가 답변 배열을 `\n---\n` 구분자로 이어붙여
  `answers_text` 단일 문자열로 만들어 보낸다(ai-server는 다시 합칠 필요 없음).
- 프롬프트는 실기기 테스트를 여러 차례 거치며 다듬어짐(`ai-server/chains/
  opinion_summarizer.py`) - 무의미한 입력에도 긍정적 분위기로 지어내는
  문제, 답변을 개조식으로 나열하는 문제, 응답 건수를 잘못 세는 문제,
  팽팽한 의견을 "대부분"으로 과장하거나 반대로 뚜렷한 다수(예: 4명 중
  3명)를 "판단하기 어렵다"고 얼버무리는 문제를 차례로 겪고 수정함.
  현재 규칙: 답변에 없는 내용은 절대 지어내지 않는다, 해석 가능한 답변이
  하나도 없으면 그대로 그렇게만 답한다, 건수·인원수·퍼센트를 구체적
  숫자로 언급하지 않는다(대신 과반=대부분/다수, 최다지만 과반 미만=
  "가장 많이 나온 의견", 뚜렷한 쏠림 없이 비슷함=의견이 갈렸다, 1/5
  이하=소수 의견 4단계 기준으로 내부 판단), 이 기준을 다수 의견 판단과
  분위기 판단에 동일하게 적용해 문단 전체에서 앞뒤 모순 없이 유지한다,
  다수 의견/전반적 분위기/유독 부정적인 답변(있을 때만) 세 가지만
  자연스러운 한 문단으로 요약한다. 모델은 `gpt-4o` - `gpt-4o-mini`는 같은
  grounding 규칙을 줘도 hallucination이 잦아 실기기 테스트 끝에 상위
  모델로 교체함(2026-08-01).
- 이 기능은 다른 AI 기능과 달리 실패 시 "AI 크레딧 필요" 모달을 띄우지
  않는다. 이미 수집된 학생 응답은 요약 성공 여부와 무관하게 항상 확인할 수
  있어야 하므로, `summarizeOpinions_()`가 `null`을 반환하면(AI_MODE 꺼짐·
  서버 설정 누락·요청 실패·응답 없음 등 원인 불문) 화면 상단에 "AI 서버
  접근 불가로 답변 원문을 표시합니다" 안내와 함께 학생 답변 원문 전체를
  그대로 나열한다. 요약이 성공했을 때도 AI 요약 박스 아래에 "전체 답변"
  이름으로 원문 전체를 항상 같이 보여준다(`system-b-dashboard/Dashboard.html`
  의 `renderSurveyResult()`). 답변이 0건이면 AI를 호출하지 않고 "제출된
  답변이 없습니다"라고만 표시한다(AI 서버 접근 불가 메시지와 구분 —
  자세한 저장/미저장 흐름은 위 "실시간 설문 기능" 절 참고).

### 모델 제공자 정책(2026-08-01 변경): Gemini 제거, 전부 OpenAI로 통일
- 시험문제 생성이 쓰던 Gemini(`langchain-google-genai`)를 걷어내고 OpenAI로
  이관함 - `requirements.txt`에서 `langchain-google-genai` 제거, `GEMINI_KEY`/
  `GEMINI_MODEL` 환경변수도 더 이상 쓰지 않음(Cloud Run에서 지워도 됨).
- 두 엔드포인트(`/exam-questions`, `/opinion-summary`) 모두
  `ai-server/llm_provider.py`의 `get_openai_llm(temperature=0)` 하나를
  공용으로 써서 LangChain `ChatOpenAI` 인스턴스를 만든다 - 새 AI 기능
  (강의자료 요약·이해도 보고서 등)을 추가할 때도 이 함수를 그대로 재사용할 것.
- 실제 쓰는 모델은 Cloud Run 환경변수 `OPENAI_MODEL`로 정한다(미설정 시
  코드 기본값 `gpt-4o`) - 값만 바꾸고 새 리비전을 배포하면 코드 수정·재빌드
  없이 모델을 바꿀 수 있다.
- **확인된 사실(2026-08-01, Cloud Run 콘솔 실기기 확인)**: 이 문서에 예전에
  "`GEMINI_KEY`/`SUPABASE_URL`/`SUPABASE_KEY`/`AI_SERVER_KEY` 등록 완료"라고
  적혀 있었지만, 실제 Cloud Run 환경변수에는 `OPENAI_KEY`와 `AI_SERVER_KEY`
  둘만 등록되어 있었다(문서와 실제가 어긋나 있던 것으로 확인·정정). Gemini를
  더 이상 안 쓰므로 `GEMINI_KEY`는 필요 없지만, `SUPABASE_URL`/`SUPABASE_KEY`는
  `/exam-questions`가 `supabase_client.get_slide_text()`로 슬라이드 본문을
  읽어오는 데 여전히 필요한데 아직 미등록 상태다 - publish-engine 스크립트
  속성에 있는 것과 같은 값을 Cloud Run 환경변수에도 등록해야 시험문제
  생성이 정상 동작한다(GAS 쪽 스크립트 속성과 ai-server의 Cloud Run
  환경변수는 완전히 별도 저장소라 값을 각각 등록해야 함).

### 기능별 ai-server 엔드포인트 현황
| 기능 | 상태 | 엔드포인트/경로 | 모델 제공자 |
|---|---|---|---|
| 시험문제 생성 | 구현됨 | `POST /exam-questions` (`ai-server/main.py`) | OpenAI(`gpt-4o`, LangChain) — UI의 모델 선택 라디오는 제거됨(선택지가 하나뿐이라) |
| 실시간 설문 - 의견형 결과 요약 | 구현됨 | `POST /opinion-summary` (`ai-server/main.py`) | OpenAI(`gpt-4o`, LangChain) |
| 가상질문 생성 | 구현됨 | `POST /virtual-questions` (`ai-server/main.py`) | OpenAI(`gpt-4o`, LangChain+LangGraph) |
| 강의자료 요약(1페이지, 배포 시 생성) | 미구현(계획) | 신규 엔드포인트 필요 | OpenAI 예정 |
| 이해도 보고서(설문 답변 + 슬라이드 내용 분석) | 미구현(계획) | 신규 엔드포인트 필요 | OpenAI 예정 |
| 강의자료 평가 | 구현됨 | `POST /lecture-evaluation` (`ai-server/main.py`) | OpenAI(`gpt-4o`, LangChain) + OpenAI 내장 웹검색(Responses API, 부가 기능) |

### 기능
- **강의자료 요약** (1페이지, 배포 시 생성해 JSON에 저장 → 뷰어 즉시 열람)
- **시험문제 생성** (강사가 유형·개수 지정 → 생성 → 화면 표시 → 골라서 시험지)
- **이해도 보고서**: 슬라이드 파일 **1개 단위**로, 저장된 설문 답변 + 슬라이드 내용을
  통째로 AI에 넣어 분석. **벡터/RAG 불필요**(한 파일 범위라 통째 처리 가능).
- **가상질문 생성**: `virtual_question_personas`(Supabase, `DB구조.sql` 5번 섹션)에
  정의된 학생 페르소나 입장에서 AI가 질문을 뽑아내는 기능. **화면에 페르소나를
  선택하게 하거나 결과를 출력할 때는 `학생1(초심자)`, `학생2(비전공, 따라가는 중)`
  처럼 "학생N(페르소나 이름)" 형식을 쓴다** — N은 `display_order` 순서(1부터),
  괄호 안은 `virtual_question_personas.name` 그대로. 페르소나 코드값(`beginner`
  등)이나 설명(`description`)을 화면에 그대로 노출하지 않는다.

### 채택된 확장 아이디어 (나중에)
난이도별 재설명, 실시간 응답 자동분석, 교안 개선 제안, 질문 패턴 분석.
확장 대비해 **슬라이드 본문 텍스트도 저장**해두면 유리.

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
5. 각 프로젝트는 별도 폴더(별도 clasp). **push는 폴더 단위**로 이뤄짐을 전제.
6. GAS 6분 실행 제한을 고려(대량 처리는 배치/분할).
7. 웹앱의 실행 계정·액세스 대상 설정은 **코드로 못 바꿈** → 배포 시 수동 설정.
   그 점을 전제로 코드를 짜고, 필요한 배포 설정을 주석/문서로 안내.
8. 함수/변수명은 명확하게. 주석은 한국어로, 핵심 로직 위주로 간결하게.
9. 터미널에서의 질문과 설명은 모두 한국어로 한다.
10. **AI API 호출(ai-server 경유, Gemini·랭체인 등) 관련 기능은 실패를 항상 화면에서
    흡수한다.** 호출 불가·오류·타임아웃·사용량(쿼터) 소모로 인한 거부 등 원인을
    막론하고 사용자에게는 **"현재 AI 기능을 사용할 수 없습니다"** 같은 고정
    안내만 보여주고, 나머지 기능(배포·목차 추출·설문 등)은 영향 없이 계속
    동작해야 한다. 원인 파악용 상세 로그는 `Logger.log()`로만 남긴다.

---

## 개발 환경

- clasp(로컬↔구글 동기화) + Claude Code + Git.
- 최상위 저장소: `dsacontents` (GitHub 연동). 각 시스템은 하위 폴더.
- `.gitignore`에 `.clasprc.json`(인증 토큰) 제외 완료.
- 회사 계정 clasp push 테스트 통과. PowerShell 실행정책 RemoteSigned 설정 완료.

### 폴더 구조(목표)
```
dsacontents/
├── publish-engine/        (게시엔진 - 생성됨, 설정 허브 완성)
├── system-a-viewer/       (시스템 A - 생성됨, 배포 완료)
├── system-b-dashboard/    (시스템 B - 생성됨, 기본 골격 완성)
├── system-c-excel/        (시스템 C - 예정)
├── docs/                  (문서)
├── CLAUDE.md
├── .gitignore
└── README.md
```

### 작업 루프
Claude Code 지시 → 코드 검토 → `clasp push --force`(해당 폴더에서) →
구글에서 실행/배포 확인 → 문제시 수정 → 잘 되면 `git commit`.

---

## 진행 상황 (2026-07-28 기준)

### publish-engine (게시엔진)
- `Config.js`가 **중앙 설정 허브**로 완성됨. 스크립트 속성에 공용 키
  (`PARENT_FOLDER_ID`, `DB_SHEET_ID`, `VIEWER_URL`)와 민감 키
  (`GEMINI_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`)를 등록해두면, 다른 프로젝트는
  라이브러리로 붙여서 `PublishEngine.getConfig()` / `getPublicConfig()` /
  `getSetting(name)` / `getSecret(name)`으로 가져다 쓴다.
  - `VIEWER_URL`은 시스템 A 배포 후 채워짐(아래 참고) — 개발 단계 방침대로
    `Config.js`의 `setAllProperties()` 소스에 실제 값을 넣고 실행하는 방식 사용 중.
- `SlideParser.js`:
  - `extractSlideId(url)` 그대로.
  - `extractSlideToc(slideId, method)` — `method`로 목차 추출 방식을 고른다.
    `'title'`(기본값, 제목 플레이스홀더 TITLE/CENTERED_TITLE만 사용, 대체 없음)
    또는 `'firstText'`(플레이스홀더 구분 없이 슬라이드 내 첫 텍스트 도형 사용).
    각 항목에 `objectId`(`slide.getObjectId()`)도 포함 — 뷰어에서 목차 클릭 시
    해당 슬라이드로 점프하는 데 씀. **제목(또는 첫 텍스트)을 못 찾은 슬라이드는
    목차 배열에서 아예 제외**되고, 남은 항목의 `index`는 원래 슬라이드 위치를
    그대로 유지(재번호 없음 — 뷰어에 번호가 건너뛰며 보임).
- `Publish.js`:
  - **`publishLecture(url, keyword, title, tocMethod)`** — 배포 전체 흐름(PPT가
    아닌 진짜 구글 슬라이드인지 mimeType 확인 → 공유 설정 → 목차 추출 → 
    `키워드.json` 저장 → DB 기록). PPT를 "슬라이드로 저장" 안 하고 그냥 연
    URL을 넣으면 원인과 해결법을 안내하는 에러를 던짐(`file.getMimeType() !==
    MimeType.GOOGLE_SLIDES` 체크). 같은 키워드로 다시 호출하면 "배포 수정".
  - **`updateLectureTitle(keyword, title)`** — 슬라이드 URL 없이 **제목만** 갱신하는
    가벼운 경로. 기존 슬라이드ID·목차는 그대로 두고(공유 재설정도, 목차 재추출도
    안 함), 목차데이터의 `키워드.json`과 DB 시트의 제목·최종수정만 바꾼다. 시스템
    B "배포 수정" 모달에서 URL 칸을 비워두고 제출하면 이 경로를 탄다.
  - **`unpublishLecture(keyword)`** — 배포를 내린다(슬라이드 파일 자체는 안 지움).
    슬라이드 공유를 `PRIVATE`(공유 드라이브 멤버만)로 되돌리고, 목차데이터의
    `키워드.json`은 휴지통 이동, DB 행은 삭제(키워드 재사용 가능해짐). 시스템 B
    "배포 수정" 모달의 [배포 삭제] 버튼에서 호출. **버그 수정**: 같은 슬라이드를
    다른 키워드가 여전히 참조 중이면(같은 슬라이드ID로 여러 키워드 등록된 경우)
    슬라이드 공유는 건드리지 않고 목차 json 삭제 + DB 행 삭제만 함 — 원래는
    무조건 `PRIVATE`로 되돌려서 같은 슬라이드를 쓰는 다른 키워드의 뷰어까지
    같이 깨지는 문제가 있었음.
  - **`getTocData(keyword)`** — 목차데이터 폴더의 `키워드.json`을 읽어
    `{keyword, title, slideId, toc}` 반환(없으면 `null`). **시스템 A 뷰어가
    데이터를 가져오는 유일한 통로.**
  - **`getDbColumnIndexes(headerRow)`** — DB 시트 헤더 배열에서 컬럼 인덱스를
    이름으로 찾되, 못 찾으면(오타·변경) 열 순서가 고정이라는 전제하에 정해진
    번호로 대체(공개 함수, 시스템 B도 그대로 씀). DB 시트 관련 코드에서는
    `header.indexOf(...)`를 직접 쓰지 말고 이 함수를 통할 것.
  - **`getDbSheet_(dbSheetId)`**(비공개) — DB 시트를 위치(`getSheets()[0]`)가
    아니라 이름(`"강의목록"`)으로 찾음. 시트 탭 순서가 바뀌어도 안전.
  - `lectureExists(keyword)` 그대로(신규 등록 중복 방지용).
  - DB 시트 실제 헤더가 스펙과 달랐던 문제(B열이 `제목`이 아니라 `강의제목`)를
    발견해 코드를 실제 헤더에 맞게 고침(아래 "DB 스프레드시트 구조" 표가 현재
    기준 — 코드에서 컬럼 찾을 때 이 표의 헤더명을 그대로 쓸 것).
- `Test.js`: `testStep1()`, `testPublish()` — 편집기 실행 검증 완료.

### system-b-dashboard (시스템 B 대시보드)
- `clasp create`로 신규 GAS 프로젝트 생성 완료(scriptId는 `.clasp.json`에 있음).
- `appsscript.json`: `webapp.executeAs = USER_ACCESSING`, `webapp.access = DOMAIN`
  으로 설정 — "강사 본인 실행 / 조직 내 사용자만 접근" 설계와 일치.
- `Code.js`: `doGet(e)`가 `?page=help`면 `Help.html`, 아니면 `Dashboard.html`을
  렌더링. `getLectureList()`가 `PublishEngine.getPublicConfig()`로 `DB_SHEET_ID`,
  `VIEWER_URL`을 받아와 DB 스프레드시트에서 강의 목록을 읽어 반환.
  - `PublishEngine` 라이브러리는 이미 추가됨(`appsscript.json`의
    `dependencies.libraries`에 `libraryId` 등록 확인됨, `developmentMode: true`
    → 게시엔진 HEAD 최신 코드를 항상 사용). 배포 전엔 `developmentMode`를
    `false`로 바꾸고 고정 버전을 지정하는 것도 고려할 것(안정성).
- `Dashboard.html`: 강의 목록 표 + 아이콘 버튼(URL복사·뷰어열기, 마우스오버 시
  풍선도움말) **정상 동작 확인됨**(`VIEWER_URL` 설정 후 실제 뷰어로 이동 확인).
  **"시험문제 생성" · "실시간 설문"은 여전히 토스트만 뜨는 스텁**(`(준비 중)`).
- `Help.html`: 대시보드와 동일한 톤의 도움말 페이지. 5개 섹션 전부 "내용 준비
  중입니다" 임시 텍스트 — 추후 실제 사용법으로 교체 필요.
- 배포된 웹앱이 고정 버전(`/exec`)이면 `clasp push`만으로는 반영 안 됨 →
  "실행/배포 시 주의사항" 참고(이번 세션에 system-a-viewer에서 실제로 겪음).

### 새 강의 추가/배포 수정/삭제 흐름 (완성)
전체 설계: 강사가 시스템 B에서 키워드·제목·URL(+목차 추출 방식) 입력 →
`google.script.run`으로 `deployLecture(url, keyword, title, isNew, tocMethod)` 호출
→ 성공 시 목록 새로고침. **화면 테스트까지 완료.**

- **새 강의 추가**(`isNew=true`): 키워드가 이미 DB에 있으면 등록 자체를 막는다
  (클라이언트 `onKeywordInput()` 즉시 체크 + 서버 `lectureExists()` 재확인).
  URL 필수. URL 필드 아래에 "구글슬라이드 파일을 열어 주소창 URL을 복사해서
  붙여넣기" 안내 표시.
- **배포 수정**(`isNew=false`): 키워드 입력칸 비활성화(고정). 모달을 열면
  URL 필드는 **비워진 채**로 열리고, 기존에 등록된 URL은 회색 placeholder로만
  보인다(참고용, 제출값 아님) — **URL 입력 여부로 동작이 갈린다**:
  - **URL 비움** → `updateLectureTitle()` 경로. 제목만 바뀌고 슬라이드·목차는
    그대로 유지(재추출 없음). "제목만 수정합니다" 확인창.
  - **URL 입력** → `publishLecture()` 경로. 그 슬라이드로 전체 재배포, 목차도
    새로 생성. "새 슬라이드로 갱신합니다" 확인창.
  - 모달 하단 좌측에 **[배포 삭제]** 버튼(빨간색, 배포 수정 모드에서만 노출) →
    `deleteLectureConfirm()` → 확인창(슬라이드는 안 지워지지만 공유 범위가
    "내부만 접근 가능"으로 바뀌고, 목차 json 삭제, 뷰어 링크 끊김, 목록에서
    제거됨을 안내) → `deleteLecture(keyword)` → `PublishEngine.unpublishLecture()`.
- **목차 추출 방식**: URL 필드 아래 라디오 버튼으로 `'title'`(제목만, 기본값)
  / `'firstText'`(첫 텍스트 도형) 선택. 모달 열 때마다 `'title'`로 초기화.
- URL 에러(예: PPT를 그냥 연 주소를 넣었을 때)는 토스트가 아니라 URL 필드
  바로 아래 인라인 빨간 텍스트(`#urlError`)로 표시되고 줄바꿈이 유지됨,
  URL 필드를 다시 건드리면 사라짐.
- 모달은 바깥 영역을 클릭해도 닫히지 않음(취소 버튼이나 우측 상단 × 로만 닫힘)
  — 실수로 입력 내용이 날아가는 것 방지.

### system-a-viewer (시스템 A 뷰어) — 신규 완성, 배포됨
예전에 스프레드시트에 종속된 프로토타입(`system-a-viewer-ref`, 참고용으로
`clasp clone`했다가 삭제함)이 있었지만 **코드는 재사용하지 않고 디자인만
참고해 전부 새로 작성**함.
- `appsscript.json`: `PublishEngine` 라이브러리 연결(system-b-dashboard와 같은
  libraryId), `webapp.executeAs: USER_DEPLOYING`, `webapp.access: ANYONE_ANONYMOUS`.
- `Code.js`의 `doGet(e)`: `?k=키워드` → `PublishEngine.getTocData(keyword)` 하나로만
  데이터를 가져옴. 키워드 없음/못 찾음/내부 오류 전부 **키워드 원문을 화면에
  절대 노출하지 않는 고정 문구**로 처리(CLAUDE.md 보안 정책 반영). `getTocData()`
  호출은 try/catch로 감싸 내부 오류 메시지가 그대로 노출되지 않게 함.
- `Portal.html` / `Sidebar.html`: 좌측 목차 사이드바(검색 가능) + 우측 슬라이드
  embed(iframe). 목차 클릭 시 `objectId`로 해당 슬라이드로 이동. `objectId`가 없는
  기존 데이터(재추출 전 강의)는 클릭해도 에러 없이 무반응 처리. 목차 JSON을
  `<script>`에 주입할 때 `</script` 조기 종료 방지용 이스케이프 적용.
- 배포 완료, `/exec?k=키워드`로 실제 열람 확인됨. 배포 중 "고정 버전은 push만으로
  안 바뀐다"는 문제를 실제로 겪고 배포 관리에서 새 버전으로 갱신해 해결함.
- `publish-engine`의 `VIEWER_URL` 스크립트 속성에 이 배포 URL을 등록 완료 →
  시스템 B의 URL복사/뷰어열기 버튼 정상 동작 확인됨.

### ai-server (AI 전용 API 서버) — Cloud Run 배포 경로 확인 및 기본 배선 완료
- Cloud Run 서비스 `dsacontents-ai-api`(리전 `asia-northeast3`)를 GitHub
  저장소 `rockfe99/dsacontents`(소스 하위 디렉터리 `ai-server`)와 연결해
  생성. 저장소가 `ai-server` 외에도 여러 GAS 프로젝트 폴더가 같이 있는
  모노레포라서 초기 설정 과정에서 다음 문제들을 겪고 해결함(상세 원인·해결
  절차는 `ai-server/DEPLOY.md`에 정리):
  - 빌드 소스 디렉터리가 저장소 루트를 보고 있어 `Dockerfile`을 못 찾아
    실패 → 트리거의 Dockerfile 디렉터리를 `ai-server`로 지정.
  - "Dockerfile" 빌드 유형은 이미지를 Artifact Registry에 **빌드+푸시까지만**
    하고 Cloud Run에 실제로 배포하는 단계가 빠져 있어, 빌드가 성공해도 새
    리비전이 자동으로 생기지 않음(서비스 URL이 계속 숨겨짐, 버전 탭엔
    `gcr.io/cloudrun/placeholder` 자리표시자만 존재) → 빌드·푸시·
    `gcloud run deploy`를 전부 명시하는 **`ai-server/cloudbuild.yaml`**을
    작성하고, 트리거 유형을 "Cloud Build 구성 파일"로 바꿔 이 파일을
    가리키도록 재구성. 트리거의 커스텀 대체 변수(`_AR_HOSTNAME` 등)는 유형을
    바꾸는 과정에서 값이 초기화되는 문제가 있어, `cloudbuild.yaml` 안에서는
    그 변수 대신 Artifact Registry 경로 등 실제 값을 직접 하드코딩함.
  - 이후로는 `ai-server`에 커밋을 GitHub main 브랜치로 push하기만 하면
    빌드→배포까지 사람 개입 없이 자동으로 끝나는 것까지 실기기로 확인됨.
- `main.py`에 AI 연동과 무관하게 항상 고정 문자열을 반환하는 헬스체크
  엔드포인트(`GET /`)를 추가해, 배포 경로 자체의 성공 여부와 AI 연동
  성공 여부를 분리해서 확인할 수 있게 함.
- Cloud Run 서비스 환경변수에 `OPENAI_KEY` 등록 완료(2026-07-31, 새 버전으로
  배포까지 완료) — 기존 `GEMINI_KEY`/`SUPABASE_URL`/`SUPABASE_KEY`/
  `AI_SERVER_KEY`와 동일한 방식(Cloud Run 환경변수, 코드에서는
  `os.environ.get("OPENAI_KEY")`로 읽을 예정). 용도는 실시간 설문 의견형
  결과 요약(`POST /opinion-summary`, 아직 엔드포인트 코드는 미구현)에서
  OpenAI를 모델 제공자로 쓰기 위함 — 등록만 먼저 해두고 실제 연동 코드는
  이후 작업으로 미룸. `ai-server/.env.example`에도 로컬 개발용 자리표시자
  항목을 같이 추가해둠.
- `system-b-dashboard`가 GAS에서 OpenAI를 직접 호출하던 `callAI_()`/
  `buildOpinionPrompt_()`를 걷어내고(위 "마이그레이션 완료" 항목 참고),
  `publish-engine/Config.js`의 `SECRET_KEYS`에서도 `OPENAI_KEY`를 제거함 —
  이제 이 키는 GAS 스크립트 속성이 아니라 ai-server의 Cloud Run 환경변수
  에만 존재한다(GAS 쪽 `publish-engine` 프로젝트의 스크립트 속성에 남아있던
  `OPENAI_KEY` 등 API 키 값은 사용자가 직접 전부 삭제 완료).
- `system-b-dashboard/Dashboard.html`에 AI_MODE 상태를 한눈에 보여주는
  배지를 추가함 — 강의 목록 헤더의 "기능" 열 옆에 `isAiEnabled()` 결과에
  따라 `AI Mode : ON`(파란색 계열, `--blue-050`/`--blue-700`) 또는
  `AI Mode : OFF`(빨간색 계열)를 표시(`.ai-mode-badge` 클래스, 페이지 로드
  시 `checkAiEnabled_()`로 한 번 확인).

### 가상질문 생성 - 구현 완료(2026-08-01)
학생 페르소나(`virtual_question_personas`, [[가상질문 생성]] 계획 문서의 4종)
입장에서 강의 슬라이드를 앞에서부터 읽으며 궁금한 점을 뽑아내는 기능.
`참고파일/클로드코드 스크립트.txt`에서 여러 차례 설계를 좁혀가며 확정한
최종안(페르소나 동시 실행 없이 1명씩 단일 요청, 슬라이드는 Part 1/2/3
3구간 고정) 그대로 구현했다.

- **흐름**: [가상질문 생성] 버튼 → AI_MODE 게이트(`checkAiEnabled_`) →
  학생 선택 모달(`vqPersonaOverlay`, "학생1(초심자)" 형식 — CLAUDE.md 표시
  규칙 참고) → 선택 즉시 캐시 확인(`getVirtualQuestionCache`) → 있으면
  바로 표시, 없으면 자동으로 생성 시작(`generateVirtualQuestions`) →
  결과 준비되면(캐시 적중이든 신규 생성이든) 모달에는 페르소나 설명·생성
  시각·개수 같은 짧은 요약만 두고, Part 1/2/3 구간별 질문 전체는 자동으로
  새 탭에 연다(`openVqResultWindow`, 시험문제 생성의 `openExamResultWindow`
  와 같은 패턴) — 질문이 많으면 세로로 길어져 모달 안에서는 닫기 버튼이나
  위/아래 내용이 잘리는 문제가 있어 모달 표시 대신 새 탭으로 전환함
  (2026-08-01). 새 탭 헤더에도 페르소나 설명을 표시한다. 모달의 "다시 생성"
  버튼으로 재생성 가능, "새 탭에서 보기"로 방금 그 결과를 다시 열 수 있음
  (`system-b-dashboard/Dashboard.html`의 `makeVirtualQuestions` 계열 함수).
- **캐시 정책**: 키워드+페르소나 조합당 최신 결과 1건만 유지(히스토리
  누적 안 함). "다시 생성"을 눌러야만 재호출하고, 그 외에는 항상 캐시를
  먼저 보여준다 — 시험문제 생성과 달리 결과를 영구 보관하는 이유는, 이
  결과가 나중에 시험문제 생성·강의자료 평가에서 참고자료로 재사용될
  예정이기 때문.
- **GAS(publish-engine/VirtualQuestion.js, 신규)**: `getVirtualQuestionPersonas()`
  (활성 페르소나 목록, `display_order` 순 — prompt는 안 내려줌, ai-server가
  직접 조회), `getVirtualQuestions(keyword, personaId)`(캐시 조회),
  `saveVirtualQuestions(keyword, personaId, questions)`(PostgREST
  upsert — `on_conflict=lecture_keyword,persona_id` +
  `Prefer: resolution=merge-duplicates`로 기존 결과 덮어쓰기),
  `deleteVirtualQuestionsForKeyword(keyword)`(강의 완전 삭제 시 정리 —
  `Publish.js`의 `unpublishLecture()`에 설문·슬라이드본문 삭제와 함께
  추가).
- **GAS(system-b-dashboard/Code.js)**: `getVirtualQuestionPersonaOptions()`,
  `getVirtualQuestionCache()`는 단순 DB 조회 다리 역할.
  `generateVirtualQuestions(keyword, personaId)`가 ai-server의
  `POST /virtual-questions`를 호출하고, 성공하면 결과를 즉시
  `PublishEngine.saveVirtualQuestions()`로 캐시에 저장 — `generateExamQuestions()`
  와 같은 실패 흡수 패턴(오류·타임아웃 등은 원인 불문 `{error:true}`).
- **ai-server**: `chains/virtual_question_agent.py` — LangGraph
  `StateGraph`로 `read_batch`(조건부 엣지로 Part 1→2→3 순차 루프) →
  `filter_questions`(END 직전, 중복·유사 질문 정리) 그래프 구성.
  - 컨텍스트 관리: 전체 슬라이드 50장 이하면 지나온 구간 원문을 그대로
    누적, 50장 초과면 원문 대신 구간별 요약(`batch_summary`)을 누적 —
    요약은 별도 호출을 늘리지 않고 매 구간 질문 생성 호출의 구조화 출력에
    함께 실어 받는다(`_BatchResult.batch_summary`).
  - "질문 없음"도 정상 결과로 프롬프트에 명시 — 의미 있는 내용이 없거나
    이미 본 내용과 겹치면 억지로 질문을 만들지 않는다(의견 요약 기능의
    hallucination 교훈을 재적용).
  - `filter_questions`가 만든 최종 정제본만 반환·저장한다 — 구간별
    원본 질문은 별도로 보관하지 않는다.
  - `supabase_client.py`에 `get_slide_segments(keyword)`(슬라이드
    순서대로 원본 리스트, 배치 분할용)와 `get_persona(persona_id)`
    (활성 페르소나 1건, prompt 포함) 추가 — `get_slide_text()`는
    `get_slide_segments()`를 재사용하도록 리팩터링(동작 변화 없음).
  - `requirements.txt`에 `langgraph` 추가.
- **실기기 테스트 완료(2026-08-01)**: Cloud Run 배포 후 대시보드에서 학생
  선택 → 캐시 확인 → 생성(경과시간 표시) → 새 탭 결과 표시 → 다시 생성까지
  전체 흐름 정상 동작 확인됨. `system-b-dashboard/Help.html`에도 사용법
  섹션(7번, [[가상질문 생성]])을 추가함.

### 시험문제 생성 - 가상질문 레벨 매칭 추가(2026-08-02)
기존 시험문제 생성(`POST /exam-questions`)에 문제수준(초급/중급/고급)과
서술형 유형이 이미 반영돼 있었는데, 참고자료로 쓰는 가상질문을 "문제수준과
학생에이전트의 수준을 맞춰서" 골라 쓰는 부분이 빠져 있어 추가했다.
- **레벨-페르소나 매칭**: `virtual_question_personas`에 `exam_level`
  컬럼 추가(`DB구조.sql`) - 초심자→초급, 비전공(따라가는 중)→중급,
  전공이론파·실무경험자→고급. 이해도 서열이 아니라 "그 페르소나가 실제로
  하는 질문의 성격이 어느 시험 수준과 어울리는지"로 정함(예: 실무경험자는
  이해도는 낮을 수 있지만 질문 자체는 종합응용형이라 고급).
  `ai-server/supabase_client.py`의 `get_virtual_questions(keyword, exam_level)`이
  이 컬럼으로 먼저 매칭되는 persona_id를 찾고, 그 persona_id의 결과만
  참고자료로 넘긴다 - 매칭되는 페르소나가 없거나 그 페르소나로 아직 가상질문을
  생성 안 했으면 빈 리스트(레벨 안 맞는 참고자료를 섞어 쓰지 않고, 참고자료
  없이 슬라이드 내용만으로 진행). 문제 자체의 난이도는 참고자료 유무와
  무관하게 `exam_generator.py`의 `_LEVEL_INSTRUCTIONS`가 슬라이드 내용을
  근거로 항상 적용한다.
- 이 세션에서 함께 고친 기존 버그 3건: (1) `Dashboard.html`의
  `generateExam()`이 `examLevel` 라디오값을 안 읽고 서버 호출에 안 넘기던
  문제, (2) 새 탭 결과 화면(`openExamResultWindow`)에 "저장되지 않으니
  복사해서 사용하라"는 안내문이 없던 문제, (3) **결과가 새 탭 팝업 차단으로
  안 뜨는 문제** - 원래는 옵션 입력 모달을 닫고 `google.script.run`
  비동기 콜백 안에서 바로 `window.open()`을 호출했는데, 이 시점은 사용자의
  클릭이라는 "신뢰된 제스처" 범위를 벗어나 브라우저가 팝업으로 차단하는
  경우가 있었다. 가상질문 생성과 같은 패턴으로 바꿔 해결: 옵션 모달을 닫으면
  결과 모달(`examResultOverlay`)이 뜨고, 경과시간 표시하며 생성 → 완료되면
  모달에는 문제 개수 등 짧은 요약만 두고 `openExamResultWindow()`를 자동
  호출해 새 탭을 시도한다. 이때도 차단될 수 있으므로 모달 하단에 [닫기]/
  [다시 생성]/[새 탭에서 보기] 버튼을 항상 남겨두고, [새 탭에서 보기] 클릭은
  진짜 사용자 제스처라 차단되지 않는다(`reopenExamResultWindow()`).
- **DB구조.sql 실행 필요**: 기존 Supabase 프로젝트는 이미
  `virtual_question_personas`가 있는 상태라, `exam_level` 컬럼 추가는
  전체 파일 재실행이 아니라 아래 ALTER/UPDATE만 SQL Editor에서 실행하면
  된다(`DB구조.sql` 자체는 새 프로젝트를 처음부터 만들 때 기준으로 이미
  `exam_level` 포함해서 갱신해둠).
  ```sql
  alter table virtual_question_personas
    add column exam_level text
      check (exam_level in ('beginner','intermediate','advanced'));

  update virtual_question_personas set exam_level = 'beginner'     where persona_id = 'beginner';
  update virtual_question_personas set exam_level = 'intermediate' where persona_id = 'casual';
  update virtual_question_personas set exam_level = 'advanced'     where persona_id = 'major_theory';
  update virtual_question_personas set exam_level = 'advanced'     where persona_id = 'major_practice';
  ```

### 강의자료 평가 - 구현 완료(2026-08-02)
슬라이드 본문·실시간 설문 결과·가상질문을 근거로 교안을 검토하는 기능.
근거가 될 실시간 설문·가상질문이 아직 하나도 없는 강의도 있을 수 있어서,
그 경우엔 슬라이드 구성만으로 하는 검토(무엇이 부족한지 지어내지 않고
"반응 데이터 없음"을 명시)로 자연스럽게 좁아지도록 설계했다.

- **흐름**: [강의자료 평가] 버튼 → AI_MODE 게이트 → 캐시 확인
  (`getLectureEvaluationCache`) → 있으면 바로 표시, 없으면 자동으로 생성
  시작(`generateLectureEvaluation`, 경과시간 표시) → 결과는 새 탭이 아니라
  결과 모달 안에 그대로 표시(가상질문·시험문제와 달리 문항 목록이 아니라
  산문형 리포트라 새 탭 없이도 다 담김) → [다시 평가]로 재생성 가능
  (`system-b-dashboard/Dashboard.html`의 `evaluateMaterial`/`showEvalResultReady`
  계열 함수).
- **캐시 정책**: 가상질문과 동일하게 키워드당 최신 결과 1건만 유지
  (`lecture_evaluations` 테이블, `uq_lecture_evaluations_keyword` UPSERT
  기준). [다시 평가]를 눌러야만 재호출.
- **리포트 구성과 근거 표시(핵심 설계)**: 화면 맨 위에 "이 평가가 무엇을
  근거로 했는지"(슬라이드 몇 장, 실시간 설문 몇 건, 어느 가상 학생 질문
  몇 개)를 항상 먼저 보여준다. 이 문구는 **LLM이 아니라 ai-server 코드가
  실제 조회 결과로 직접 조립**한다(`chains/lecture_evaluator.py`의
  `build_evidence_basis()`) - "무엇을 참고했다"는 사실 진술을 LLM에 맡기면
  안 쓴 데이터를 썼다고 하거나 개수를 틀리는 등 불필요한 hallucination
  위험이 생기기 때문. 그 아래로 구조 검토(항상) → 실제/가상 반응 기반
  검토(실시간 설문·가상질문 데이터가 하나라도 있을 때만, "실제 학생 응답"과
  "가상 학생 질문"을 프롬프트로 명확히 구분해서 섞이지 않게 함) → AI 추가
  의견(아래 참고) → 개선 제안 순으로 표시한다.
- **AI 추가 의견(웹검색 기반) - 이 기능의 유일한 tool-calling 지점**: 나머지
  세 섹션은 이미 조회해둔 DB 데이터만으로 판단 가능해 고정 파이프라인
  (구조화 출력 1회, `chains/lecture_evaluator.py`의 `_generate_core()`)이면
  충분하지만, "이 강의 내용 중 현재 최신 기술/버전과 안 맞는 부분이
  있는지"는 LLM이 검색 여부·검색어를 스스로 판단해야 하는 문제라 별도로
  분리했다. OpenAI 내장 웹검색(Responses API의 hosted `web_search_preview`
  도구, `llm_provider.get_web_search_llm()`)을 썼다 - 검색 자체는 OpenAI
  서버 쪽에서 알아서 수행되므로 클라이언트가 검색→재호출을 반복하는
  ReAct 루프를 직접 구현할 필요는 없고, 호출부는 평소처럼 `.invoke()` 한
  번만 하면 된다. 새 검색 API 키 없이 기존 `OPENAI_KEY`로 바로 되고,
  "전부 OpenAI로 통일" 정책과도 맞아서 별도 검색 API(Tavily 등) 대신
  이걸 선택했다.
  - 이 섹션은 **완전히 부가 기능**이다 - 특별히 지적할 내용이 없으면
    모델이 정확히 "NONE"이라고만 답하도록 프롬프트에 명시해 억지로 만들어
    내지 않게 했고(가상질문의 "질문 없음도 정상" 패턴 재적용), 호출
    자체가 타임아웃·미지원 모델·API 오류 등 어떤 이유로든 실패해도
    (`_generate_currency_review()`가 통째로 try/except) 조용히 그 섹션만
    빠지고 나머지 리포트(근거·구조 검토·반응 검토·개선 제안)는 항상
    정상 반환된다 - CLAUDE.md 규칙 10과 동일 원칙.
  - 짧은 timeout(기본 25초, `llm_provider.get_web_search_llm(timeout=...)`)을
    걸어뒀고, `ThreadPoolExecutor.submit()` + `future.result(timeout=...)`로
    하드 타임아웃을 강제한다 - `with ThreadPoolExecutor(...)` 컨텍스트
    매니저를 그냥 쓰면 `__exit__`가 `shutdown(wait=True)`를 호출해서
    이미 `result(timeout=...)`로 포기한 뒤에도 스레드가 실제로 끝날
    때까지 다시 블로킹되는 문제가 있어, `executor.shutdown(wait=False)`를
    직접 호출하는 방식으로 피했다.
  - **확인된 사실(2026-08-02, Cloud Run 로그 실기기 확인)**: `use_responses_api=True`
    + `bind_tools([{"type": "web_search_preview"}])` 조합 자체는 정상
    동작한다(OpenAI가 요청을 정상적으로 받아 `RateLimitError(429)`로
    응답한 것으로 확인됨 - 클라이언트 쪽 요청 형식 문제였다면 이런 응답
    자체가 안 옴). 대신 실제로 겪은 문제는 **레이트리밋**이었다: 핵심 평가
    호출이 슬라이드 143장 전체 텍스트로 이미 토큰을 쓴 직후, 웹검색 호출도
    같은 전체 텍스트를 또 보내면서 조직 분당 토큰 한도(TPM 30,000)를
    넘김(사용 11,668 + 요청 18,845). OpenAI가 보통 1~2초 후 재시도를
    권하는 순간적인 초과라, 짧게 대기(`_CURRENCY_RETRY_DELAY`, 3초) 후
    1회 재시도하는 로직을 추가해 대응함(`_generate_currency_review()`).
    이 TPM 한도는 이 프로젝트의 gpt-4o를 쓰는 모든 기능(시험문제 생성·
    의견 요약·가상질문 생성·강의자료 평가)이 조직 단위로 공유하므로,
    여러 강사가 동시에 AI 기능을 쓰면 다른 기능에서도 같은 종류의 순간적
    레이트리밋이 발생할 수 있다는 점은 참고할 것(현재는 이 기능에만
    재시도 로직이 있음 - 다른 기능도 반복 발생하면 같은 패턴 적용 검토).
  - **버그 수정(2026-08-02, 재시도 통과 후 실기기에서 추가로 발견)**: 레이트
    리밋 재시도까지는 통과했는데, 그다음 응답 파싱에서 다시 죽는 문제가
    있었다 - Responses API로 웹검색 도구를 쓰면 `AIMessage.content`가 항상
    문자열이 아니라 텍스트 블록과 도구 호출/검색 결과 블록이 섞인
    **리스트**로 오는 경우가 있는데(예: `[{"type": "text", "text": "..."},
    {"type": "web_search_call", ...}]`), 코드가 문자열이라고만 가정하고
    `.strip()`을 바로 호출해 `AttributeError: 'list' object has no
    attribute 'strip'`로 500 에러가 났다. `_extract_text_content()`를
    추가해 문자열/리스트 두 형태 다 처리하도록 고쳤다.
  - **구조 보강(2026-08-02)**: 위 두 버그 다 "이 지점에서 날 수 있는 오류"를
    하나씩 막는 식이었는데, 사용자가 "웹검색 쪽에서 오류가 나도 근거 명시·
    구조 검토 같은 핵심 평가는 항상 살아야 한다"고 짚어줘서 구조를 한 번 더
    보강함 - `_generate_currency_review()`를 얇은 wrapper로 만들고, 그
    안에서 실제 로직(아래 항목의 2단계 호출)을 최상위 try/except로 감싼다.
    그 결과 `_generate_currency_review()`는 **안쪽에서 무슨 오류가 나든
    (아직 겪어보지 못한 새로운 오류 포함) 예외를 절대 던지지 않고 항상
    `None`으로 수렴**하도록 구조적으로 보장됨 - 앞으로 웹검색 쪽에서 새로운
    종류의 오류가 나도 개별 패치 없이 "그 섹션만 조용히 빠짐"으로 자동
    처리된다.
  - **설계 변경(2026-08-02, 검색+요약 단일 호출 → 2단계로 분리)**: 실기기
    테스트에서 반복 확인된 문제 - 웹검색 도구를 쓰는 호출 안에 "한국어로
    작성", "마크다운 링크 쓰지 마라", "목록이 아니라 요약 의견으로" 같은
    스타일 지시를 같이 넣어도 잘 안 지켜졌다(검색 결과 언어 그대로 영어로
    답하거나, 원문을 그대로 글머리 기호 목록으로 인용). 검색 도구가 걸리면
    모델이 스타일 지시보다 "찾은 내용을 보고하는" 기본 동작 쪽으로 쏠리는
    것으로 보임. 그래서 한 호출로 다 시키는 대신 2단계로 분리함:
    ① `_run_web_search()` - 웹검색 도구로 원시 조사 결과만 받는다(언어·
    형식 신경 안 씀, "NONE"이면 조사할 내용 없음). ② `_rewrite_currency_review()` -
    검색 도구 없는 일반 호출로 그 원시 결과를 한국어 요약 의견으로 다시
    쓴다(도구 없는 순수 지시 따르기 호출이라 스타일 지시가 안정적으로
    지켜짐). 이 김에 검색 단계의 입력도 슬라이드 전체 텍스트 대신
    `core.structure_review`(이미 만들어진 짧은 요약)로 바꿔서, 핵심 평가
    직후 전체 텍스트를 또 보내다 TPM 한도에 걸리던 문제도 같이 줄임.
- **DB**: `lecture_evaluations` 테이블(`DB구조.sql` 6-1번 섹션) 신규 생성
  완료(2026-08-02, 사용자가 직접 Supabase SQL Editor에서 실행). 컬럼:
  `evidence_basis`(근거 스냅샷) · `structure_review` · `learner_signal_review`
  (nullable) · `currency_review`(nullable) · `suggestions`(jsonb 배열) ·
  `data_coverage`(`slide_only`/`slide_and_signals`). `unpublishLecture()`에도
  정리 로직 추가(`deleteLectureEvaluationForKeyword`, 설문·슬라이드본문·
  가상질문 삭제와 같은 시점).
- **미확인 항목**: 위 웹검색 동작 확인 외에, Cloud Run 배포 후 실기기로
  캐시 확인 → 생성(경과시간 표시) → 결과 모달 표시 → 다시 평가 전체 흐름
  확인 필요(다른 AI 기능들처럼 이 세션에서는 코드 작성까지만 완료).

### 미착수
- `system-c-excel` 프로젝트 자체가 아직 생성 안 됨.
- 강의자료 요약(1페이지), 이해도 보고서 — 미구현(계획 단계, 위 "기능별
  ai-server 엔드포인트 현황" 표 참고). 실시간 설문·시험문제 생성·가상질문
  생성·강의자료 평가는 구현 완료.

---

## 실행/배포 시 주의사항

1. **HtmlService 페이지 내 링크는 상대경로로 쓰면 안 됨.**
   웹앱 화면은 실제로 `script.googleusercontent.com`의 iframe 안에서 렌더링되므로
   `href="?page=help"` 같은 상대경로는 그 iframe 주소 기준으로 풀려 엉뚱한 곳으로
   간다(새 탭은 뜨는데 내용이 빔). **`doGet`에서 `ScriptApp.getService().getUrl()`
   로 얻은 절대 URL을 템플릿 변수로 넘겨(`tpl.baseUrl = ...`) `<?= baseUrl ?>`로
   써야** 정상 동작한다. (system-b-dashboard의 `Dashboard.html`/`Help.html`에 이미
   적용됨 — 새 화면 추가 시 같은 패턴을 따를 것.)
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
   시스템 B가 `PublishEngine`을 GAS 라이브러리로 단순 추가해서 부르는 방식이면,
   게시엔진 코드는 게시엔진 소유자가 아니라 **강사 본인의 Drive 권한**으로 실행
   된다. 공유 드라이브 관리자 권한이 필요한 동작(슬라이드 공유 설정 등)을
   게시엔진이 실제로 수행해야 한다면, 이 방식으로는 강사 계정에 권한이 없어
   실패할 수 있다 — 그 경우 게시엔진을 별도로 "관리자 실행" 웹앱/API 실행형으로
   배포해두고 `UrlFetchApp`으로 호출하는 방식으로 바꿔야 한다(아직 미결정 사항,
   배포 기능 실제 구현 시 다시 검토).
5. **배포 시스템별 실행/접근 조합 (설계 확정값)**

   | 시스템 | 실행(executeAs) | 접근(access) | 이유 |
   |---|---|---|---|
   | 시스템 A (뷰어) | 나(관리자, `USER_DEPLOYING`) | 모든 사용자(`ANYONE`/`ANYONE_ANONYMOUS`) | 수강생 로그인 없이 열람해야 함 |
   | 시스템 B (대시보드) | 액세스하는 사용자(`USER_ACCESSING`) | 조직 내(`DOMAIN`) | 강사 본인 권한으로 실행, 사내 인증 필요 |
   | 시스템 C (엑셀분석) | 액세스하는 사용자(`USER_ACCESSING`) | 조직 내(`DOMAIN`) | 시스템 B와 동일 원칙 |

6. **[알려진 문제] 모바일/태블릿에서 구글 계정이 여러 개(사내 관리자 계정 + 외부
   계정) 동시 로그인돼 있으면 시스템 A(공개 뷰어)가 접속 안 됨.**
   2026-07-30 실기기 테스트로 확인(다른 직원 계정으로 검증):
   - 내부(관리자) 계정 단독 로그인: 대시보드 접근 가능(뷰어는 해당 없음)
   - **내부(관리자) + 외부 계정 동시 로그인: 대시보드는 접근 가능, 뷰어는 접근 불가**
   - 외부 계정만 로그인 / 로그인 없음: 뷰어 접근 가능
   - PC에서 내부 직원이 대시보드에 처음 접속할 때는 권한 승인이 1회 필요하고,
     그 후로는 기기 무관하게 대시보드 접근 가능.
   - **원인**: 코드 문제가 아니라 Google Apps Script 자체의 알려진 제약(여러
     구글 계정이 동시 로그인된 브라우저에서 `script.google.com/macros/.../exec`
     요청 시 계정 컨텍스트 충돌로 접속이 막힘 - Google 이슈트래커·커뮤니티에
     다수 보고됨, `ANYONE_ANONYMOUS` 설정 여부와 무관).
   - **`/a/gmail.com/` URL 우회법 — 실기기 검증 결과 효과 없음(기각)**: exec URL의
     `/macros/` 앞에 `/a/gmail.com/`을 끼워 넣는 커뮤니티 우회법을 실기기로
     시도했으나 결과가 그대로였음(된 곳은 계속 되고, 안 되는 곳은 계속 안 됨).
     계정 선택 UI 충돌 문제가 아니라는 뜻 — 이 방법은 채택하지 않음.
   - **2026-07-30 후속 관찰(상황 반전)**: 관리자 본인 소유 기기(아이패드·갤럭시폰,
     회사계정+개인계정 동시 로그인)에서는 어느 순간부터 대시보드·공개뷰어 모두
     정상 접속됨. 반면 **다른 직원**의 기기(회사계정+개인계정 동시 로그인)는
     증상 그대로(뷰어만 계속 막힘). 즉 "여러 계정 동시 로그인" 자체보다는
     **누구의 계정이냐(관리자 vs 일반 직원)** 또는 **어느 계정이 브라우저에서
     현재 활성 계정인지**가 진짜 변수일 가능성이 있음.
   - **가설 기각(2026-07-30)**: "워크스페이스 관리자 계정은 조직 보안 정책에서
     예외 처리되는 것 아니냐"는 가설을 세웠으나, 확인 결과 개발자 본인 계정과
     테스트한 직원 계정 **둘 다 구글 워크스페이스 관리자가 아님**(admin.google.com
     기준). 둘의 차이는 공유 드라이브 안에서의 파일 권한 등급(관리자/콘텐츠
     관리자)뿐인데, 이건 Drive ACL이라 exec URL 인증 흐름과는 무관할 가능성이
     높음 — 이 가설은 폐기.
   - **다음 유력 가설**: 권한 문제가 아니라 **개발자 계정이 이 Apps Script
     프로젝트들(publish-engine/system-a-viewer/system-b-dashboard)의 실제
     소유자·편집자라서 `script.google.com` 도메인과 이미 여러 번 인증된 세션/
     캐시 이력이 쌓여 있는 것** 아니냐는 쪽으로 무게 이동. 즉 계정 "권한"이
     아니라 브라우저 세션·쿠키 이력 문제일 가능성.
   - **단일 계정/무로그인 상태는 처음부터 지금까지 일관되게 항상 정상 접속됨**
     (계정 1개만 로그인 또는 로그인 없음 → 뷰어가 한 번도 안 막힌 적 없음,
     2026-07-30 재확인). 즉 문제는 "계정 존재 여부"가 아니라 **정확히 두 계정이
     동시 로그인된 상태**에서만 발생하고, 그 상태 안에서 기기/계정마다 결과가
     갈림 — 단일 계정 분리 테스트는 완료로 간주.
   - **다음 확인 단계(아직 실행 전)**: (1) 두 계정이 동시 로그인된 상태에서
     어느 계정이 브라우저 상단에 "현재 활성 계정"으로 표시되는지 로그인 순서를
     바꿔가며 기록, (2) 문제 재현되는 직원 기기에서 두 계정이 정상 로그인된
     채로 시크릿/비공개 모드 탭으로 뷰어 링크를 열어 결과 비교(세션·쿠키
     문제인지 계정 자체 문제인지 분리).

