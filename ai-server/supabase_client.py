"""
Supabase(PostgREST) 읽기 전용 클라이언트 — slide_contents 조회 전용.

publish-engine/Survey.js의 supabaseRequest_()와 같은 REST 규약(apikey/Authorization
헤더, {SUPABASE_URL}/rest/v1/{path})을 그대로 따른다. SUPABASE_KEY는 GAS 쪽과 동일한
legacy JWT service_role 키 값을 이 서버의 환경변수로도 등록해서 쓴다.
"""

import os
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


def get_slide_text(keyword: str) -> str:
    """키워드로 slide_contents를 슬라이드 순서대로 조회해 하나의 텍스트로 이어붙인다."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL/SUPABASE_KEY 환경변수가 설정되어 있지 않습니다.")

    url = f"{SUPABASE_URL}/rest/v1/slide_contents"
    params = {
        "lecture_keyword": f"eq.{keyword}",
        "select": "slide_index,slide_text",
        "order": "slide_index",
    }
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    res = requests.get(url, params=params, headers=headers, timeout=15)
    res.raise_for_status()
    rows = res.json()

    return "\n\n".join(
        f"[슬라이드 {row['slide_index']}]\n{row['slide_text']}" for row in rows
    )
