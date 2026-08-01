-- ============================================================
--  DB구조.sql — 실시간 설문·슬라이드 본문 텍스트 Supabase PostgreSQL 스키마
-- ============================================================
--  대상: Supabase 프로젝트(SUPABASE_URL/SUPABASE_KEY, publish-engine의
--        스크립트 속성에 등록되어 있음). 이 파일을 Supabase SQL Editor에서
--        그대로 실행하면 테이블·인덱스·RLS·함수가 모두 생성된다.
--
--  접근 경로: 강사 대시보드(시스템 B)·수강생 뷰어(시스템 A)는 이 테이블을
--  직접 만지지 않는다. 둘 다 GAS 라이브러리 publish-engine/Survey.js를
--  통해서만 접근하고, Survey.js가 SUPABASE_KEY(service_role)로 REST API를
--  호출한다. RLS는 anon/authenticated 키가 혹시라도 유출됐을 때를 대비한
--  방어선이며, service_role 키는 RLS를 항상 우회하므로 정상 동작에는
--  영향이 없다.
--
--  설계 원칙
--  1) 라이브 데이터(진행 중 문제·임시답변)도 Supabase에 둔다 - 대시보드와
--     뷰어는 서로 다른 GAS 배포라 CacheService를 공유할 수 없기 때문.
--  2) 작업용 테이블(survey_temp_questions, survey_temp_answers)과 영구 테이블
--     (survey_results)을 분리한다.
--  3) "작업 테이블에 남은 행 = 항상 미완료분"이라는 불변식을 지킨다.
--     정상 종료된 설문은 finalize_survey() 한 트랜잭션으로 결과 저장과
--     동시에 즉시 삭제된다.
--  4) 방치된 설문 정리는 스케줄러 없이, 새 문제를 공개하는 시점에
--     "하루(24시간) 이상 지난 미완료분만" 지운다. started_at 시간 조건만
--     보므로 동시에 여러 강사가 설문을 진행해도 서로의 진행 중인 설문을
--     건드리지 않는다(강사 식별자 불필요).
--  5) 검색·평가 축은 강사 단위가 아니라 강의 키워드(lecture_keyword)다.
-- ============================================================


-- ============================================================
-- 1. 설문 문제 임시 테이블 (라이브·작업용)
--    "학생들에게 공개" 시 1행 INSERT.
--    이 테이블에 남아 있는 행은 항상 "아직 안 끝난" 설문이다 — 정상
--    종료분은 finalize_survey()가 결과로 옮긴 뒤 바로 삭제한다.
-- ============================================================
create table survey_temp_questions (
  id              bigserial primary key,
  access_key      varchar(8)  not null,        -- 학생 배포용 고유키 (영소문자+숫자 4자리, 헷갈리는 o/l/0/1 제외)
  lecture_keyword text        not null,         -- 강의 키워드 (평가·검색 축)
  question_text   text        not null,
  question_type   varchar(20) not null
                  check (question_type in ('multiple_choice','short_answer','opinion')),
  options         jsonb,                        -- 객관식 보기 배열(문자열 목록). 그 외 타입은 null
  correct_answers text[],                        -- 정답들(객관식·단답형, 쉼표 입력을 배열로 저장).
                                                  -- 의견형은 채점하지 않으므로 항상 null
  status          varchar(20) not null default 'active'
                  check (status in ('active','ended')),
  started_at      timestamptz not null default now(),  -- 경과시간 계산 기준 + 방치 판정 기준
  ended_at        timestamptz
);

-- 활성 문제끼리만 고유키가 겹치지 않으면 된다(종료·삭제된 키는 재사용 가능).
create unique index uq_survey_active_key
  on survey_temp_questions (access_key) where status = 'active';

-- 정리 쿼리(아래 단계 0)가 started_at으로 훑으므로 인덱스를 걸어둔다.
create index idx_survey_temp_questions_started_at on survey_temp_questions (started_at);


