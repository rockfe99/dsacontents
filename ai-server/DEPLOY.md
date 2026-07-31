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
로컬 PC의 기본 `python`이 3.9 미만이거나 `uvicorn`이 안 잡히면(`'uvicorn'
용어가 인식되지 않습니다` 등), `ai-server` 전용 가상환경(`.venv`)을 만들어
쓴다 — 최초 1회만 생성하면 된다.
```
cd ai-server
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```
이후 실행은:
```
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
시작되었는지 확인한다. 이 저장소는 `ai-server` 외에도 여러 GAS 프로젝트
폴더가 같이 있는 모노레포라서, 트리거의 빌드 소스 구성이 저장소 루트를
보게 되면 다음 에러로 즉시(수 초 만에) 실패한다:
```
unable to prepare context: unable to evaluate symlinks in Dockerfile path:
lstat /workspace/Dockerfile: no such file or directory
```
**Cloud Build → 트리거 → 해당 트리거 수정**에서 다음을 확인/지정한다
(자동 감지 상태에서는 아래 입력칸 자체가 안 보이므로, 유형을 **Dockerfile**로
먼저 바꿔야 나타난다):
- **Dockerfile 디렉터리**: `ai-server`
- **Dockerfile 이름**: `Dockerfile` (기본값 그대로)
- **이미지 이름**: 이 필드는 트리거의 커스텀 대체 변수(`${_AR_HOSTNAME}` 등)를
  못 받고 Cloud Build 기본 변수(`$PROJECT_ID`, `$COMMIT_SHA` 등)만 허용한다.
  그래서 `${_AR_HOSTNAME}/${_AR_PROJECT_ID}/...` 형태가 아니라, Cloud Run
  서비스 화면(개요)의 대체 변수 값을 그대로 문자열로 풀어써야 한다. 예:
  ```
  asia-northeast3-docker.pkg.dev/<프로젝트ID>/cloud-run-source-deploy/<서비스명>:$COMMIT_SHA
  ```
  (마지막 `:$COMMIT_SHA` 태그를 빼면 "Docker 태그가 누락되었습니다" 오류가
  난다. 입력칸 아래 회색으로 뜨는 "지원되는 변수: $PROJECT_ID, ..." 문구는
  에러가 아니라 이 필드에 쓸 수 있는 변수 목록을 알려주는 고정 안내다.)

빌드가 실패하면 그 외 원인(예: `requirements.txt` 설치 실패)은 빌드 로그에서
직접 확인한다.

### 4. Cloud Run 리비전 확인 (자동 배포 연결이 끊겨 있을 수 있음)
Google Cloud 콘솔 → **Cloud Run → 해당 서비스 → 버전** 탭에서 방금 빌드로부터
새 리비전이 생성되고, 그 리비전이 **트래픽 100%로 서비스 중** 상태인지 확인한다.

**주의**: Cloud Build 트리거가 성공해도, 그 트리거를 raw 화면(위 3번)에서 직접
편집한 경우 "빌드 성공 시 Cloud Run에 자동 배포"까지 이어지는 연결이 살아있지
않을 수 있다. 이 경우 서비스 상단 URL이 계속 `(첫 번째 빌드가 성공할 때까지
숨겨짐)`으로 표시되고, 버전 탭에는 `gcr.io/cloudrun/placeholder` 이미지로 된
리비전(빌드/소스 정보 없음, 서비스 최초 생성 시 자동으로 깔린 자리표시자)만
보인다. 확인 방법: 리비전 상세의 **이미지** 필드가 `gcr.io/cloudrun/placeholder`
로 시작하면 아직 우리 코드가 배포된 적이 없다는 뜻이다.

이 경우 두 가지 방법이 있다.
- **즉시 확인용(수동 1회 배포)**: 서비스 화면 상단 **"새 버전 수정 및 배포"** →
  컨테이너 이미지 선택에서 Artifact Registry의 `cloud-run-source-deploy`
  저장소 → 방금 빌드된 이미지(커밋 해시 태그)를 직접 선택해 배포한다. 이후
  URL이 나타난다.
- **근본 해결(자동 배포 연결 복구)**: 서비스 화면 상단 **"저장소 설정 수정"**
  버튼(Cloud Build 트리거 화면이 아니라 Cloud Run 서비스 화면에 있음)으로
  들어가 저장소·브랜치·빌드 유형·소스 디렉터리(`ai-server`)를 다시 지정하고
  저장한다 — 이 경로로 재설정해야 "빌드 성공 → 자동 배포"까지 Cloud Run이
  다시 관리해준다. 이후로는 GitHub에 push만 하면 사람 개입 없이 새 리비전이
  자동으로 뜬다.

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
