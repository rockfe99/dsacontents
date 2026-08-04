"""
Supabase(PostgREST) 읽기 전용 클라이언트 — 슬라이드 본문(slide_contents),
페르소나·가상질문(virtual_question_personas, virtual_questions), 설문 결과
(survey_results) 조회를 담당한다. 쓰기는 하지 않는다(결과 저장은 GAS 쪽
publish-engine이 맡는다).

publish-engine/Survey.js의 supabaseRequest_()와 같은 REST 규약(apikey/Authorization
헤더, {SUPABASE_URL}/rest/v1/{path})을 그대로 따른다. SUPABASE_KEY는 GAS 쪽과 동일한
service_role 키 값을 이 서버의 환경변수로도 등록해서 쓴다(GAS 스크립트 속성과
Cloud Run 환경변수는 별도 저장소라 각각 등록해야 함).
"""

import os
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


# 환경변수 확인 - 이 모듈의 모든 조회 함수가 첫 줄에서 호출한다(미설정이면 RuntimeError → main.py가 500으로 변환).
def _require_config() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL/SUPABASE_KEY 환경변수가 설정되어 있지 않습니다.")


# PostgREST 공통 인증 헤더 조립 - 이 모듈의 모든 requests 호출이 그대로 쓴다.
def _headers() -> dict:
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


# 슬라이드 세그먼트 리스트를 프롬프트용 단일 텍스트로 변환 - main.py의 /exam-questions·/lecture-evaluation이 쓴다.
def join_slide_text(segments: list[dict]) -> str:
    """get_slide_segments()가 반환한 리스트를 [슬라이드 N] 텍스트로 이어붙인다.
    슬라이드 개수(len(segments))가 따로 필요한 호출부(강의자료 평가)는
    get_slide_segments()를 먼저 부르고 이 함수로 텍스트만 따로 만든다."""
    return "\n\n".join(
        f"[슬라이드 {row['slide_index']}]\n{row['slide_text']}" for row in segments
    )


# slide_contents 조회 - 세 엔드포인트(/exam-questions·/virtual-questions·/lecture-evaluation) 모두의 기본 근거 데이터.
def get_slide_segments(keyword: str) -> list[dict]:
    """키워드로 slide_contents를 슬라이드 순서대로 조회해 원본 리스트 그대로
    반환한다([{slide_index, slide_text}, ...]). 슬라이드 개수가 필요하거나
    구간을 나눠야 하는 호출부는 이 함수를 쓰고, 하나의 텍스트가 필요하면
    join_slide_text()로 이어붙인다."""
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/slide_contents"
    params = {
        "lecture_keyword": f"eq.{keyword}",
        "select": "slide_index,slide_text",
        "order": "slide_index",
    }

    res = requests.get(url, params=params, headers=_headers(), timeout=15)
    res.raise_for_status()
    return res.json()


# 페르소나 1건 조회(prompt 포함) - /virtual-questions가 LangGraph에 넘길 페르소나 프롬프트를 가져오는 통로.
def get_persona(persona_id: str) -> dict | None:
    """가상질문 생성용 학생 페르소나 1건을 조회한다(active=true인 것만).
    없거나 비활성화된 persona_id면 None."""
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/virtual_question_personas"
    params = {
        "persona_id": f"eq.{persona_id}",
        "active": "eq.true",
        "select": "persona_id,name,prompt",
    }

    res = requests.get(url, params=params, headers=_headers(), timeout=15)
    res.raise_for_status()
    rows = res.json()
    return rows[0] if rows else None


