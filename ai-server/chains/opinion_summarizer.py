"""
실시간 설문 의견형 결과 요약 - 학생 답변 원문(이미 구분자로 합쳐진 문자열)을
받아 전반적인 분위기·다수의견·특이사항을 한국어로 요약하는 LangChain 체인.
exam_generator.py와 동일한 구조(프롬프트 템플릿 + LLM 인스턴스 함수)를 따른다.
"""

import os

from langchain_openai import ChatOpenAI

OPENAI_KEY = os.environ.get("OPENAI_KEY", "")
MODEL_NAME = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

_PROMPT_TEMPLATE = """당신은 수업 중 진행된 실시간 설문의 의견형 답변을 요약하는
보조 교사입니다.

[질문]
{question_text}

[학생 답변 - 각 답변은 "---" 로 구분됨]
{answers_text}

[요청]
- 전반적인 분위기, 다수 의견, 특이사항(소수지만 눈에 띄는 의견)을 구분해
  한국어로 간결하게 요약하세요.
- 답변에 없는 내용을 추측해서 덧붙이지 마세요.
- 3~5문장 정도의 자연스러운 문단으로 작성하세요.
"""


def _get_llm() -> ChatOpenAI:
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
    return ChatOpenAI(model=MODEL_NAME, api_key=OPENAI_KEY)


def summarize(question_text: str, answers_text: str) -> str:
    llm = _get_llm()
    prompt = _PROMPT_TEMPLATE.format(
        question_text=question_text, answers_text=answers_text
    )
    result = llm.invoke(prompt)
    return result.content
