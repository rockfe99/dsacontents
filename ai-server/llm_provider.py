"""
LangChain 챗모델 인스턴스 생성 - 기능(체인)마다 반복하지 않도록 한 곳에 모은다.
새 기능(강의자료 요약·이해도 보고서 등)을 추가할 때는 이 함수를 그대로 재사용한다.

지원 제공자: 'gemini'(Google), 'chatgpt'(OpenAI).
'claude'가 필요해지면 langchain-anthropic을 requirements.txt에 추가하고
여기에 분기만 추가하면 된다.
"""

import os

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

GEMINI_KEY = os.environ.get("GEMINI_KEY", "")
GEMINI_MODEL_DEFAULT = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
OPENAI_KEY = os.environ.get("OPENAI_KEY", "")
OPENAI_MODEL_DEFAULT = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")


def get_llm(provider: str, model: str = None):
    """provider(+ 선택적으로 model 지정)로 LangChain 챗모델 인스턴스를 만든다."""
    if provider == "gemini":
        if not GEMINI_KEY:
            raise RuntimeError("GEMINI_KEY 환경변수가 설정되어 있지 않습니다.")
        return ChatGoogleGenerativeAI(model=model or GEMINI_MODEL_DEFAULT, google_api_key=GEMINI_KEY)
    if provider == "chatgpt":
        if not OPENAI_KEY:
            raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
        return ChatOpenAI(model=model or OPENAI_MODEL_DEFAULT, api_key=OPENAI_KEY)
    raise ValueError(f"아직 지원하지 않는 모델 제공자입니다: {provider}")
