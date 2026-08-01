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
아래 내용을 항목별로 나열하지 말고, 자연스럽게 이어지는 문장으로 요약해
답하세요. 먼저 총 응답자 수(위 [총 응답 수] 값 그대로)를 언급하고, 이어서
다수 의견의 방향을 설명하세요 - 같은 취지의 답변이 2건 이상 겹칠 때만
"다수"라고 하고, 겹치는 게 없으면 의견이 갈렸다고만 쓰세요. 그다음
전반적인 분위기를 설명하되, 답변에 감정이 명시적으로 드러난 경우만
판단하고 근거가 없으면 분위기를 판단하기 어렵다고 그대로 말하세요.
마지막으로 유독 부정적인 답변이 있다면 그 요지만 한 문장으로 자연스럽게
덧붙이고, 없으면 언급하지 마세요.

답변을 하나씩 나열하거나 그대로 인용하지 마세요(전체 답변 원문은 화면
아래에 이미 따로 표시되므로 여기서 반복할 필요가 없습니다). 의미를 알 수
없는 문자열(무작위 키보드 입력, 자음만 나열 등)은 다수 의견·분위기
판단에서는 제외하되 응답자 수에서는 빼지 마세요. "의견이 다양하게
나타났다" 같은 내용 없는 상투적 문장으로 끝내지 말고 항상 구체적인
방향이나 내용을 말하세요. 글머리 기호나 번호, 줄바꿈 없이 3~4문장
이내의 자연스러운 한 문단으로 한국어로 작성하세요.
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
