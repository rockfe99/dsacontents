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

### 3. Cloud Build 트리거 구성 (cloudbuild.yaml 사용)
이 저장소는 `ai-server` 외에도 여러 GAS 프로젝트 폴더가 같이 있는
모노레포다. 트리거가 "Dockerfile" 빌드 유형으로 저장소 루트를 기준으로
동작하면 다음 에러로 즉시(수 초 만에) 실패하고,
```
unable to prepare context: unable to evaluate symlinks in Dockerfile path:
lstat /workspace/Dockerfile: no such file or directory
```
디렉터리를 `ai-server`로 고쳐도 "Dockerfile" 빌드 유형 자체는 이미지를
빌드해서 Artifact Registry에 **푸시까지만** 하고, Cloud Run에 실제로
배포하는 단계(`gcloud run deploy`)가 빠져 있어서 빌드는 성공해도 새
리비전이 자동으로 생기지 않았다(URL이 계속 `(첫 번째 빌드가 성공할
때까지 숨겨짐)`으로 남고, 버전 탭에는 서비스 최초 생성 시 깔린
`gcr.io/cloudrun/placeholder` 자리표시자 리비전만 보임).

그래서 빌드·푸시·배포 3단계를 전부 명시하는 `ai-server/cloudbuild.yaml`을
직접 작성해 사용한다. 트리거의 "대체 변수"(`_AR_HOSTNAME` 등)는 빌드
유형을 바꾸는 과정에서 값이 비워지는 문제가 있었으므로, 그 변수들에
의존하지 않고 실제 값(Artifact Registry 경로, 서비스명, 리전)을
`cloudbuild.yaml` 안에 직접 하드코딩했다 — 이 값들은 프로젝트/서비스가
바뀌지 않는 한 고정이므로 하드코딩이 더 안전하다.

**Cloud Build → 트리거 → 해당 트리거 수정**에서:
- **구성 → 유형**: `Cloud Build 구성 파일(YAML 또는 JSON)`
- **위치**: 저장소 선택 유지, 파일 경로를 `ai-server/cloudbuild.yaml`로 지정
  (기본값 `/cloudbuild.yaml`을 그대로 두면 파일을 못 찾는다)

저장 후 push하면 빌드 로그에 **Step #0(빌드) → Step #1(푸시) →
Step #2(gcloud run deploy)** 세 단계가 순서대로 나와야 정상이다.

Step #2(배포)에서 권한 오류(`PERMISSION_DENIED` 등)가 나면, 트리거의
서비스 계정(빌드 로그 상단 또는 트리거 설정의 "서비스 계정" 필드에 표시,
보통 `<프로젝트번호>-compute@developer.gserviceaccount.com`)에 IAM에서
**Cloud Run 관리자**(`roles/run.admin`)와 **서비스 계정 사용자**
(`roles/iam.serviceAccountUser`) 역할을 추가해야 한다.

### 4. Cloud Run 리비전 확인
Google Cloud 콘솔 → **Cloud Run → 해당 서비스 → 버전** 탭에서 방금 빌드로부터
새 리비전이 **자동으로** 생성되고, 트래픽 100%로 서비스 중인지 확인한다.
리비전 상세의 **이미지** 필드가 `gcr.io/cloudrun/placeholder`로 시작한다면
아직 우리 코드가 배포된 적이 없다는 뜻이니 3번부터 다시 점검한다.

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
