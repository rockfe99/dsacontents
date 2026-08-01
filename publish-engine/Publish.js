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
 * 6) 슬라이드 본문 텍스트를 추출해 Supabase에 저장(SlideContent.js 재사용) -
 *    이 키워드의 기존 내용은 지우고 새로 채운다(신규 등록이든 URL 재배포든 동일)
 *
 * @param {string} url         슬라이드 편집 URL
 * @param {string} keyword     뷰어 주소 고정용 키워드(고유 키)
 * @param {string} title       강의 제목
 * @param {string} [tocMethod] 목차 추출 방식 - 'title'(제목 플레이스홀더만, 기본값)
 *                             또는 'firstText'(슬라이드 첫 텍스트 도형 사용)
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function publishLecture(url, keyword, title, tocMethod) {
  if (!url || !keyword || !title) {
    throw new Error('url, keyword, title은 모두 필수입니다.');
  }
  const config = getConfig();

  const slideId = extractSlideId(url);

  // 공유 드라이브의 파일도 DriveApp 기본 서비스로 접근 가능(파일 단위 작업은
  // supportsAllDrives가 필요한 고급 Drive 서비스 호출이 아님 - CLAUDE.md 규칙 4는
  // 고급 Drive 서비스 사용 시에만 해당).
  const file = DriveApp.getFileById(slideId);

  // PPT 파일을 "슬라이드로 저장"하지 않고 그냥 연 채로 URL을 복사하면, 오피스
  // 호환 편집 화면의 주소가 정식 구글 슬라이드 URL과 똑같은 형태
  // (docs.google.com/presentation/d/{ID}/edit)로 나와 여기까지는 통과해버린다.
  // 실제 파일이 구글 슬라이드가 아니면 미리 걸러서 원인을 정확히 알려준다.
  if (file.getMimeType() !== MimeType.GOOGLE_SLIDES) {
    throw new Error(
    `❌ 현재 파일은 Google Slides가 아닙니다.\n\n` +
    `✅ 해결 방법:\n` +
    `1. Google Drive에서 PPT 파일 열기\n` +
    `2. "파일 > Google Slides로 저장" 명령 실행\n` +
    `3. 새로 생성된 Google Slides의 URL 복사\n` +
    `4. 다시 시도하기`
    );
  }

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const toc = extractSlideToc(slideId, tocMethod);

  const tocFolder = getOrCreateTocFolder_(config.parentFolderId);
  const tocFile = saveTocJson_(tocFolder, keyword, {
    keyword: keyword,
    title: title,
    slideId: slideId,
    toc: toc
  });

  writeDbRecord_(config.dbSheetId, keyword, title, slideId, url, tocFile.getUrl(), new Date());

  saveSlideContents_(keyword, slideId);

  const viewerBase = getSetting('VIEWER_URL');
  return {
    keyword: keyword,
    title: title,
    slideId: slideId,
    viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(keyword)) : ''
  };
}

/** DB 스프레드시트에서 강의 목록 시트의 이름. 시트 순서가 바뀌어도 안전하게 이름으로 찾는다. */
const DB_SHEET_NAME_ = '강의목록';

/** dbSheetId 스프레드시트에서 DB_SHEET_NAME_ 시트를 이름으로 찾아 반환한다. */
function getDbSheet_(dbSheetId) {
  const sheet = SpreadsheetApp.openById(dbSheetId).getSheetByName(DB_SHEET_NAME_);
  if (!sheet) {
    throw new Error('DB 스프레드시트에 "' + DB_SHEET_NAME_ + '" 시트가 없습니다. 시트 이름을 확인하세요.');
  }
  return sheet;
}

/**
 * 키워드가 DB 스프레드시트에 이미 등록되어 있는지 확인한다.
 * 시스템 B가 "새 강의 추가" 시 중복 등록을 막는 데 사용(라이브러리 공개 함수).
 * @param {string} keyword
 * @return {boolean}
 */
