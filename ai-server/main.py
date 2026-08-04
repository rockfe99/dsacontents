"""
ai-server — 강의 콘텐츠 관리 플랫폼의 AI 기능 전용 서버 (Cloud Run).
system-b-dashboard(GAS)가 UrlFetchApp으로 이 서버를 호출한다.

엔드포인트: 시험문제 자동생성(POST /exam-questions),
           실시간 설문 의견형 결과 요약(POST /opinion-summary),
           가상질문 생성(POST /virtual-questions),
           강의자료 평가(POST /lecture-evaluation)
모두 llm_provider.get_openai_llm()으로 OpenAI 인스턴스를 공유해서 쓴다.
"""

from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from auth import verify_api_key
from chains.exam_generator import generate as generate_exam_questions
from chains.lecture_evaluator import generate as generate_lecture_evaluation
from chains.opinion_summarizer import summarize as summarize_opinions
from chains.virtual_question_agent import generate as generate_virtual_questions
from supabase_client import (
    get_persona,
    get_slide_segments,
    get_survey_results,
    get_virtual_questions,
    get_virtual_questions_by_persona,
    join_slide_text,
)

app = FastAPI(title="dsacontents ai-server")


# 헬스체크 엔드포인트 - Cloud Run 배포/기동 확인용(브라우저로 서비스 URL 직접 접속).
@app.get("/")
def health_check():
    """Cloud Run 배포 확인용 - AI 연동과 무관하게 서버 실행 여부만 확인한다."""
    return "ai-server가 정상적으로 배포되어 실행 중입니다."


# POST /exam-questions 요청 본문 스키마 - GAS generateExamQuestions()가 보내는 값.
class ExamRequest(BaseModel):
    keyword: str
    question_type: Literal["multiple_choice", "short_answer", "essay"]
    level: Literal["beginner", "intermediate", "advanced"]
    count: int


# POST /opinion-summary 요청 본문 스키마 - GAS summarizeOpinions_()가 보내는 값
# (답변 배열은 GAS에서 미리 하나의 문자열 answers_text로 합쳐서 보낸다).
class OpinionSummaryRequest(BaseModel):
    keyword: str
    question_text: str
    answers_text: str


# POST /virtual-questions 요청 본문 스키마 - GAS generateVirtualQuestions()가 보내는 값.
class VirtualQuestionRequest(BaseModel):
    keyword: str
    persona_id: str


# POST /lecture-evaluation 요청 본문 스키마 - GAS generateLectureEvaluation()가 보내는 값
# (나머지 근거 데이터는 keyword로 서버가 Supabase에서 직접 조회한다).
class LectureEvaluationRequest(BaseModel):
    keyword: str


# 시험문제 생성 - 슬라이드 본문 + 난이도가 맞는 가상질문을 근거로 문제를 만들어 반환한다
# (시스템 B 대시보드의 [시험문제 생성] 버튼 → GAS generateExamQuestions()가 호출).
@app.post("/exam-questions")
def exam_questions(req: ExamRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    segments = get_slide_segments(req.keyword)
    if not segments:
        raise HTTPException(status_code=404, detail="슬라이드 내용을 찾을 수 없습니다.")
    slide_text = join_slide_text(segments)

    # 요청한 시험 난이도와 매칭되는 페르소나의 가상질문만 참고자료로 전달한다
    # (없으면 빈 리스트 - exam_generator가 그 경우 참고자료 섹션 자체를 프롬프트에서 뺀다).
    reference_questions = get_virtual_questions(req.keyword, req.level)

    try:
        questions = generate_exam_questions(
            slide_text, req.question_type, req.level, req.count, reference_questions
        )
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    return {"questions": [q.model_dump() for q in questions]}


# 실시간 설문 의견형 결과 요약 - 학생 답변 원문을 한 문단 요약으로 돌려준다
# (강사가 [설문종료]를 누를 때 GAS finishSurvey() → summarizeOpinions_()가 호출).
@app.post("/opinion-summary")
def opinion_summary(req: OpinionSummaryRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    try:
        summary = summarize_opinions(req.question_text, req.answers_text)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    return {"summary": summary}


# 가상질문 생성 - 선택한 학생 페르소나 입장에서 슬라이드를 구간별로 읽으며 질문을 뽑는다
# (시스템 B의 [가상질문 생성] 버튼 → GAS generateVirtualQuestions()가 호출, 결과는 GAS가 캐시 저장).
@app.post("/virtual-questions")
def virtual_questions(req: VirtualQuestionRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    try:
        persona = get_persona(req.persona_id)
        segments = get_slide_segments(req.keyword)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    if not persona:
        raise HTTPException(status_code=404, detail="존재하지 않거나 비활성화된 학생 페르소나입니다.")
    if not segments:
        raise HTTPException(status_code=404, detail="슬라이드 내용을 찾을 수 없습니다.")

    questions = generate_virtual_questions(persona["prompt"], segments)
    return {"questions": questions}


# 강의자료 평가 - 슬라이드 본문·실시간 설문 결과·가상질문을 근거로 교안 검토 리포트를 만든다
# (시스템 B의 [강의자료 평가] 버튼 → GAS generateLectureEvaluation()가 호출, 결과는 GAS가 캐시 저장).
@app.post("/lecture-evaluation")
def lecture_evaluation(req: LectureEvaluationRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    try:
        segments = get_slide_segments(req.keyword)
        survey_rows = get_survey_results(req.keyword)
        persona_groups = get_virtual_questions_by_persona(req.keyword)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    if not segments:
        raise HTTPException(status_code=404, detail="슬라이드 내용을 찾을 수 없습니다.")

    slide_text = join_slide_text(segments)
    result = generate_lecture_evaluation(len(segments), slide_text, survey_rows, persona_groups)
    return result
