"""
강의자료 평가 — 슬라이드 본문 + 실시간 설문 결과 + 가상질문을 근거로 교안을
검토하는 체인. 시험문제 생성과 마찬가지로 여러 단계 상태를 유지할 필요가
없어(LangGraph 없이) 구조화 출력 LangChain 체인 1번으로 처리하되, "AI 추가
의견"(최신 기술/버전 검토)만 OpenAI 내장 웹검색 도구를 쓰는 별도 호출로 분리한다.

리포트 구성(화면 표시 순서와 동일):
1) 근거 명시(evidence_basis) - LLM이 아니라 이 모듈의 코드가 실제 조회 결과로
   직접 조립한다. "무엇을 참고했다"는 사실 진술이라 LLM에 맡기면 개수를 틀리거나
   안 쓴 데이터를 썼다고 하는 등 불필요한 hallucination 위험이 생기기 때문.
2) structure_review - 슬라이드 구성·흐름 검토. 항상 생성(슬라이드 내용만 있으면
   판단 가능).
3) learner_signal_review - 실시간 설문·가상질문 데이터가 하나라도 있을 때만.
   "실제 학생 응답"과 "가상 학생 질문"을 명확히 구분해서 언급하도록 프롬프트에
   명시(섞어서 마치 둘 다 실제인 것처럼 쓰지 않게).
4) currency_review - 웹검색 기반 "AI 추가 의견"(최신 기술/버전 검토). 부가
   기능이라 실패해도(타임아웃·미지원 모델 등) 조용히 None으로 두고 나머지
   리포트는 정상 반환한다(CLAUDE.md 규칙 10과 동일 원칙).
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, Optional

from pydantic import BaseModel, Field

from llm_provider import get_openai_llm, get_web_search_llm

logger = logging.getLogger(__name__)

_CURRENCY_SEARCH_TIMEOUT = 25


class _CoreEvaluation(BaseModel):
    structure_review: str = Field(
        description="슬라이드 구성·전개 순서·개념 도입 방식에 대한 검토(슬라이드 내용만 근거)"
    )
    learner_signal_review: Optional[str] = Field(
        default=None,
        description="실시간 설문 결과·가상질문 데이터가 있을 때만 작성하는, 그 데이터를 근거로 한 검토. 둘 다 없으면 null.",
    )
    suggestions: list[str] = Field(description="구체적인 개선 제안 목록")
    data_coverage: Literal["slide_only", "slide_and_signals"] = Field(
        description="실시간 설문·가상질문 데이터를 하나라도 참고했으면 slide_and_signals, 아니면 slide_only"
    )


_CORE_PROMPT_TEMPLATE = """당신은 강의 교안을 검토하는 교육 전문가입니다. 아래 강의 슬라이드 내용을
바탕으로 교안을 평가하세요.

[슬라이드 내용]
{slide_text}
{survey_section}{vq_section}
[요청]
- structure_review: 슬라이드의 구성·전개 순서·개념 도입 방식을 검토하세요
  (용어가 정의 없이 먼저 나오는지, 예시가 있는지, 슬라이드당 분량이 과하거나
  부족한 구간이 있는지 등). 이건 슬라이드 내용만으로 판단 가능한 항목입니다.
- learner_signal_review: 아래 [실시간 설문 결과]나 [가상 학생 질문] 데이터가
  있을 때만 작성하세요. 둘 다 없으면 이 필드는 반드시 null로 두세요. 작성할
  때는 "실제 학생 응답"과 "가상 학생 질문"을 명확히 구분해서 언급하세요(둘을
  섞어서 마치 둘 다 실제 학생 반응인 것처럼 쓰지 마세요). 정답률이 낮았던
  문제, 학생들이 반복해서 궁금해한 지점 위주로 다루세요.
- suggestions: 위 검토를 바탕으로 한 구체적인 개선 제안을 목록으로 작성하세요.
  슬라이드나 제공된 데이터에 실제로 나타난 근거에 기반해서만 제안하세요 -
  근거 없는 일반론은 피하세요.
- data_coverage: [실시간 설문 결과]나 [가상 학생 질문] 데이터가 하나라도
  있었으면 "slide_and_signals", 둘 다 없었으면 "slide_only"로 설정하세요.
- 한국어로 작성하세요.
"""

_CURRENCY_PROMPT_TEMPLATE = """다음은 어떤 강의 슬라이드의 내용입니다.

[슬라이드 내용]
{slide_text}

