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
   기능이라 최종 실패해도(레이트리밋·타임아웃·미지원 모델 등) 조용히
   None으로 두고 나머지 리포트는 정상 반환한다(CLAUDE.md 규칙 10과 동일
   원칙). 검색과 요약은 두 단계로 나눈다 - 검색 도구가 걸린 호출에서는
   모델이 "찾은 내용을 보고하는" 기본 동작 쪽으로 쏠려서 언어·톤·마크다운
   금지 같은 스타일 지시를 잘 따르지 않기 때문(영어로 답하거나 원문을 그대로
   목록으로 인용):
   a) _run_web_search() - 웹검색 도구로 원시 조사 결과만 받는다(언어·형식
      신경 안 씀). 슬라이드 전체 텍스트 대신 이미 만들어진
      structure_review(짧은 요약)를 검색 맥락으로 쓴다 - 핵심 평가 직후
      슬라이드 전체를 또 보내면 분당 토큰 한도(TPM)에 걸리고, 검색 도구
      입장에서도 핵심만 간결하게 받는 게 낫다.
   b) _rewrite_currency_review() - 검색 도구 없는 일반 호출로 그 원시
      결과를 한국어 요약 의견으로 다시 쓴다. 도구 없는 순수 지시 따르기
      호출이라 언어·톤·마크다운 금지 지시가 훨씬 안정적으로 지켜진다.
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, Optional

from pydantic import BaseModel, Field

from llm_provider import get_openai_llm, get_web_search_llm

logger = logging.getLogger(__name__)

# OpenAI 웹검색 도구는 프롬프트로 "링크 쓰지 마라"고 해도 도구 차원에서
# 출처를 마크다운 링크로 자동 첨부하는 경우가 있다. 화면이 마크다운을
# 렌더링하지 않아 그대로 두면 `[텍스트](주소)` 글자가 그대로 노출되므로,
# 코드에서도 한 번 더 안전망으로 제거한다.
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")

_CURRENCY_SEARCH_TIMEOUT = 25
_CURRENCY_REWRITE_TIMEOUT = 15
_CURRENCY_MAX_ATTEMPTS = 2
# 핵심 평가 호출 직후라 조직 분당 토큰 한도(TPM)에 걸려 429가 날 수 있다.
# OpenAI가 에러에 함께 알려주는 재시도 대기 시간(보통 1~2초)보다 넉넉하게
# 잡아 한 번만 재시도한다.
_CURRENCY_RETRY_DELAY = 3


# 핵심 평가(_generate_core)의 구조화 출력 스키마 - 웹검색 기반 currency_review를 뺀 나머지 항목을 한 번에 받는다.
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

_SEARCH_PROMPT_TEMPLATE = """다음은 어떤 강의 내용의 핵심 요약입니다.

[강의 내용 요약]
{topic_summary}

[요청]
당신의 웹 검색 능력을 활용해, 이 강의에서 다루는 기술/개념 중 현재 시점
기준으로 오래되었거나 최신 버전·방식과 달라진 부분이 있는지 조사하세요.
확실한 근거가 있을 때만 조사 결과를 알려주고, 딱히 다룰 만한 내용이 없으면
다른 말 없이 정확히 "NONE"이라고만 답하세요(있지도 않은 문제를 억지로
찾지 마세요). 언어나 문장 형식은 신경 쓰지 말고 찾은 내용을 있는 그대로
알려주면 됩니다 - 이 결과는 다음 단계에서 다시 정리됩니다.
"""

_REWRITE_PROMPT_TEMPLATE = """아래는 어떤 강의 내용의 핵심 요약과, 그 내용에 대해 웹 검색으로 조사한
원시 결과입니다.

[강의 내용 요약]
{topic_summary}

[웹 검색 조사 결과 - 원문(다른 언어이거나 목록 형태일 수 있음)]
{raw_findings}

[요청]
위 조사 결과를 바탕으로, 이 강의에 참고가 될 만한 "최신 기술/버전 관련
참고 의견"을 새로 작성하세요.
- 조사 결과 원문을 번역·인용하지 말고, 이 강의와 실질적으로 관련된 부분만
  골라 강사에게 조언하듯 자연스러운 한국어 문장으로 새로 쓰세요.
- 목록이나 항목 나열이 아니라, 2~4문장 정도의 짧은 요약 의견으로 쓰세요.
- 반드시 한국어로만 작성하세요. 영어 단어는 고유명사(제품명·버전명 등)만
  허용됩니다.
- 마크다운 링크·글머리 기호(-, *)·출처 표기를 절대 쓰지 마세요. 순수한
  문장으로만 쓰세요.
- 첫 문장에서 이 의견이 AI의 검색 기반 참고 의견이며 이 강의의 실제 학생
  데이터와는 무관하다는 점을 밝히세요.
- 조사 결과에 이 강의와 실질적으로 관련된 내용이 없다면, 억지로 만들지
  말고 정확히 "NONE"이라고만 답하세요.
"""


