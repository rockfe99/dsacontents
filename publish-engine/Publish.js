/**
 * 강의 배포(신규 등록/수정 공용) 핵심 로직.
 * 시스템 B가 라이브러리로 이 함수 하나를 호출한다.
 * 같은 키워드로 다시 호출하면 그대로 "배포 수정"이 된다(DB 행 갱신).
 *
 * 1) URL에서 슬라이드ID 추출 (SlideParser.js 재사용)
 * 2) 슬라이드를 "링크 있는 사람 - 보기"로 공유 설정
 * 3) 목차 추출 (SlideParser.js 재사용)
 * 4) 목차데이터 폴더(없으면 생성)에 키워드.json 저장
 * 5) DB 스프레드시트에 키워드 기준 기록(있으면 갱신, 없으면 추가)
 *
 * @param {string} url      슬라이드 편집 URL
 * @param {string} keyword  뷰어 주소 고정용 키워드(고유 키)
 * @param {string} title    강의 제목
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function publishLecture(url, keyword, title) {
  if (!url || !keyword || !title) {
    throw new Error('url, keyword, title은 모두 필수입니다.');
  }
  const config = getConfig();

  const slideId = extractSlideId(url);

  // 공유 드라이브의 파일도 DriveApp 기본 서비스로 접근 가능(파일 단위 작업은
  // supportsAllDrives가 필요한 고급 Drive 서비스 호출이 아님 - CLAUDE.md 규칙 4는
  // 고급 Drive 서비스 사용 시에만 해당).
  DriveApp.getFileById(slideId)
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const toc = extractSlideToc(slideId);

  const tocFolder = getOrCreateTocFolder_(config.parentFolderId);
  const tocFile = saveTocJson_(tocFolder, keyword, {
    keyword: keyword,
    title: title,
    slideId: slideId,
    toc: toc
  });

  writeDbRecord_(config.dbSheetId, keyword, title, slideId, url, tocFile.getUrl(), new Date());

  const viewerBase = getSetting('VIEWER_URL');
  return {
    keyword: keyword,
    title: title,
    slideId: slideId,
    viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(keyword)) : ''
  };
}

/**
 * 키워드가 DB 스프레드시트에 이미 등록되어 있는지 확인한다.
 * 시스템 B가 "새 강의 추가" 시 중복 등록을 막는 데 사용(라이브러리 공개 함수).
 * @param {string} keyword
 * @return {boolean}
 */
function lectureExists(keyword) {
  const config = getConfig();
  const sheet = SpreadsheetApp.openById(config.dbSheetId).getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;

  const header = values[0].map(function (h) { return String(h).trim(); });
  const idxKeyword = header.indexOf('키워드');
  const target = String(keyword).trim();

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idxKeyword]).trim() === target) return true;
  }
  return false;
}

/** 기본 폴더 아래 "목차데이터" 폴더를 이름으로 찾고, 없으면 생성해 반환한다. */
function getOrCreateTocFolder_(parentFolderId) {
  const parent = DriveApp.getFolderById(parentFolderId);
  const folders = parent.getFoldersByName('목차데이터');
  if (folders.hasNext()) return folders.next();
  return parent.createFolder('목차데이터');
}

/** 목차데이터 폴더에 키워드.json을 생성(없으면)하거나 덮어쓴다. 저장한 파일을 반환. */
function saveTocJson_(folder, keyword, data) {
  const fileName = keyword + '.json';
  const content = JSON.stringify(data, null, 2);

  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(content);
    return file;
  }
  return folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
}

/**
 * DB 스프레드시트에 키워드 기준으로 기록한다(있으면 그 행 갱신, 없으면 새 행 추가).
 * 시트가 비어 있으면 헤더를 먼저 만든다.
 * "목차JSON" 컬럼에는 JSON 원문 대신 목차데이터 폴더에 저장된 파일 링크를 기록한다
 * (셀에 큰 JSON을 통째로 넣지 않기 위함).
 */
function writeDbRecord_(dbSheetId, keyword, title, slideId, sourceUrl, tocFileUrl, updatedDate) {
  const sheet = SpreadsheetApp.openById(dbSheetId).getSheets()[0];
  const header = ['키워드', '제목', '슬라이드ID', '게시URL', '목차JSON', '최종수정'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }

  const values = sheet.getDataRange().getValues();
  const headerRow = values[0].map(function (h) { return String(h).trim(); });
  const idxKeyword = headerRow.indexOf('키워드');

  const updatedText = Utilities.formatDate(updatedDate, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const rowData = [keyword, title, slideId, sourceUrl, tocFileUrl, updatedText];

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idxKeyword]).trim() === keyword) {
      sheet.getRange(r + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}