[요청]
당신의 웹 검색 능력을 활용해, 이 강의 내용 중 현재 시점 기준으로 오래되었거나
최신 기술·버전과 맞지 않는 부분이 있는지 확인하세요. 확실한 근거가 있을 때만
언급하고, 특별히 지적할 내용이 없으면 다른 말 없이 정확히 "NONE"이라고만
답하세요(있지도 않은 문제를 억지로 만들지 마세요). 언급할 내용이 있다면
한국어로 2~4문장 정도, 강사가 참고할 수 있는 톤으로 작성하세요. 이 의견은
당신의 지식과 검색 결과에 기반한 참고 의견이며 이 강의의 실제 학생 데이터와는
무관하다는 점을 첫 문장에 명시하세요.
"""


def _build_survey_section(rows: list[dict]) -> str:
    if not rows:
        return ""
    lines = []
    for r in rows:
        if r.get("question_type") == "opinion":
            lines.append(f"[의견형] {r.get('question_text', '')} - 요약: {r.get('opinion_summary') or '(요약 없음)'}")
        else:
            acc = r.get("accuracy_rate")
            acc_text = f"{acc}%" if acc is not None else "N/A"
            lines.append(
                f"[{r.get('question_type', '')}] {r.get('question_text', '')} - "
                f"정답률 {acc_text} (응답 {r.get('total_responses', 0)}건)"
            )
    return "\n[실시간 설문 결과 - 실제 학생 응답]\n" + "\n".join(lines) + "\n"


def _build_vq_section(persona_groups: list[dict]) -> str:
    active = [g for g in persona_groups if g["questions"]]
    if not active:
        return ""
    lines = []
    for g in active:
        for q in g["questions"]:
            qtext = q.get("question") if isinstance(q, dict) else q
            lines.append(f"[{g['label']}] {qtext}")
    return "\n[가상 학생 질문 - AI가 시뮬레이션한 질문, 실제 학생 데이터 아님]\n" + "\n".join(lines) + "\n"


def build_evidence_basis(slide_count: int, survey_rows: list[dict], persona_groups: list[dict]) -> str:
    """어떤 데이터를 근거로 평가했는지 코드가 직접 조립하는 요약(LLM 생성 아님).
    리포트 맨 앞에 고정으로 붙는다."""
    lines = [f"- 슬라이드 본문: 전체 {slide_count}장 텍스트"]

    if survey_rows:
        lines.append(f"- 실시간 설문 결과: {len(survey_rows)}건 참고함")
    else:
        lines.append("- 실시간 설문 결과: 없음 (아직 진행된 설문이 없습니다)")

    active_groups = [g for g in persona_groups if g["questions"]]
    if active_groups:
        parts = [f"{g['label']} {len(g['questions'])}개" for g in active_groups]
        lines.append("- 가상 학생 질문: " + ", ".join(parts) + " 참고함")
    else:
        lines.append("- 가상 학생 질문: 없음 (아직 생성된 가상질문이 없습니다)")

    return "\n".join(lines)


def _generate_core(slide_text: str, survey_rows: list[dict], persona_groups: list[dict]) -> _CoreEvaluation:
    llm = get_openai_llm()
    structured_llm = llm.with_structured_output(_CoreEvaluation)

    prompt = _CORE_PROMPT_TEMPLATE.format(
        slide_text=slide_text,
        survey_section=_build_survey_section(survey_rows),
        vq_section=_build_vq_section(persona_groups),
    )

    result: _CoreEvaluation = structured_llm.invoke(prompt)
    return result


def _generate_currency_review(slide_text: str) -> Optional[str]:
    """웹검색 기반 "AI 추가 의견". 부가 기능이므로 어떤 이유로든(타임아웃·미지원
    모델·API 오류 등) 실패하면 조용히 None을 반환한다 - 호출부가 이 결과 없이도
    나머지 평가를 그대로 반환할 수 있어야 한다."""
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        llm = get_web_search_llm(timeout=_CURRENCY_SEARCH_TIMEOUT)
        prompt = _CURRENCY_PROMPT_TEMPLATE.format(slide_text=slide_text)
        future = executor.submit(llm.invoke, prompt)
        result = future.result(timeout=_CURRENCY_SEARCH_TIMEOUT)
    except Exception as err:
        # 부가 기능이라 사용자에게는 이 섹션만 조용히 빠지지만("지적할 내용 없음"과
        # 구분이 안 되는 문제가 있었음), 원인 파악은 서버 로그로 남긴다(CLAUDE.md 규칙 10).
        logger.warning("강의자료 평가 - 웹검색 AI 추가 의견 생성 실패(무시하고 계속 진행): %r", err)
        return None
    finally:
        # wait=False: 응답이 이미 왔거나 타임아웃으로 포기한 뒤에는 스레드가
        # 아직 안 끝났어도 여기서 기다리지 않고 바로 반환한다(ThreadPoolExecutor를
        # with 블록으로 쓰면 __exit__가 shutdown(wait=True)를 호출해서, 이미
        # result(timeout=...)로 포기한 뒤에도 스레드가 끝날 때까지 도로 블로킹
        # 되는 문제가 있어 이렇게 직접 shutdown(wait=False)를 쓴다).
        executor.shutdown(wait=False)

    text = (result.content or "").strip() if hasattr(result, "content") else ""
    if not text or text.upper() == "NONE":
        return None
    return text


def generate(slide_count: int, slide_text: str, survey_rows: list[dict], persona_groups: list[dict]) -> dict:
    """강의자료 평가 리포트를 생성한다. 근거 명시는 코드가 조립하고, 본문 평가는
    구조화 출력 1회, AI 추가 의견은 웹검색 호출 1회(best-effort)로 만든다.
    반환 형태는 lecture_evaluations 테이블 컬럼과 그대로 대응한다."""
    evidence_basis = build_evidence_basis(slide_count, survey_rows, persona_groups)
    core = _generate_core(slide_text, survey_rows, persona_groups)
    currency_review = _generate_currency_review(slide_text)

    return {
        "evidence_basis": evidence_basis,
        "structure_review": core.structure_review,
        "learner_signal_review": core.learner_signal_review,
        "currency_review": currency_review,
        "suggestions": core.suggestions,
        "data_coverage": core.data_coverage,
    }
