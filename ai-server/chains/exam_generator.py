"""
슬라이드 본문 텍스트를 근거로 시험문제를 생성하는 LangChain 체인.
구조화 출력(with_structured_output)을 써서 프리폼 텍스트 파싱 없이 안정적으로
파싱 가능한 형태로 결과를 받는다.
"""

import os
from typing import Literal, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

GEMINI_KEY = os.environ.get("GEMINI_KEY", "")
MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")


class ExamQuestion(BaseModel):
    question_text: str = Field(description="문제 본문")
    options: Optional[list[str]] = Field(
        default=None, description="객관식 보기 목록(단답형은 null)"
    )
    correct_answer: str = Field(description="정답(객관식은 보기 텍스트 그대로)")


class ExamQuestionList(BaseModel):
    questions: list[ExamQuestion]


_PROMPT_TEMPLATE = """당신은 아래 강의 슬라이드 내용을 바탕으로 시험문제를 만드는 출제자입니다.

[슬라이드 내용]
{slide_text}

[요청]
- 문제 유형: {question_type_label}
- 문제 개수: {count}개
- 슬라이드 내용에 실제로 나온 내용만 근거로 출제하세요.
- 한국어로 작성하세요.
{type_instruction}
"""

_TYPE_LABELS = {
    "multiple_choice": "객관식(4지선다)",
    "short_answer": "단답형",
}

_TYPE_INSTRUCTIONS = {
    "multiple_choice": "- 각 문제마다 보기를 4개 만들고, correct_answer에는 정답 보기의 텍스트를 그대로 넣으세요.",
    "short_answer": "- options는 비워두고(null), correct_answer에 정답 단어/구절만 넣으세요.",
}


def _get_llm(provider: str):
    """provider 이름으로 LangChain 챗모델 인스턴스를 만든다.
    지금은 'gemini'만 실제 지원 - 'chatgpt'/'claude'는 나중에 langchain-openai/
    langchain-anthropic을 추가하면서 여기에 분기만 추가하면 된다."""
    if provider == "gemini":
        if not GEMINI_KEY:
            raise RuntimeError("GEMINI_KEY 환경변수가 설정되어 있지 않습니다.")
        return ChatGoogleGenerativeAI(model=MODEL_NAME, google_api_key=GEMINI_KEY)
    raise ValueError(f"아직 지원하지 않는 모델입니다: {provider}")


def generate(
    slide_text: str,
    question_type: Literal["multiple_choice", "short_answer"],
    count: int,
    provider: str = "gemini",
) -> list[ExamQuestion]:
    llm = _get_llm(provider)
    structured_llm = llm.with_structured_output(ExamQuestionList)

    prompt = _PROMPT_TEMPLATE.format(
        slide_text=slide_text,
        question_type_label=_TYPE_LABELS[question_type],
        count=count,
        type_instruction=_TYPE_INSTRUCTIONS[question_type],
    )

    result: ExamQuestionList = structured_llm.invoke(prompt)
    return result.questions