-- ============================================================
-- 2. 답변 임시 테이블 (라이브·임시)
--    학생이 전송한 답변이 쌓인다. 문제가 삭제되면(cascade) 함께 사라진다.
--    학생 식별·중복 제출 방지는 하지 않는다(요구사항에 없음 - 간단하게).
-- ============================================================
create table survey_temp_answers (
  id            bigserial primary key,
  question_id   bigint      not null references survey_temp_questions(id) on delete cascade,
  answer_text   text        not null,
  submitted_at  timestamptz not null default now()
);

create index idx_survey_temp_answers_question on survey_temp_answers (question_id);


-- ============================================================
-- 3. 설문 결과 테이블 (영구) — 정상 종료된 문제 1건당 결과 1건.
--    강의별 자료 평가에 사용(lecture_keyword로 조회).
-- ============================================================
create table survey_results (
  id                  bigserial primary key,
  lecture_keyword     text        not null,      -- 강의 평가 연결 키
  question_text       text        not null,
  question_type       varchar(20) not null,
  options             jsonb,                      -- 객관식 보기 스냅샷
  correct_answers     text[],
  total_responses     int         not null default 0,

  -- 객관식·단답형 채점 결과 (의견형은 전부 null)
  correct_count       int,
  accuracy_rate       numeric(5,2),               -- 정답률(%)
  answer_distribution jsonb,                       -- 제출답안별 통계(막대그래프용)

  -- 의견형 결과 (객관식·단답형은 전부 null)
  -- OpenAI 요약이 실패했을 때도 결과 저장 자체는 항상 성공해야 하므로,
  -- opinion_summary만 null로 두고 opinion_raw(원본 답변)는 그대로 남긴다.
  -- 화면에서는 summary가 없으면 opinion_raw를 그대로 보여준다.
  opinion_summary     text,
  opinion_raw         jsonb,

  saved_at            timestamptz not null default now()
);

create index idx_survey_results_keyword on survey_results (lecture_keyword);


-- answer_distribution 형태 (막대그래프에 그대로 대응, 비율은 미리 계산해서 저장):
-- [
--   {"label": "파이썬", "count": 12, "ratio": 60.0, "is_correct": true},
--   {"label": "자바",  "count": 5,  "ratio": 25.0, "is_correct": false}
-- ]


-- ============================================================
-- 4. 슬라이드 본문 텍스트 테이블 — 강의 요약·챗봇·강의자료평가·시험문제
--    생성에 쓸 원문. survey_results와 달리 "누적"이 아니라 "현재 슬라이드의
--    스냅샷"이다 — 슬라이드가 교체되면 이전 내용을 지우고 새로 채운다
--    (목차데이터 폴더의 키워드.json과 같은 성격).
--
--    저장 시점(키워드 기준):
--    - 새 강의 등록(publishLecture, 신규): 전체 추출 → INSERT
--    - 배포 수정 + URL 변경(재배포): 그 키워드의 기존 행 전부 DELETE →
--      새 슬라이드 기준으로 재추출 → INSERT (목차 재추출과 같은 타이밍)
--    - 배포 수정 + 제목만 수정(updateLectureTitle): 슬라이드 내용 자체는
--      안 바뀌므로 재추출하지 않음(목차 재추출 안 하는 것과 동일 정책)
--    - 강의 완전 삭제(unpublishLecture): 그 키워드의 행 전부 DELETE
--      (survey_temp_questions·survey_results와 같은 시점에 정리)
-- ============================================================
create table slide_contents (
  id            bigserial primary key,
  lecture_keyword text      not null,   -- 강의 키워드 (조회·삭제 축)
  slide_index   int         not null,   -- 원본 슬라이드 순서(재번호 없음, 목차 index와 동일 기준)
  object_id     text        not null,   -- 슬라이드 objectId(목차 데이터의 objectId와 매칭용)
  slide_text    text        not null default '',  -- 슬라이드 내 텍스트 도형을 전부 이어붙인 본문
  extracted_at  timestamptz not null default now()
);

-- 한 번의 추출 배치 안에서 슬라이드 중복 삽입을 막는 안전장치
create unique index uq_slide_contents_keyword_index
  on slide_contents (lecture_keyword, slide_index);

-- 강의 요약·챗봇 등에서 키워드 기준으로 전체 조회할 때 쓰는 인덱스
create index idx_slide_contents_keyword on slide_contents (lecture_keyword);


