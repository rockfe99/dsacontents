"""
가상질문 생성 — 학생 페르소나 입장에서 강의 슬라이드를 앞에서부터 읽으며
궁금한 점을 질문으로 뽑아내는 LangGraph 에이전트.

설계:
- 슬라이드는 Part 1/2/3 3구간으로 나눠 순서대로("배치") 처리한다.
- 페르소나는 한 번에 1명씩 단일 요청으로 처리한다(동시 실행 없음).
- 구간은 페르소나 1명 안에서는 반드시 직렬(앞 구간 내용을 알아야 다음 구간을
  판단할 수 있음) - 그래서 그래프는 read_batch를 조건부 엣지로 반복하는
  단순 루프 구조다.
- 컨텍스트 관리: 전체 슬라이드 50장 이하면 지나온 구간 원문을 그대로 누적,
  50장을 넘으면 원문 대신 구간별 요약(batch_summary)을 누적한다. 요약은
  질문 생성 호출과 별도 호출을 늘리지 않고, 구조화 출력에 함께 실어 받는다
  (questions + batch_summary를 한 번에).
- "질문 없음"도 정상 결과다 - 의미 있는 내용이 없거나 이미 본 내용과
  겹치면 억지로 질문을 만들지 않도록 프롬프트에 명시한다(개수를 채우려다
  없는 내용을 지어내는 것을 막는다).
- 마지막 filter_questions 노드가 전체 구간의 질문을 모아 중복·유사 질문을
  한 번 더 정리한 "최종본"만 만든다 - 화면 표시·DB 저장 모두 이 최종본만
  쓴다(구간별 원본은 별도로 보관하지 않음).

그래프 구조:
  START → read_batch ─┐
              ↑         │ (batch_index < 배치 개수: 다음 구간으로 루프)
              └─────────┘
                         │ (마지막 구간까지 끝나면)
                         ↓
                   filter_questions → END
"""

from typing import TypedDict

from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from llm_provider import get_openai_llm

_BATCH_LABELS = ["Part 1", "Part 2", "Part 3"]
_SUMMARY_THRESHOLD_SLIDES = 50


class _BatchResult(BaseModel):
    questions: list[str] = Field(
        description="이번 구간에서 이 페르소나가 궁금해할 질문 목록. 궁금한 게 없으면 빈 리스트."
    )
    batch_summary: str = Field(
        description="이번 구간에서 실제로 다룬 내용을 한두 문장으로 요약(다음 구간 판단용 참고자료)"
    )


class _FilteredQuestion(BaseModel):
    batch: str = Field(description="이 질문이 처음 나온 구간(Part 1/Part 2/Part 3)")
    question: str = Field(description="질문 원문(고치지 않고 그대로)")


class _FilteredQuestionList(BaseModel):
    questions: list[_FilteredQuestion]


class _VqState(TypedDict):
    persona_prompt: str
    batches: list[dict]
    batch_index: int
    use_summary: bool
    context_text: str
    context_summaries: list[str]
    all_questions: list[dict]
    final_questions: list[dict]


_BATCH_PROMPT_TEMPLATE = """{persona_prompt}

당신은 이 강의를 앞에서부터 순서대로 듣고 있는 학생입니다. 지금까지 진행된
내용과 이번에 새로 나온 내용을 아래에서 확인하고, 위에서 설명한 성격과
행동양식에 맞게 궁금한 점을 질문으로 남기세요.

[{context_label}]
{context}

[이번 구간({batch_label}) 슬라이드 내용]
{batch_text}

[요청]
- 이번 구간 내용만 근거로 질문하세요. 아직 나오지 않은 뒷부분 내용을 이미
  안다는 전제로 질문하지 마세요.
- 이번 구간이 (a) 표지·구분페이지처럼 의미 있는 내용이 거의 없거나, (b) 이미
  지나온 내용과 실질적으로 겹치기만 한다면, 억지로 질문을 만들지 말고 빈
  리스트를 반환하세요. 질문이 없는 것도 정상적인 결과입니다.
- 질문 개수는 정해져 있지 않습니다 - 위 페르소나의 성격·행동양식에 맞는
  만큼만 질문하세요.
- 한국어로, 실제로 그 학생이 말하듯 자연스러운 문장으로 작성하세요.
- batch_summary에는 이번 구간에서 실제로 다룬 내용을 한두 문장으로
  요약하세요(다음 구간을 판단할 때 참고용입니다. 질문 자체를 반복하지 마세요).
"""