function lectureExists(keyword) {
  const config = getConfig();
  const sheet = getDbSheet_(config.dbSheetId);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;

  const cols = getDbColumnIndexes(values[0]);
  const target = String(keyword).trim();

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cols.keyword]).trim() === target) return true;
  }
  return false;
}

/**
 * 배포를 내린다(슬라이드 파일 자체는 삭제하지 않음). 시스템 B "배포 수정" 모달의
 * [삭제] 버튼에서 호출(라이브러리 공개 함수).
 * 1) 같은 슬라이드ID를 쓰는 다른 키워드가 없을 때만 슬라이드 공유 범위를
 *    "제한됨(PRIVATE)"으로 되돌림 - 공유 드라이브 멤버는 기존 권한대로 계속
 *    열람 가능, 링크 공유로 열람하던 외부/일반 사용자는 차단됨. 같은 슬라이드를
 *    다른 키워드가 여전히 참조 중이면 그 키워드의 뷰어가 깨지지 않도록 공유
 *    범위를 그대로 둔다.
 * 2) 목차데이터 폴더의 키워드.json을 휴지통으로 이동.
 * 3) DB 스프레드시트에서 해당 키워드 행을 삭제(키워드 재사용 가능해짐).
 * 4) 그 키워드로 쌓인 실시간 설문 데이터(survey_temp_questions·survey_results)를
 *    Supabase에서 전부 삭제(deleteSurveyDataForKeyword) - 키워드 재사용 시
 *    이전 강의의 설문 결과가 새 강의에 섞이지 않도록 함.
 * 5) 그 키워드로 저장된 슬라이드 본문 텍스트(slide_contents)도 Supabase에서
 *    전부 삭제(deleteSlideContentsForKeyword).
 * 6) 그 키워드로 생성된 가상질문 결과(virtual_questions)도 Supabase에서
 *    전부 삭제(deleteVirtualQuestionsForKeyword).
 * @param {string} keyword
 * @return {Object} { keyword }
 */
function unpublishLecture(keyword) {
  const config = getConfig();
  const target = String(keyword).trim();

  const sheet = getDbSheet_(config.dbSheetId);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('등록되지 않은 키워드입니다: ' + target);
  }

  const cols = getDbColumnIndexes(values[0]);

  let rowIndex = -1;
  let slideId = '';
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cols.keyword]).trim() === target) {
      rowIndex = r + 1; // 시트 상 1-based 행 번호
      slideId = String(values[r][cols.slideId]).trim();
      break;
    }
  }
  if (rowIndex === -1) {
    throw new Error('등록되지 않은 키워드입니다: ' + target);
  }

  // 삭제하려는 행을 제외하고, 같은 슬라이드ID를 쓰는 다른 키워드가 남아있는지 확인
  const sharedByOtherKeyword = slideId && values.some(function (r, i) {
    return i > 0
      && (i + 1) !== rowIndex
      && String(r[cols.slideId]).trim() === slideId;
  });

  if (slideId && !sharedByOtherKeyword) {
    DriveApp.getFileById(slideId)
      .setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  }

  const tocFolder = getOrCreateTocFolder_(config.parentFolderId);
  const tocFiles = tocFolder.getFilesByName(target + '.json');
  if (tocFiles.hasNext()) {
    tocFiles.next().setTrashed(true);
  }

  sheet.deleteRow(rowIndex);

  // 강의 완전 삭제이므로 키워드 재사용 시 섞이지 않도록 관련 데이터도 함께 삭제
  deleteSurveyDataForKeyword(target);
  deleteSlideContentsForKeyword(target);
  deleteVirtualQuestionsForKeyword(target);

  return { keyword: target };
}

