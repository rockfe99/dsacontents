/**
 * 시스템 B - 강사 대시보드
 * 설정값은 자체 스크립트 속성이 아니라 배포엔진 라이브러리에서 가져온다.
 *
 * [사전 준비 - 라이브러리 추가]
 *   1. 배포엔진 프로젝트의 스크립트 ID 확보
 *      (배포엔진 편집기 > 프로젝트 설정 > 스크립트 ID)
 *   2. 이 프로젝트 편집기 왼쪽 "라이브러리 +" 클릭
 *   3. 스크립트 ID 붙여넣고 조회 → 식별자를 'PublishEngine'으로 추가
 *   → 이후 PublishEngine.getPublicConfig() 등으로 호출
 *
 * 설정값(DB_SHEET_ID, VIEWER_URL 등)은 배포엔진 한 곳에만 저장되어 있고,
 * 이 프로젝트는 그것을 빌려 쓴다. 값이 바뀌면 배포엔진만 고치면 됨.
 */

/**
 * 웹앱 진입점. ?page=help 이면 도움말, 아니면 대시보드를 렌더링한다.
 * HtmlService 페이지는 script.googleusercontent.com iframe 안에서 뜨기 때문에
 * 화면 내 링크는 상대경로("?page=help")가 아니라 실제 배포 URL을 기준으로 한
 * 절대경로여야 한다. 그래서 baseUrl을 템플릿에 넘겨준다.
 */
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'dashboard';
  const baseUrl = ScriptApp.getService().getUrl();

  if (page === 'help') {
    const tpl = HtmlService.createTemplateFromFile('Help');
    tpl.baseUrl = baseUrl;
    return tpl.evaluate()
      .setTitle('도움말 - 강의 컨텐츠 관리')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const tpl = HtmlService.createTemplateFromFile('Dashboard');
  tpl.baseUrl = baseUrl;
  return tpl.evaluate()
    .setTitle('강의 컨텐츠 관리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 대시보드에서 호출: 강의 목록을 스프레드시트에서 읽어 반환.
 * 설정값은 배포엔진 라이브러리에서 가져온다.
 * 반환: [{ keyword, title, updated, viewerUrl }, ...]
 */
function getLectureList() {
  // 배포엔진 라이브러리에서 공용 설정을 한 번에 가져옴
  const cfg = PublishEngine.getPublicConfig();  // { PARENT_FOLDER_ID, DB_SHEET_ID, VIEWER_URL }
  const sheetId = cfg.DB_SHEET_ID;
  const viewerBase = cfg.VIEWER_URL || '';

  if (!sheetId) {
    throw new Error('배포엔진 설정에 DB_SHEET_ID가 없습니다. 배포엔진의 스크립트 속성을 확인하세요.');
  }

  // 시트 순서가 바뀌어도 안전하도록 이름("강의목록")으로 찾는다
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('강의목록');
  if (!sheet) {
    throw new Error('DB 스프레드시트에 "강의목록" 시트가 없습니다. 시트 이름을 확인하세요.');
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  // 헤더 이름이 문서와 달라도(오타·변경) 배포엔진이 정해진 열 번호로 대체해줌
  const cols = PublishEngine.getDbColumnIndexes(values[0]);

  const rows = values.slice(1);
  return rows
    .filter(function (r) { return r[cols.keyword]; })
    .map(function (r) {
      const keyword = String(r[cols.keyword]).trim();
      return {
        keyword: keyword,
        title: String(r[cols.title] || '').trim(),
        sourceUrl: String(r[cols.sourceUrl] || '').trim(),
        updated: formatDate_(r[cols.updated]),
        viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(keyword)) : ''
      };
    });
}

/**
 * 대시보드의 [배포] 버튼에서 호출: 새 강의 추가/배포 수정 공용.
 * 실제 처리는 배포엔진에 위임(다리 역할).
 * isNew=true("새 강의 추가")인데 이미 있는 키워드면 등록을 막는다 — 기존 강의
 * 수정은 반드시 목록의 "배포 수정"(isNew=false)으로만 하도록 강제.
 * 배포 수정에서 URL을 비워두면(기존 슬라이드 그대로 유지) 제목만 갱신하고
 * 목차는 재추출하지 않는다 — URL을 입력하면 그 슬라이드로 전체 재배포한다.
 * tocMethod: 목차 추출 방식 - 'title'(제목만) 또는 'firstText'(첫 문자열).
 *            URL이 없으면(제목만 갱신) 슬라이드를 다시 안 읽으므로 무시된다.
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function deployLecture(url, keyword, title, isNew, tocMethod) {
  const cleanUrl = String(url || '').trim();
  const cleanKeyword = String(keyword || '').trim();
  const cleanTitle = String(title || '').trim();
  const cleanTocMethod = (tocMethod === 'firstText') ? 'firstText' : 'title';

  if (!cleanKeyword || !cleanTitle) {
    throw new Error('키워드와 제목을 입력하세요.');
  }

  if (isNew) {
    if (!cleanUrl) {
      throw new Error('키워드, 제목, 슬라이드 URL을 모두 입력하세요.');
    }
    if (PublishEngine.lectureExists(cleanKeyword)) {
      throw new Error('이미 등록된 키워드입니다: ' + cleanKeyword + ' (기존 강의는 목록의 "배포 수정"으로 변경하세요)');
    }
    return PublishEngine.publishLecture(cleanUrl, cleanKeyword, cleanTitle, cleanTocMethod);
  }

  if (cleanUrl) {
    return PublishEngine.publishLecture(cleanUrl, cleanKeyword, cleanTitle, cleanTocMethod);
  }
  return PublishEngine.updateLectureTitle(cleanKeyword, cleanTitle);
}

/**
 * 대시보드의 "배포 수정" 모달 [삭제] 버튼에서 호출: 배포를 내린다.
 * 실제 처리는 배포엔진에 위임(다리 역할). 슬라이드 파일 자체는 삭제되지 않고
 * 공유 범위만 되돌아가며, 목차 json 삭제와 DB 행 제거까지 배포엔진이 처리한다.
 * @return {Object} { keyword }
 */
function deleteLecture(keyword) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) {
    throw new Error('키워드가 없습니다.');
  }
  return PublishEngine.unpublishLecture(cleanKeyword);
}

/** 날짜 값을 'yyyy-MM-dd HH:mm' 문자열로 변환. */
function formatDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return String(value);
}