_FILTER_PROMPT_TEMPLATE = """{persona_prompt}

위 성격의 학생이 강의를 들으며 구간별로 남긴 질문 목록입니다. 같은 내용을
묻는 중복 질문이나, 표현만 다를 뿐 실질적으로 같은 유형의 질문이 여러
구간에 걸쳐 반복될 수 있습니다.

[구간별 질문 목록]
{listing}

[요청]
- 같거나 실질적으로 같은 내용을 묻는 질문은 하나만 남기고 정리하세요(그
  질문이 처음 나온 구간의 batch 값을 그대로 쓰세요).
- 서로 다른 내용을 묻는 질문은 모두 남기세요 - 개수를 억지로 줄이지 마세요.
- 질문 목록이 비어 있으면 빈 리스트를 반환하세요.
- 질문 내용 자체를 고치거나 요약하지 말고, 원래 문장을 그대로 쓰세요.
"""


def _split_into_batches(segments: list[dict]) -> list[dict]:
    """슬라이드 순서를 유지한 채 Part 1/2/3 구간으로 나눈다(슬라이드 수가
    3장 미만이면 그보다 적은 구간). 각 구간은 [슬라이드 N] 텍스트를 이어붙인
    문자열이다."""
    n = len(segments)
    parts = min(len(_BATCH_LABELS), n)
    if parts == 0:
        return []

    boundaries = [round(n * i / parts) for i in range(parts + 1)]
    batches = []
    for i in range(parts):
        chunk = segments[boundaries[i]:boundaries[i + 1]]
        if not chunk:
            continue
        text = "\n\n".join(f"[슬라이드 {s['slide_index']}]\n{s['slide_text']}" for s in chunk)
        batches.append({"label": _BATCH_LABELS[i], "text": text})
    return batches


def _read_batch(state: _VqState) -> dict:
    idx = state["batch_index"]
    batch = state["batches"][idx]

    if state["use_summary"]:
        context_label = "지금까지 읽은 내용 요약"
        context = "\n".join(state["context_summaries"]) if state["context_summaries"] else "(이전 구간 없음 - 첫 구간입니다)"
    else:
        context_label = "지금까지 읽은 슬라이드 원문"
        context = state["context_text"] or "(이전 구간 없음 - 첫 구간입니다)"

    prompt = _BATCH_PROMPT_TEMPLATE.format(
        persona_prompt=state["persona_prompt"],
        context_label=context_label,
        context=context,
        batch_label=batch["label"],
        batch_text=batch["text"],
    )

    llm = get_openai_llm()
    structured_llm = llm.with_structured_output(_BatchResult)
    result: _BatchResult = structured_llm.invoke(prompt)

    new_questions = [
        {"batch": batch["label"], "question": q.strip()}
        for q in result.questions
        if q.strip()
    ]

    update: dict = {
        "batch_index": idx + 1,
        "all_questions": state["all_questions"] + new_questions,
    }
    if state["use_summary"]:
        update["context_summaries"] = state["context_summaries"] + [f"[{batch['label']}] {result.batch_summary}"]
    else:
        update["context_text"] = (
            f"{state['context_text']}\n\n{batch['text']}" if state["context_text"] else batch["text"]
        )
    return update


def _route_after_batch(state: _VqState) -> str:
    return "read_batch" if state["batch_index"] < len(state["batches"]) else "filter_questions"


def _filter_questions(state: _VqState) -> dict:
    if not state["all_questions"]:
        return {"final_questions": []}

    listing = "\n".join(f"[{q['batch']}] {q['question']}" for q in state["all_questions"])
    prompt = _FILTER_PROMPT_TEMPLATE.format(persona_prompt=state["persona_prompt"], listing=listing)

    llm = get_openai_llm()
    structured_llm = llm.with_structured_output(_FilteredQuestionList)
    result: _FilteredQuestionList = structured_llm.invoke(prompt)

    return {
        "final_questions": [{"batch": q.batch, "question": q.question} for q in result.questions]
    }


_graph = StateGraph(_VqState)
_graph.add_node("read_batch", _read_batch)
_graph.add_node("filter_questions", _filter_questions)
_graph.set_entry_point("read_batch")
_graph.add_conditional_edges(
    "read_batch",
    _route_after_batch,
    {"read_batch": "read_batch", "filter_questions": "filter_questions"},
)
_graph.add_edge("filter_questions", END)
_compiled_graph = _graph.compile()


def generate(persona_prompt: str, slide_segments: list[dict]) -> list[dict]:
    """페르소나 프롬프트와 슬라이드 세그먼트(순서대로)를 받아, Part 1/2/3
    구간을 순서대로 읽어나가며 질문을 만들고 마지막에 중복을 정리한 최종
    질문 목록을 반환한다.
    반환 형태: [{"batch": "Part 1|Part 2|Part 3", "question": "..."}, ...]
    """
    batches = _split_into_batches(slide_segments)
    if not batches:
        return []

    initial_state: _VqState = {
        "persona_prompt": persona_prompt,
        "batches": batches,
        "batch_index": 0,
        "use_summary": len(slide_segments) > _SUMMARY_THRESHOLD_SLIDES,
        "context_text": "",
        "context_summaries": [],
        "all_questions": [],
        "final_questions": [],
    }

    final_state = _compiled_graph.invoke(initial_state)
    return final_state["final_questions"]
