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

  const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(function (h) { return String(h).trim(); });
  const idxKeyword = header.indexOf('키워드');
  const idxTitle   = header.indexOf('제목');
  const idxUpdated = header.indexOf('최종수정');

  const rows = values.slice(1);
  return rows
    .filter(function (r) { return r[idxKeyword]; })
    .map(function (r) {
      const keyword = String(r[idxKeyword]).trim();
      return {
        keyword: keyword,
        title: idxTitle >= 0 ? String(r[idxTitle]).trim() : '',
        updated: formatDate_(idxUpdated >= 0 ? r[idxUpdated] : ''),
        viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(keyword)) : ''
      };
    });
}

/**
 * 대시보드의 [배포] 버튼에서 호출: 새 강의 추가/배포 수정 공용.
 * 실제 처리는 배포엔진에 위임(다리 역할).
 * isNew=true("새 강의 추가")인데 이미 있는 키워드면 등록을 막는다 — 기존 강의
 * 수정은 반드시 목록의 "배포 수정"(isNew=false)으로만 하도록 강제.
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function deployLecture(url, keyword, title, isNew) {
  const cleanUrl = String(url || '').trim();
  const cleanKeyword = String(keyword || '').trim();
  const cleanTitle = String(title || '').trim();

  if (!cleanUrl || !cleanKeyword || !cleanTitle) {
    throw new Error('키워드, 제목, 슬라이드 URL을 모두 입력하세요.');
  }

  if (isNew && PublishEngine.lectureExists(cleanKeyword)) {
    throw new Error('이미 등록된 키워드입니다: ' + cleanKeyword + ' (기존 강의는 목록의 "배포 수정"으로 변경하세요)');
  }

  return PublishEngine.publishLecture(cleanUrl, cleanKeyword, cleanTitle);
}

/** 날짜 값을 'yyyy-MM-dd HH:mm' 문자열로 변환. */
function formatDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return String(value);
}