-- ============================================================
--  DB구조.sql — 실시간 설문 기능 Supabase PostgreSQL 스키마
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
--  2) 작업용 테이블(survey_questions, survey_temp_answers)과 영구 테이블
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
-- 1. 설문 문제 테이블 (라이브·작업용)
--    "학생들에게 공개" 시 1행 INSERT.
--    이 테이블에 남아 있는 행은 항상 "아직 안 끝난" 설문이다 — 정상
--    종료분은 finalize_survey()가 결과로 옮긴 뒤 바로 삭제한다.
-- ============================================================
create table survey_questions (
  id              bigserial primary key,
  access_key      varchar(8)  not null,        -- 학생 배포용 고유키 (영대문자+숫자 6자리)
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
  on survey_questions (access_key) where status = 'active';

-- 정리 쿼리(아래 단계 0)가 started_at으로 훑으므로 인덱스를 걸어둔다.
create index idx_survey_questions_started_at on survey_questions (started_at);


-- ============================================================
-- 2. 답변 임시 테이블 (라이브·임시)
--    학생이 전송한 답변이 쌓인다. 문제가 삭제되면(cascade) 함께 사라진다.
--    학생 식별·중복 제출 방지는 하지 않는다(요구사항에 없음 - 간단하게).
-- ============================================================
create table survey_temp_answers (
  id            bigserial primary key,
  question_id   bigint      not null references survey_questions(id) on delete cascade,
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
  -- Gemini 요약이 실패했을 때도 결과 저장 자체는 항상 성공해야 하므로,
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
-- 4. RLS — anon/authenticated 키가 유출돼도 접근 불가능하도록 기본 차단.
--    정책을 하나도 만들지 않으면 anon/authenticated 롤은 전부 거부되고,
--    GAS가 쓰는 service_role 키는 RLS를 항상 우회하므로 정상 동작에는
--    아무 영향이 없다(이중 방어 목적).
-- ============================================================
alter table survey_questions    enable row level security;
alter table survey_temp_answers enable row level security;
alter table survey_results      enable row level security;


-- ============================================================
-- 5. 함수
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
    select 1 from survey_questions
    where id = p_question_id and status = 'active'
  );

  return found;  -- 삽입됐으면 true(활성), 안 됐으면 false(없는 키/이미 종료)
end;
$$;


-- ------------------------------------------------------------
-- finalize_survey(qid, result)
--   설문종료 처리의 마지막 단계. GAS(시스템 B)가 채점/집계(객관식·단답형)
--   또는 Gemini 요약(의견형, callAI_() 경유)을 마친 뒤 그 결과(jsonb)를
--   담아 이 함수를 1회 호출한다.
--
--   결과 저장(survey_results INSERT)과 작업 테이블 정리(survey_questions
--   DELETE, 임시답변은 cascade)를 한 트랜잭션으로 묶어, "결과는 저장됐는데
--   문제가 안 지워짐" 같은 어긋난 상태가 생기지 않게 한다. 이 덕분에 위
--   "작업 테이블에 남은 행 = 항상 미완료분" 불변식이 항상 유지된다.
--
--   question_text/question_type/options/correct_answers/lecture_keyword는
--   survey_questions 원본 행에서 그대로 가져온다(GAS가 중복으로 다시
--   보낼 필요 없음) - GAS는 계산으로 나온 통계/요약만 p_result로 보낸다.
--
--   p_result 예시(객관식·단답형):
--     {"total_responses": 20, "correct_count": 15, "accuracy_rate": 75.0,
--      "answer_distribution": [...], "opinion_summary": null, "opinion_raw": null}
--   p_result 예시(의견형, Gemini 성공):
--     {"total_responses": 8, "correct_count": null, "accuracy_rate": null,
--      "answer_distribution": null,
--      "opinion_summary": "학생들은 대체로...", "opinion_raw": ["...", "..."]}
--   p_result 예시(의견형, Gemini 실패 - 원본 답변만 남김):
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
  from survey_questions q
  where q.id = p_question_id;

  delete from survey_questions where id = p_question_id;
end;
$$;


-- ============================================================
-- 6. 처리 흐름 요약 (GAS publish-engine/Survey.js가 호출하는 순서)
-- ============================================================
-- [출제] 강사가 "학생들에게 공개" 클릭
--   0) DELETE FROM survey_questions WHERE started_at < now() - interval '1 day';
--      (하루 이상 지난 미완료분 정리 - 임시답변은 cascade로 함께 삭제)
--   1) 영문대문자+숫자 고유키 생성 → INSERT INTO survey_questions (...)
--      (활성 키 충돌 시 새 키로 재시도, uq_survey_active_key가 막아줌)
--
-- [응답] 학생이 고유키 입력 → 문제 조회
--   2) SELECT ... FROM survey_questions WHERE access_key = :key AND status = 'active';
--      (0행이면 "답변할 문제가 없습니다" — 없는 키/종료된 키를 구분하지 않음)
--
-- [제출] 학생이 답 전송
--   3) SELECT submit_survey_answer(:question_id, :answer);
--      (false면 "이미 종료됨" — 화면에는 2번과 같은 안내)
--
-- [종료] 강사가 "설문종료" 클릭
--   4) UPDATE survey_questions SET status='ended', ended_at=now() WHERE id=:qid;
--      (이 순간부터 2, 3번이 모두 막힘)
--   5) GAS: 임시답변 조회 → 객관식/단답형은 채점·집계, 의견형은 callAI_()로
--      요약 시도(실패해도 원본 답변은 그대로 보존 - 재시도 불필요)
--   6) SELECT finalize_survey(:qid, :result_json);
--      (결과 저장 + 작업 테이블 정리가 한 트랜잭션)
--
-- [표시] 강사 화면에 결과 모달(객관식·단답형은 막대그래프, 의견형은 요약/원문)
--        닫으면 다시 못 보는 일회성 모달이지만, 데이터는 survey_results에
--        남아 있으므로 강의 평가 시 lecture_keyword로 재조회 가능.
-- ============================================================