# 실시간 설문 결과를 프롬프트 섹션 문자열로 조립 - 결과가 없으면 빈 문자열(섹션 자체가 사라짐). _generate_core()에서만 사용.
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


# 가상 학생 질문을 프롬프트 섹션 문자열로 조립 - 실제 응답과 섞이지 않도록 "실제 데이터 아님"을 제목에 명시한다. _generate_core()에서만 사용.
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


# 리포트 맨 앞의 "근거 명시" 문구를 코드가 직접 조립 - LLM을 거치지 않아 개수·참조 대상이 항상 사실과 일치한다(generate()가 호출).
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


# 핵심 평가 생성(구조 검토·반응 검토·개선 제안) - 도구 없는 구조화 출력 1회. 이 리포트의 필수 부분이라 실패하면 그대로 예외가 올라간다.
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


# 응답 content 정규화(문자열/블록 리스트 양쪽 대응) - 웹검색 2단계(_run_web_search·_rewrite_currency_review)가 공통으로 쓴다.
def _extract_text_content(content) -> str:
    """LangChain 메시지의 .content를 텍스트로 정규화한다. 일반 호출은 content가
    보통 문자열이지만, Responses API로 웹검색 같은 호스티드 도구를 쓰면 텍스트
    블록과 도구 호출/검색 결과 블록이 섞인 리스트로 오는 경우가 있다
    (예: [{"type": "text", "text": "..."}, {"type": "web_search_call", ...}]) -
    문자열 타입의 텍스트 블록만 골라 이어붙인다."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


# 마크다운 링크 제거 안전망 - 화면이 마크다운을 렌더링하지 않으므로 _rewrite_currency_review() 결과에 적용한다.
def _strip_markdown_links(text: str) -> str:
    """`[텍스트](주소)` 형태의 마크다운 링크에서 텍스트만 남기고 주소는 버린다
    (완전히 없애면 문장이 어색해질 수 있어 링크 텍스트는 살려둔다)."""
    return _MARKDOWN_LINK_RE.sub(r"\1", text)


# "AI 추가 의견"(최신성 검토) 생성 총괄 - 검색→재작성 2단계를 묶고, 어떤 실패든 None으로 흡수하는 최종 안전망(generate()가 호출).
def _generate_currency_review(topic_summary: str) -> Optional[str]:
    """웹검색 기반 "AI 추가 의견". 이 함수는 절대 예외를 던지지 않는다 - 안쪽
    로직이 어디서 어떤 이유로 실패하든(레이트리밋·타임아웃·미지원 모델·응답
    형태 변경 등, 아직 겪어보지 못한 새로운 오류까지 포함) 항상 None으로
    수렴한다. 부가 기능 하나의 실패가 근거 명시·구조 검토 등 핵심 평가 전체를
    함께 끌고 내려가면 안 되므로(요청 전체가 500으로 죽으면 이미 만들어진
    핵심 평가까지 버려진다), 아래 로직 전체를 최상위 try/except로 감싼다.
    개별 단계(검색, 재작성)에서도 각각 방어하지만 그건 로그를 더 구체적으로
    남기기 위함이고, 최종 안전망은 이 바깥쪽 try다."""
    try:
        raw = _run_web_search(topic_summary)
        if not raw:
            return None
        return _rewrite_currency_review(topic_summary, raw)
    except Exception as err:
        logger.warning("강의자료 평가 - 웹검색 AI 추가 의견 처리 중 예상치 못한 오류(무시하고 계속 진행): %r", err)
        return None


# 최신성 검토 1단계 - OpenAI 내장 웹검색으로 원시 조사 결과만 확보(하드 타임아웃 + 429 대비 1회 재시도). _generate_currency_review()에서만 호출.
def _run_web_search(topic_summary: str) -> Optional[str]:
    """1단계: 웹검색 도구로 원시 조사 결과를 가져온다(언어·형식 다듬기는
    이 단계의 책임이 아니다 - _rewrite_currency_review()가 처리). 핵심 평가
    호출 직후라 조직 분당 토큰 한도(TPM)에 걸려 RateLimitError(429)가 날 수
    있는데, 보통 1~2초 후 재시도가 권장되는 순간적인 초과라 최대
    _CURRENCY_MAX_ATTEMPTS회까지 짧게 대기 후 재시도한다."""
    prompt = _SEARCH_PROMPT_TEMPLATE.format(topic_summary=topic_summary)
    result = None

    for attempt in range(1, _CURRENCY_MAX_ATTEMPTS + 1):
        executor = ThreadPoolExecutor(max_workers=1)
        try:
            llm = get_web_search_llm(timeout=_CURRENCY_SEARCH_TIMEOUT)
            future = executor.submit(llm.invoke, prompt)
            result = future.result(timeout=_CURRENCY_SEARCH_TIMEOUT)
            break
        except Exception as err:
            is_last_attempt = attempt == _CURRENCY_MAX_ATTEMPTS
            logger.warning(
                "강의자료 평가 - 웹검색 조사 실패(%d/%d회차)%s: %r",
                attempt, _CURRENCY_MAX_ATTEMPTS,
                "" if is_last_attempt else (" - %d초 후 재시도" % _CURRENCY_RETRY_DELAY),
                err,
            )
            if is_last_attempt:
                return None
            time.sleep(_CURRENCY_RETRY_DELAY)
        finally:
            # wait=False: 응답이 이미 왔거나 타임아웃으로 포기한 뒤에는 스레드가
            # 아직 안 끝났어도 여기서 기다리지 않고 바로 넘어간다(ThreadPoolExecutor를
            # with 블록으로 쓰면 __exit__가 shutdown(wait=True)를 호출해서, 이미
            # result(timeout=...)로 포기한 뒤에도 스레드가 끝날 때까지 도로 블로킹
            # 되는 문제가 있어 이렇게 직접 shutdown(wait=False)를 쓴다).
            executor.shutdown(wait=False)

    text = _extract_text_content(result.content).strip() if result is not None else ""
    if not text or text.upper() == "NONE":
        return None
    return text


# 최신성 검토 2단계 - 검색 원문을 도구 없는 일반 호출로 한국어 요약 의견으로 다시 쓴다. _generate_currency_review()에서만 호출.
def _rewrite_currency_review(topic_summary: str, raw_findings: str) -> Optional[str]:
    """2단계: 검색 원문(영어·목록형일 수 있음)을 한국어 요약 의견으로 다시
    쓴다. 검색 도구 없는 일반 호출이라 언어·톤·마크다운 금지 같은 스타일
    지시를 훨씬 안정적으로 따른다(검색 도구를 같이 쓰는 호출에서는 이런
    지시가 잘 지켜지지 않는다 - 모듈 상단 설명 참고)."""
    llm = get_openai_llm(timeout=_CURRENCY_REWRITE_TIMEOUT)
    prompt = _REWRITE_PROMPT_TEMPLATE.format(topic_summary=topic_summary, raw_findings=raw_findings)
    result = llm.invoke(prompt)

    text = _extract_text_content(result.content).strip()
    text = _strip_markdown_links(text).strip()
    if not text or text.upper() == "NONE":
        return None
    return text


# 강의자료 평가 진입점 - main.py의 /lecture-evaluation이 호출하는 이 모듈의 유일한 공개 진입 함수(근거 조립 + 핵심 평가 + 부가 최신성 검토).
def generate(slide_count: int, slide_text: str, survey_rows: list[dict], persona_groups: list[dict]) -> dict:
    """강의자료 평가 리포트를 생성한다. 근거 명시는 코드가 조립하고, 본문 평가는
    구조화 출력 1회, AI 추가 의견은 웹검색+재작성 호출 2회(best-effort)로 만든다.
    반환 형태는 lecture_evaluations 테이블 컬럼과 그대로 대응한다."""
    evidence_basis = build_evidence_basis(slide_count, survey_rows, persona_groups)
    core = _generate_core(slide_text, survey_rows, persona_groups)
    # 웹검색 단계는 슬라이드 전체 텍스트가 아니라 core.structure_review(짧은
    # 요약)를 맥락으로 쓴다 - 핵심 평가 직후 전체 텍스트를 또 보내면 TPM
    # 한도에 걸리고, 검색 도구 입장에서도 핵심만 간결하게 받는 게 낫다.
    currency_review = _generate_currency_review(core.structure_review)

    return {
        "evidence_basis": evidence_basis,
        "structure_review": core.structure_review,
        "learner_signal_review": core.learner_signal_review,
        "currency_review": currency_review,
        "suggestions": core.suggestions,
        "data_coverage": core.data_coverage,
    }
