"""
슬라이드 본문 텍스트를 근거로 시험문제를 생성하는 LangChain 체인.
구조화 출력(with_structured_output)을 써서 프리폼 텍스트 파싱 없이 안정적으로
파싱 가능한 형태로 결과를 받는다.

문제 유형은 객관식/주관식(단답형)/서술형 3종, 문제 수준은 초급/중급/고급
3단계를 지원한다. 가상질문 생성(virtual_question_agent.py) 결과가 있으면
"학생들이 실제로 많이 질문한 부분" 참고자료로 프롬프트에 함께 실어, 그
부분 위주로 출제되도록 유도한다(없으면 참고자료 없이 슬라이드 내용만으로
출제) - 다만 그 목록에 없는 내용도 슬라이드 전체 범위에서 골고루 다루도록
프롬프트에 명시해 특정 구간에만 몰리지 않게 한다. reference_questions는
호출부(main.py)가 이미 요청 level과 매칭되는 페르소나(virtual_question_
personas.exam_level)의 결과로 걸러서 넘긴다 - 이 함수는 필터링하지 않고
받은 그대로 쓴다.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from llm_provider import get_openai_llm


# 문제 1개의 구조화 출력 스키마 - main.py가 model_dump()해서 GAS에 그대로 돌려준다.
class ExamQuestion(BaseModel):
    question_text: str = Field(description="문제 본문")
    options: Optional[list[str]] = Field(
        default=None, description="객관식 보기 목록(주관식·서술형은 null)"
    )
    correct_answer: str = Field(
        description="정답(객관식은 보기 텍스트 그대로, 서술형은 채점 기준이 될 모범답안)"
    )


# with_structured_output()에 넘기는 최상위 스키마 - LLM이 문제 목록을 한 번에 반환하도록 강제한다.
class ExamQuestionList(BaseModel):
    questions: list[ExamQuestion]


_PROMPT_TEMPLATE = """당신은 아래 강의 슬라이드 내용을 바탕으로 시험문제를 만드는 출제자입니다.

[슬라이드 내용]
{slide_text}
{reference_section}
[요청]
- 문제 유형: {question_type_label}
- 문제 수준: {level_label}
- 문제 개수: {count}개
- 슬라이드 내용에 실제로 나온 내용만 근거로 출제하세요.
- 문제 주제는 슬라이드 전체 범위에서 무작위로, 골고루 고르세요 - 앞부분
  내용에만 몰리지 않게 하세요.
- 한국어로 작성하세요.
{type_instruction}
{level_instruction}
"""

_REFERENCE_TEMPLATE = """
[학생들이 실제로 많이 질문한 내용 - 구간별 정리]
{listing}

위 목록은 이 강의를 들은(가상) 학생들이 실제로 궁금해했던 질문들입니다.
질문이 몰린 주제나 구간이 있다면 그 부분을 우선적으로 고려해 문제를
출제하세요(단, 이 목록에 없는 내용도 슬라이드 전체 범위에서 함께 다루세요).
"""

_TYPE_LABELS = {
    "multiple_choice": "객관식(4지선다)",
    "short_answer": "주관식(단답형)",
    "essay": "서술형",
}

_TYPE_INSTRUCTIONS = {
    "multiple_choice": "- 각 문제마다 보기를 4개 만들고, correct_answer에는 정답 보기의 텍스트를 그대로 넣으세요.",
    "short_answer": "- options는 비워두고(null), correct_answer에 정답 단어/구절만 넣으세요.",
    "essay": "- options는 비워두고(null), correct_answer에는 채점 기준이 될 모범답안을 몇 문장으로 작성하세요(단답이 아니라 서술형 모범답안).",
}

_LEVEL_LABELS = {
    "beginner": "초급",
    "intermediate": "중급",
    "advanced": "고급",
}

_LEVEL_INSTRUCTIONS = {
    "beginner": "- 기본 개념을 확인하는 수준으로, 슬라이드에 나온 용어의 정의나 단순 사실 확인 위주로 출제하세요.",
    "intermediate": "- 개념 간 관계나 적용을 묻는 수준으로, 단순 암기가 아니라 이해를 확인하는 문제로 출제하세요.",
    "advanced": "- 여러 개념을 종합하거나 응용해야 풀 수 있는 수준으로, 깊이 있는 이해를 요구하는 문제로 출제하세요.",
}


# 가상질문 참고자료 블록 조립 - 참고자료가 없으면 빈 문자열을 반환해 프롬프트에서 섹션 자체를 뺀다(generate()에서만 사용).
def _build_reference_section(reference_questions: Optional[list[dict]]) -> str:
    if not reference_questions:
        return ""
    listing = "\n".join(
        f"[{q.get('batch', '')}] {q.get('question', '')}" for q in reference_questions
    )
    return _REFERENCE_TEMPLATE.format(listing=listing)


# 시험문제 생성 진입점 - main.py의 /exam-questions가 호출하는 이 모듈의 유일한 공개 함수(구조화 출력 1회).
def generate(
    slide_text: str,
    question_type: Literal["multiple_choice", "short_answer", "essay"],
    level: Literal["beginner", "intermediate", "advanced"],
    count: int,
    reference_questions: Optional[list[dict]] = None,
) -> list[ExamQuestion]:
    llm = get_openai_llm()
    structured_llm = llm.with_structured_output(ExamQuestionList)

    prompt = _PROMPT_TEMPLATE.format(
        slide_text=slide_text,
        reference_section=_build_reference_section(reference_questions),
        question_type_label=_TYPE_LABELS[question_type],
        level_label=_LEVEL_LABELS[level],
        count=count,
        type_instruction=_TYPE_INSTRUCTIONS[question_type],
        level_instruction=_LEVEL_INSTRUCTIONS[level],
    )

    result: ExamQuestionList = structured_llm.invoke(prompt)
    return result.questions
