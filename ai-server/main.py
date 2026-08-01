"""
ai-server — 강의 콘텐츠 관리 플랫폼의 AI 기능 전용 서버 (Cloud Run).
system-b-dashboard(GAS)가 UrlFetchApp으로 이 서버를 호출한다.

첫 기능: 시험문제 자동생성 (POST /exam-questions)
"""

from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from auth import verify_api_key
from chains.exam_generator import generate as generate_exam_questions
from chains.opinion_summarizer import summarize as summarize_opinions
from supabase_client import get_slide_text

app = FastAPI(title="dsacontents ai-server")


@app.get("/")
def health_check():
    """Cloud Run 배포 확인용 - AI 연동과 무관하게 서버 실행 여부만 확인한다."""
    return "ai-server가 정상적으로 배포되어 실행 중입니다. (v3. 수정git push-빌드-자동배포까지)"


class ExamRequest(BaseModel):
    keyword: str
    question_type: Literal["multiple_choice", "short_answer"]
    count: int


class OpinionSummaryRequest(BaseModel):
    keyword: str
    question_text: str
    answers_text: str


@app.post("/exam-questions")
def exam_questions(req: ExamRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    slide_text = get_slide_text(req.keyword)
    if not slide_text:
        raise HTTPException(status_code=404, detail="슬라이드 내용을 찾을 수 없습니다.")

    try:
        questions = generate_exam_questions(slide_text, req.question_type, req.count)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    return {"questions": [q.model_dump() for q in questions]}


@app.post("/opinion-summary")
def opinion_summary(req: OpinionSummaryRequest, x_api_key: str = Header(default="")):
    verify_api_key(x_api_key)

    try:
        summary = summarize_opinions(req.question_text, req.answers_text)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))

    return {"summary": summary}
