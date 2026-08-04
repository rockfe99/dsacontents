"""
공유 비밀키(X-API-Key) 인증 - 모든 엔드포인트가 이 의존성을 통해 검증한다.
AI_MODE(기능 사용 가능 여부) 자체는 GAS(system-b-dashboard)가 호출 전에
isAiEnabled()로 이미 확인하므로, 여기서는 "GAS만 호출할 수 있는가"만 본다.
"""

import os

from fastapi import Header, HTTPException

AI_SERVER_KEY = os.environ.get("AI_SERVER_KEY", "")


# X-API-Key 헤더가 GAS와 공유하는 비밀키와 일치하는지 검증 - main.py의 모든 엔드포인트가 첫 줄에서 호출한다
# (환경변수 미설정 시에도 401 - 키가 없으면 아무도 호출 못 하는 쪽이 안전한 기본값).
def verify_api_key(x_api_key: str = Header(default="")) -> None:
    if not AI_SERVER_KEY or x_api_key != AI_SERVER_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")