-- ============================================================
-- 5. 가상질문 페르소나 정의 테이블 — "가상질문 생성" 기능이 쓰는 학생
--    페르소나(성격·행동양식·이해도)를 코드가 아니라 데이터로 관리한다.
--    페르소나 개수·성격은 나중에 바뀔 가능성이 높다는 전제 — 새 페르소나가
--    필요하면 이 테이블에 행을 하나 추가하기만 하면 되고(코드·스키마 변경
--    불필요), 기존 페르소나를 없애고 싶으면 삭제 대신 active=false로
--    바꿔서 화면 선택지에서만 숨긴다(과거에 그 페르소나로 생성된
--    virtual_questions 행이 FK로 참조 중이라 삭제하면 끊어짐).
-- ============================================================
create table virtual_question_personas (
  persona_id    text primary key,        -- 영문 코드(예: beginner) - ai-server/GAS가 이 값으로 조회
  name          text not null,           -- 강사 화면에 보여줄 이름(예: "초심자")
  description   text not null,           -- 선택 화면에 보여줄 한 줄 소개
  prompt        text not null,           -- AI에게 줄 상세 지시문(성격·행동양식·이해도)
  display_order int  not null default 0, -- 화면에 보여줄 순서
  active        boolean not null default true,  -- false면 선택 화면에서 숨김(삭제 아님)
  created_at    timestamptz not null default now()
);

-- 초기 페르소나 4종 시드 데이터. 나중에 추가/수정은 이 INSERT를 다시
-- 쓸 필요 없이 Supabase 테이블 편집기나 별도 SQL로 행만 추가/수정하면 됨.
insert into virtual_question_personas (persona_id, name, description, prompt, display_order) values
('beginner', '초심자',
 '이 분야 사전지식이 없고 용어·개념이 생소한 학습자',
 '당신은 이 과목을 처음 배우는 성인 학습자입니다. 관련 사전지식이 전혀 없고 전문 용어나 개념이 낯섭니다. 성격은 신중하고 꼼꼼하며, 모르는 용어가 나오면 그냥 넘어가지 못하고 다소 불안해하는 편입니다. 기본적인 용어의 뜻이나 "이게 왜 필요한지" 같은 근본적인 질문을 주로 하고, 앞에서 나온 개념과 지금 개념을 스스로 연결짓지 못해 "이게 아까 그거랑 같은 건가요?" 같은 질문도 합니다.',
 1),
('casual', '비전공, 따라가는 중',
 '비전공이지만 관심이 많고 그럭저럭 수업을 따라가는 학습자',
 '당신은 비전공자이지만 이 분야에 관심이 많고 독학 경험이 약간 있는 성인 학습자입니다. 큰 흐름은 이해하지만 세부 내용에서 막히곤 합니다. 성격은 적극적이고 실용적이라 "이걸 어디에 쓰는지"를 궁금해합니다. 개념 자체보다는 세부 적용이나 예외 상황("이 경우엔 어떻게 되나요?")을 주로 묻습니다.',
 2),
('major_theory', '전공 이론파',
 '관련 전공자이지만 실무 경험은 없고 이론적 이해도가 높은 학습자',
 '당신은 이 분야를 전공했지만 실무 경험은 없는 성인 학습자입니다. 이론적 배경이 탄탄해서 기본 개념 질문은 거의 하지 않습니다. 성격은 분석적이고 완벽주의 성향이 있어 개념 간 논리적 정합성을 따집니다. "왜 이렇게 설계되었는지", "다른 방식과의 차이가 뭔지" 같은 원리·근거를 캐묻는 질문을 주로 하며, 질문 빈도는 낮지만 깊이가 있습니다.',
 3),
('major_practice', '실무 경험자',
 '짧지만 관련 실무·프로젝트 경험이 있는 학습자',
 '당신은 관련 분야에서 짧지만 실제 프로젝트나 업무 경험이 있는 성인 학습자입니다. 실무적으로는 이해도가 높지만 이론적 배경에는 구멍이 있을 수 있습니다. 성격은 현실적이고 실전 지향적이라 강의 내용을 항상 실무 사례와 연결지어 생각합니다. "실제로는 이렇게 안 되던데 왜 그런가요?", "현업에서는 이걸 어떻게 처리하나요?" 같은 실무 적용·예외 상황 질문을 주로 합니다.',
 4);