# 난이도(exam_level) 매칭 페르소나의 가상질문만 모아 조회 - /exam-questions의 출제 참고자료 전용.
def get_virtual_questions(keyword: str, exam_level: str) -> list[dict]:
    """그 키워드로 생성되어 있는 가상질문 결과 중, 요청한 시험 난이도(exam_level)와
    매칭되는 페르소나(virtual_question_personas.exam_level)의 결과만 모아
    반환한다([{batch, question}, ...]). 시험문제 생성(/exam-questions)이
    "문제수준과 학생에이전트의 수준을 맞춰서" 참고자료로 쓴다.
    매칭되는 페르소나가 없거나 그 페르소나로 아직 가상질문을 생성하지 않았으면
    빈 리스트(레벨 안 맞는 참고자료를 섞어 쓰지 않는다 - 없으면 참고자료 없이 진행)."""
    _require_config()
    headers = _headers()

    persona_url = f"{SUPABASE_URL}/rest/v1/virtual_question_personas"
    persona_params = {"exam_level": f"eq.{exam_level}", "select": "persona_id"}
    persona_res = requests.get(persona_url, params=persona_params, headers=headers, timeout=15)
    persona_res.raise_for_status()
    persona_ids = [row["persona_id"] for row in persona_res.json()]
    if not persona_ids:
        return []

    url = f"{SUPABASE_URL}/rest/v1/virtual_questions"
    params = {
        "lecture_keyword": f"eq.{keyword}",
        "persona_id": f"in.({','.join(persona_ids)})",
        "select": "questions",
    }

    res = requests.get(url, params=params, headers=headers, timeout=15)
    res.raise_for_status()
    rows = res.json()

    flattened: list[dict] = []
    for row in rows:
        flattened.extend(row.get("questions") or [])
    return flattened


# 저장된 실시간 설문 결과 조회 - /lecture-evaluation의 "실제 학생 응답" 근거.
def get_survey_results(keyword: str) -> list[dict]:
    """그 키워드로 누적된 모든 실시간 설문 결과(finalize_survey()로 저장된 것만 -
    저장 안 하고 종료한 설문은 여기 없음)를 오래된 순으로 반환한다.
    강의자료 평가(/lecture-evaluation)가 "실제 학생 응답" 근거로 쓴다."""
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/survey_results"
    params = {
        "lecture_keyword": f"eq.{keyword}",
        "select": "question_text,question_type,total_responses,correct_count,accuracy_rate,opinion_summary",
        "order": "saved_at",
    }

    res = requests.get(url, params=params, headers=_headers(), timeout=15)
    res.raise_for_status()
    return res.json()


# 활성 페르소나 전원 + 해당 키워드의 가상질문을 "학생N(이름)" 라벨과 함께 조회 - /lecture-evaluation 전용.
def get_virtual_questions_by_persona(keyword: str) -> list[dict]:
    """활성 페르소나 전원을 display_order 순으로 반환하되, 그 키워드로 실제
    생성된 가상질문이 있으면 questions를 채우고 없으면 빈 리스트로 둔다.
    label은 CLAUDE.md 표시 규칙("학생N(이름)", N은 활성 페르소나 중 순서)을
    그대로 계산해서 넣어준다 - 강의자료 평가의 근거 표시·반응 검토가 이
    label을 그대로 쓴다(exam_level 필터링 없이 전체 참고 - 자료 평가는
    시험 난이도 개념이 없어서 특정 수준으로 좁힐 이유가 없다).
    반환: [{persona_id, label, questions}, ...]"""
    _require_config()
    headers = _headers()

    persona_url = f"{SUPABASE_URL}/rest/v1/virtual_question_personas"
    persona_params = {"active": "eq.true", "select": "persona_id,name", "order": "display_order"}
    persona_res = requests.get(persona_url, params=persona_params, headers=headers, timeout=15)
    persona_res.raise_for_status()
    personas = persona_res.json()

    vq_url = f"{SUPABASE_URL}/rest/v1/virtual_questions"
    vq_params = {"lecture_keyword": f"eq.{keyword}", "select": "persona_id,questions"}
    vq_res = requests.get(vq_url, params=vq_params, headers=headers, timeout=15)
    vq_res.raise_for_status()
    questions_by_persona = {row["persona_id"]: (row.get("questions") or []) for row in vq_res.json()}

    return [
        {
            "persona_id": p["persona_id"],
            "label": f"학생{i + 1}({p['name']})",
            "questions": questions_by_persona.get(p["persona_id"], []),
        }
        for i, p in enumerate(personas)
    ]
