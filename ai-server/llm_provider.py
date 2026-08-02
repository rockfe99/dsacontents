"""
LangChain 챗모델(OpenAI) 인스턴스 생성 - 기능(체인)마다 반복하지 않도록 한
곳에 모은다. 새 기능(강의자료 요약·이해도 보고서 등)을 추가할 때는 이 함수를
그대로 재사용한다.

모델 제공자는 OpenAI 하나로 통일한다. 모델을 바꾸고 싶으면 Cloud Run
환경변수 OPENAI_MODEL만 바꿔서 새 리비전을 배포하면 된다(코드 수정·재빌드
불필요).
"""

import os

from langchain_openai import ChatOpenAI

OPENAI_KEY = os.environ.get("OPENAI_KEY", "")
DEFAULT_MODEL = "gpt-4o"


def get_openai_llm(temperature: float = 0, timeout: float | None = None) -> ChatOpenAI:
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
    model_name = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    kwargs = {"model": model_name, "api_key": OPENAI_KEY, "temperature": temperature}
    if timeout is not None:
        kwargs["timeout"] = timeout
    return ChatOpenAI(**kwargs)


def get_web_search_llm(timeout: float = 25) -> ChatOpenAI:
    """OpenAI 내장 웹검색 도구(Responses API의 hosted web_search_preview)를 바인딩한
    인스턴스. 검색은 OpenAI 서버 쪽에서 알아서 수행되므로(클라이언트가 검색→재호출을
    반복하는 ReAct 루프를 직접 구현할 필요 없음) 호출부에서는 평소처럼 .invoke() 한
    번만 하면 된다. 강의자료 평가의 "AI 추가 의견"(최신 기술/버전 검토)에서만 쓰는
    부가 기능이라, 짧은 timeout을 기본값으로 둬서 오래 걸리면 호출부가 빨리 포기하고
    나머지 평가는 정상 진행할 수 있게 한다."""
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
    model_name = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    llm = ChatOpenAI(
        model=model_name,
        api_key=OPENAI_KEY,
        temperature=0,
        timeout=timeout,
        use_responses_api=True,
    )
    return llm.bind_tools([{"type": "web_search_preview"}])
