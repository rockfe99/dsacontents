# ai-server 배포 확인 절차

Cloud Run 서비스는 GitHub 저장소 `rockfe99/dsacontents`(소스 하위 디렉터리
`ai-server`)와 연결된 상태로 먼저 생성되었다. 서비스 최초 생성 시점에는
`ai-server`의 파이썬 코드가 아직 미완성이었기 때문에 첫 빌드는 실패로
시작되었다. 이 문서는 **AI 연동(Gemini·Supabase)은 배제하고**, Cloud Run ↔
GitHub ↔ FastAPI 앱으로 이어지는 배포 경로 자체가 정상 동작하는지부터
확인하는 순서를 규정한다.

## 확인용 최소 엔드포인트

`main.py`에 인증·환경변수 없이 항상 고정 문자열을 반환하는 헬스체크
엔드포인트를 추가해 두었다.

```python
@app.get("/")
def health_check():
    return "ai-server가 정상적으로 배포되어 실행 중입니다."
```

`GEMINI_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `AI_SERVER_KEY` 등 환경변수가
전혀 설정되어 있지 않아도 이 경로는 항상 응답한다 — 배포 자체의 성공 여부와
AI 연동 성공 여부를 분리해서 확인하기 위함이다.

## 실행 순서

### 1. 로컬 실행 확인 (선택, 배포 전 사전 점검용)
```
cd ai-server
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
아래 방법으로 실행
cd ai-server
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8080

```
브라우저 또는 curl로 `http://localhost:8080/` 접속 → 고정 문자열이 그대로
반환되면 코드 자체에는 문제가 없다는 뜻이다.

### 2. GitHub 저장소에 반영
`ai-server` 변경분을 커밋한 뒤, Cloud Run이 감시 중인 브랜치(`main`)로
`https://github.com/rockfe99/dsacontents.git`에 push한다.

### 3. Cloud Build 실행 확인
Google Cloud 콘솔 → **Cloud Build → 기록**에서 방금 push로 트리거된 빌드가
시작되었는지 확인한다. 빌드가 실패하면 로그에서 원인을 확인한다(예:
`requirements.txt` 설치 실패, 모듈을 찾을 수 없음 등). 빌드 소스 구성에서
디렉터리가 저장소 루트가 아니라 **`/ai-server`** 로 지정되어 있는지도 함께
확인한다 — 최초 빌드 실패의 흔한 원인 중 하나가 이 경로 설정이다.

### 4. Cloud Run 리비전 확인
Google Cloud 콘솔 → **Cloud Run → 해당 서비스 → 리비전** 탭에서 빌드로부터
새 리비전이 생성되고, 그 리비전이 **트래픽 100%로 서비스 중(Serving)** 상태인지
확인한다.

### 5. 서비스 URL로 응답 확인
Cloud Run 서비스 상세 화면 상단에 표시된 URL(`https://<서비스명>-<해시>-<리전>.a.run.app`
형태)을 복사해 브라우저로 접속하거나 curl로 요청한다.

```
curl https://<서비스 URL>/
```

응답으로 `"ai-server가 정상적으로 배포되어 실행 중입니다."` 문자열이 그대로
돌아오면, GitHub → Cloud Build → Cloud Run → FastAPI 앱까지 이어지는 배포
경로 전체가 정상 동작하는 것으로 확인된 것이다.

### 6. (이번 확인 범위 밖) AI 연동 테스트
위 확인이 끝난 뒤에만 진행한다. Cloud Run 서비스의 **환경변수**에
`GEMINI_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `AI_SERVER_KEY`를 등록하고,
`POST /exam-questions`를 `X-API-Key` 헤더와 함께 호출해 실제 AI 기능이
동작하는지 별도로 확인한다.
