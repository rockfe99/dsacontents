# dsacontents — 교육 콘텐츠 웹 뷰어 및 관리 시스템

DSA의 교육 콘텐츠 관리 통합 플랫폼. 강사가 공유 드라이브에 올린 강의 교안을
수강생이 **편집·다운로드 없이 목차와 함께 열람**하게 하고, 강사에게는 배포·
실시간 설문·AI 기반 문제/질문/평가 생성을 제공한다.

Google Apps Script(GAS) 기반이며, AI 기능만 별도의 Python 서버(Cloud Run)로
분리되어 있다.

## 구성

| 폴더 | 역할 |
|---|---|
| `publish-engine` | GAS 라이브러리. 슬라이드 공유설정·목차/본문 추출·Drive/Sheets/Supabase 접근을 담당하는 데이터 계층 |
| `system-a-viewer` | 수강생 뷰어 웹앱. `?k=키워드`로 로그인 없이 열람 |
| `system-b-dashboard` | 강사 대시보드 웹앱. 배포·실시간 설문·AI 기능 |
| `ai-server` | AI 전용 API 서버(FastAPI + LangChain/LangGraph + OpenAI, Cloud Run) |
| `system-c-excel` | 엑셀 데이터 분석 시스템 (미착수) |
| `DB구조.sql` | Supabase PostgreSQL 스키마 단일 소스 |

## 데이터 저장

- **Google Sheets** — 강의 메타(키워드·제목·슬라이드ID·URL·최종수정)
- **Google Drive** — 목차데이터 폴더의 `키워드.json`
- **Supabase PostgreSQL** — 슬라이드 본문, 실시간 설문(임시·영구), 가상질문,
  강의자료 평가 결과

## 개발

- GAS: 해당 폴더에서 `clasp push --force` → Apps Script 편집기에서 **새 버전으로
  배포**(고정 버전 `/exec`은 push만으로 반영되지 않음)
- ai-server: `main` 브랜치에 push하면 Cloud Build가 빌드→배포까지 자동 수행
  (`ai-server/DEPLOY.md` 참고)

설계·아키텍처·개발 규칙 상세는 [`CLAUDE.md`](CLAUDE.md) 참고.
