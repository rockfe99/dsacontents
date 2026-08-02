"""
Supabase(PostgREST) 읽기 전용 클라이언트 — slide_contents·virtual_question_personas 조회 전용.

publish-engine/Survey.js의 supabaseRequest_()와 같은 REST 규약(apikey/Authorization
헤더, {SUPABASE_URL}/rest/v1/{path})을 그대로 따른다. SUPABASE_KEY는 GAS 쪽과 동일한
legacy JWT service_role 키 값을 이 서버의 환경변수로도 등록해서 쓴다.
"""

import os
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


def _require_config() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL/SUPABASE_KEY 환경변수가 설정되어 있지 않습니다.")


def _headers() -> dict:
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def get_slide_text(keyword: str) -> str:
    """키워드로 slide_contents를 슬라이드 순서대로 조회해 하나의 텍스트로 이어붙인다.
    시험문제 생성(/exam-questions)이 쓴다."""
    rows = get_slide_segments(keyword)
    return "\n\n".join(
        f"[슬라이드 {row['slide_index']}]\n{row['slide_text']}" for row in rows
    )


def get_slide_segments(keyword: str) -> list[dict]:
    """키워드로 slide_contents를 슬라이드 순서대로 조회해 원본 리스트 그대로
    반환한다([{slide_index, slide_text}, ...]). 가상질문 생성(/virtual-questions)이
    슬라이드를 Part 1/2/3 구간으로 나누는 데 쓴다."""
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
