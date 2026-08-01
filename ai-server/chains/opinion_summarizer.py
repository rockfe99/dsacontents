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
보조 교사입니다. 사실만 근거로 요약하고, 근거 없는 해석·감정·평가를
덧붙이지 않는 것이 최우선입니다.

[질문]
{question_text}

[총 응답 수]
{answer_count}건

[학생 답변 - 각 답변은 "---" 로 구분됨]
{answers_text}

[요청]
- "다수", "대체로", "공통적으로" 같은 표현은 실제로 같은 취지의 답변이
  2건 이상 겹칠 때만 쓰세요. 응답이 1~2건뿐이면 그 내용을 있는 그대로
  전달하고 "다수 의견"처럼 일반화하지 마세요.
- 답변이 특정 감정(긍정/부정)을 명시적으로 드러내지 않으면 "긍정적/부정적
  분위기"라고 단정하지 말고, 분위기를 판단할 근거가 없으면 그렇게 있는
  그대로 말하세요.
- 답변이 의미를 알 수 없는 문자열(무작위 키보드 입력, 자음만 나열 등)이면
  "의미를 파악하기 어려운 답변입니다" 라고 사실대로 말하고, 뜻을 추측하거나
  긍정적으로 포장하지 마세요.
- 분량은 내용에 맞게 조절하세요 - 답변이 적거나 단순하면 한두 문장으로
  끝내도 됩니다. 억지로 문단을 채우지 마세요.
- 한국어로 간결하게 작성하세요.
"""


def _get_llm() -> ChatOpenAI:
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_KEY 환경변수가 설정되어 있지 않습니다.")
    return ChatOpenAI(model=MODEL_NAME, api_key=OPENAI_KEY, temperature=0)


def summarize(question_text: str, answers_text: str) -> str:
    llm = _get_llm()
    answer_count = len(answers_text.split("\n---\n")) if answers_text.strip() else 0
    prompt = _PROMPT_TEMPLATE.format(
        question_text=question_text,
        answer_count=answer_count,
        answers_text=answers_text,
    )
    result = llm.invoke(prompt)
    return result.content
