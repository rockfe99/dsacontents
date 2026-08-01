"""
LangChain 챗모델(OpenAI) 인스턴스 생성 - 기능(체인)마다 반복하지 않도록 한
곳에 모은다. 새 기능(강의자료 요약·이해도 보고서 등)을 추가할 때는 이 함수를
그대로 재사용한다.

모든 AI 기능은 OpenAI만 쓴다(Gemini는 더 이상 쓰지 않음). 모델을 바꾸고
싶으면 Cloud Run 환경변수 OPENAI_MODEL만 바꿔서 새 리비전을 배포하면 된다
(코드 수정·재빌드 불필요).
"""

import os

from langchain_openai import ChatOpenAI

OPENAI_KEY = os.environ.get("OPENAI_KEY", "")
DEFAULT_MODEL = "gpt-4o"


def get_openai_llm(temperature: float = 0) -> ChatOpenAI:
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
    model_name = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    return ChatOpenAI(model=model_name, api_key=OPENAI_KEY, temperature=temperature)