-- ============================================================
-- 6. 가상질문 생성 결과 테이블 (영구) — "가상질문 생성" 기능(강의자료를
--    페르소나 학생 입장에서 읽으며 궁금한 점을 AI로 뽑아내는 기능)의
--    결과. slide_contents와 같은 스냅샷 성격 — 키워드+페르소나 조합당
--    최신 결과 1건만 유지하고, "다시 생성"을 누르면 덮어쓴다(히스토리
--    누적 안 함).
-- ============================================================
create table virtual_questions (
  id              bigserial primary key,
  lecture_keyword text  not null,        -- 강의 키워드 (조회 축)
  persona_id      text  not null references virtual_question_personas(persona_id),
  questions       jsonb not null,         -- 필터링된 최종 질문 목록
                                          -- [{"batch": "초반|중반|후반", "question": "..."}, ...]
  generated_at    timestamptz not null default now()
);

-- 키워드+페르소나 조합당 1건만 유지("다시 생성"은 이 조합 기준 UPSERT).
-- lecture_keyword로 시작하는 복합 인덱스라 키워드만으로 조회할 때도
-- (강의 하나의 4개 페르소나 결과를 한 번에 볼 때) 그대로 활용된다 —
-- 별도의 단일 컬럼 인덱스는 두지 않는다.
create unique index uq_virtual_questions_keyword_persona
  on virtual_questions (lecture_keyword, persona_id);


-- ============================================================
-- 7. RLS — anon/authenticated 키가 유출돼도 접근 불가능하도록 기본 차단.
--    정책을 하나도 만들지 않으면 anon/authenticated 롤은 전부 거부되고,
--    GAS가 쓰는 service_role 키는 RLS를 항상 우회하므로 정상 동작에는
--    아무 영향이 없다(이중 방어 목적).
-- ============================================================
alter table survey_temp_questions     enable row level security;
alter table survey_temp_answers       enable row level security;
alter table survey_results            enable row level security;
alter table slide_contents            enable row level security;
alter table virtual_question_personas enable row level security;
alter table virtual_questions         enable row level security;


-- ============================================================
-- 8. 함수
-- ============================================================

-- ------------------------------------------------------------
-- submit_survey_answer(qid, answer)
--   학생 답변 제출을 원자적으로 처리한다: 문제가 활성 상태일 때만
--   삽입하고, 성공 여부를 boolean으로 돌려준다. "조회 후 삽입" 2단계로
--   나누면 그 사이에 강사가 종료 처리를 할 수 있으므로(경쟁 상태),
--   한 함수(트랜잭션) 안에서 조건부 삽입을 처리한다.
-- ------------------------------------------------------------
create or replace function submit_survey_answer(p_question_id bigint, p_answer text)
returns boolean
language plpgsql
as $$
begin
  insert into survey_temp_answers (question_id, answer_text)
  select p_question_id, p_answer
  where exists (
    select 1 from survey_temp_questions
    where id = p_question_id and status = 'active'
  );

  return found;  -- 삽입됐으면 true(활성), 안 됐으면 false(없는 키/이미 종료)
end;
$$;