/**
 * 슬라이드 URL 변경 없이 제목만 수정한다("배포 수정" 모달에서 URL을 비워둔 경우).
 * 기존 슬라이드ID·목차는 그대로 두고(공유 설정도 다시 안 걸고, 목차도 재추출 안 함),
 * 목차데이터의 키워드.json과 DB 시트의 제목·최종수정만 갱신한다.
 * @param {string} keyword
 * @param {string} title
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function updateLectureTitle(keyword, title) {
  const config = getConfig();
  const target = String(keyword).trim();

  const existing = getTocData(target);
  if (!existing) {
    throw new Error('등록되지 않은 키워드입니다: ' + target);
  }

  const tocFolder = getOrCreateTocFolder_(config.parentFolderId);
  saveTocJson_(tocFolder, target, {
    keyword: target,
    title: title,
    slideId: existing.slideId,
    toc: existing.toc
  });

  const sheet = getDbSheet_(config.dbSheetId);
  const values = sheet.getDataRange().getValues();
  const cols = getDbColumnIndexes(values[0]);

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cols.keyword]).trim() === target) {
      sheet.getRange(r + 1, cols.title + 1).setValue(title);
      sheet.getRange(r + 1, cols.updated + 1).setValue(
        Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')
      );
      break;
    }
  }

  const viewerBase = getSetting('VIEWER_URL');
  return {
    keyword: target,
    title: title,
    slideId: existing.slideId,
    viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(target)) : ''
  };
}

/**
 * 키워드에 해당하는 목차 데이터(목차데이터 폴더의 키워드.json)를 읽어 반환한다.
 * 시스템 A 뷰어가 이 함수 하나로 제목·슬라이드ID·목차를 가져온다(라이브러리 공개 함수).
 * @param {string} keyword
 * @return {Object|null} { keyword, title, slideId, toc } 또는 배포된 적 없으면 null
 */
function getTocData(keyword) {
  const config = getConfig();
  const tocFolder = getOrCreateTocFolder_(config.parentFolderId);
  const files = tocFolder.getFilesByName(String(keyword).trim() + '.json');
  if (!files.hasNext()) return null;
  return JSON.parse(files.next().getBlob().getDataAsString());
}

/**
 * DB 시트 헤더(1행) 배열에서 컬럼 인덱스를 이름으로 찾는다. 헤더 문자열이
 * 잘못됐거나(오타·변경) 못 찾을 경우, 파일 구조(열 순서)는 항상 같다는 전제하에
 * 정해진 열 번호로 대체한다: A=키워드, B=강의제목, C=슬라이드ID, D=게시URL,
 * E=목차JSON, F=최종수정. 시스템 B도 이 함수로 컬럼 위치를 가져온다(공개 함수).
 * @param {Array<string>} headerRow  시트 1행 값 배열
 * @return {Object} { keyword, title, slideId, sourceUrl, tocJson, updated } (전부 0-based 인덱스)
 */
function getDbColumnIndexes(headerRow) {
  const header = (headerRow || []).map(function (h) { return String(h).trim(); });

  function resolve(name, fallbackIndex) {
    const idx = header.indexOf(name);
    return idx >= 0 ? idx : fallbackIndex;
  }

  return {
    keyword:   resolve('키워드', 0),
    title:     resolve('강의제목', 1),
    slideId:   resolve('슬라이드ID', 2),
    sourceUrl: resolve('게시URL', 3),
    tocJson:   resolve('목차JSON', 4),
    updated:   resolve('최종수정', 5)
  };
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
  const sheet = getDbSheet_(dbSheetId);
  const header = ['키워드', '강의제목', '슬라이드ID', '게시URL', '목차JSON', '최종수정'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }

  const values = sheet.getDataRange().getValues();
  const cols = getDbColumnIndexes(values[0]);

  const updatedText = Utilities.formatDate(updatedDate, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const rowData = [keyword, title, slideId, sourceUrl, tocFileUrl, updatedText];

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cols.keyword]).trim() === keyword) {
      sheet.getRange(r + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}