-- ------------------------------------------------------------
-- finalize_survey(qid, result)
--   설문종료 처리의 마지막 단계. GAS(시스템 B)가 채점/집계(객관식·단답형)
--   또는 OpenAI 요약(의견형, ai-server의 POST /opinion-summary 경유)을
--   마친 뒤 그 결과(jsonb)를 담아 이 함수를 1회 호출한다.
--
--   결과 저장(survey_results INSERT)과 작업 테이블 정리(survey_temp_questions
--   DELETE, 임시답변은 cascade)를 한 트랜잭션으로 묶어, "결과는 저장됐는데
--   문제가 안 지워짐" 같은 어긋난 상태가 생기지 않게 한다. 이 덕분에 위
--   "작업 테이블에 남은 행 = 항상 미완료분" 불변식이 항상 유지된다.
--
--   question_text/question_type/options/correct_answers/lecture_keyword는
--   survey_temp_questions 원본 행에서 그대로 가져온다(GAS가 중복으로 다시
--   보낼 필요 없음) - GAS는 계산으로 나온 통계/요약만 p_result로 보낸다.
--
--   p_result 예시(객관식·단답형):
--     {"total_responses": 20, "correct_count": 15, "accuracy_rate": 75.0,
--      "answer_distribution": [...], "opinion_summary": null, "opinion_raw": null}
--   p_result 예시(의견형, OpenAI 요약 성공):
--     {"total_responses": 8, "correct_count": null, "accuracy_rate": null,
--      "answer_distribution": null,
--      "opinion_summary": "학생들은 대체로...", "opinion_raw": ["...", "..."]}
--   p_result 예시(의견형, OpenAI 요약 실패 - 원본 답변만 남김):
--     {"total_responses": 8, ..., "opinion_summary": null, "opinion_raw": ["...", "..."]}
-- ------------------------------------------------------------
create or replace function finalize_survey(p_question_id bigint, p_result jsonb)
returns void
language plpgsql
as $$
begin
  insert into survey_results (
    lecture_keyword, question_text, question_type, options, correct_answers,
    total_responses, correct_count, accuracy_rate, answer_distribution,
    opinion_summary, opinion_raw
  )
  select
    q.lecture_keyword, q.question_text, q.question_type, q.options, q.correct_answers,
    coalesce((p_result->>'total_responses')::int, 0),
    (p_result->>'correct_count')::int,
    (p_result->>'accuracy_rate')::numeric,
    p_result->'answer_distribution',
    p_result->>'opinion_summary',
    p_result->'opinion_raw'
  from survey_temp_questions q
  where q.id = p_question_id;

  delete from survey_temp_questions where id = p_question_id;
end;
$$;


-- ============================================================
-- 9. 처리 흐름 요약 (GAS publish-engine/Survey.js가 호출하는 순서)
-- ============================================================
-- [출제] 강사가 "학생들에게 공개" 클릭
--   0) DELETE FROM survey_temp_questions WHERE started_at < now() - interval '1 day';
--      (하루 이상 지난 미완료분 정리 - 임시답변은 cascade로 함께 삭제)
--   1) 영문소문자+숫자 고유키 생성 → INSERT INTO survey_temp_questions (...)
--      (활성 키 충돌 시 새 키로 재시도, uq_survey_active_key가 막아줌)
--
-- [응답] 학생이 고유키 입력 → 문제 조회
--   2) SELECT ... FROM survey_temp_questions WHERE access_key = :key AND status = 'active';
--      (0행이면 "답변할 문제가 없습니다" — 없는 키/종료된 키를 구분하지 않음)
--
-- [제출] 학생이 답 전송
--   3) SELECT submit_survey_answer(:question_id, :answer);
--      (false면 "이미 종료됨" — 화면에는 2번과 같은 안내)
--
-- [종료] 강사가 "설문종료" 클릭
--   4) UPDATE survey_temp_questions SET status='ended', ended_at=now() WHERE id=:qid;
--      (이 순간부터 2, 3번이 모두 막힘)
--   5) GAS: 임시답변 조회 → 객관식/단답형은 채점·집계, 의견형은 ai-server로
--      요약 시도(실패해도 원본 답변은 그대로 보존 - 재시도 불필요)
--      → 여기서는 아직 저장하지 않고 결과 모달만 띄운다.
--
-- [표시] 강사 화면에 결과 모달(객관식·단답형은 막대그래프, 의견형은 요약/원문).
--        강사가 아래 둘 중 하나를 선택해야 모달이 닫힌다:
--   6-a) [설문결과 저장] → SELECT finalize_survey(:qid, :result_json);
--        (결과 저장 + 작업 테이블 정리가 한 트랜잭션) → survey_results에
--        남으므로 강의 평가 시 lecture_keyword로 재조회 가능.
--   6-b) [결과를 저장하지 않고 종료] → DELETE FROM survey_temp_questions WHERE id=:qid;
--        (임시답변은 cascade 삭제) → 결과는 어디에도 남지 않음.
-- ============================================================
