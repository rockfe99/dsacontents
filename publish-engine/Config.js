/**
 * ============================================================
 *  Config.js  —  게시엔진(배포엔진) 중앙 설정 허브
 * ============================================================
 *  모든 공유 설정값을 이 프로젝트의 스크립트 속성 한 곳에만 저장하고,
 *  다른 프로젝트(시스템 A/B/C)는 이 라이브러리를 통해 호출해서 받아 쓴다.
 *  값이 바뀌면 배포엔진의 스크립트 속성만 고치면 모든 프로젝트에 반영된다.
 *
 *  [스크립트 속성 등록]  프로젝트 설정 > 스크립트 속성에 아래 키 등록:
 *    공용: PARENT_FOLDER_ID, DB_SHEET_ID, VIEWER_URL, AI_SERVER_URL
 *    민감: GEMINI_KEY, SUPABASE_URL, SUPABASE_KEY, AI_SERVER_KEY   (실제 값 채우기)
 *  또는 setAllProperties()를 한 번 실행해 일괄 등록.
 *
 *  [다른 프로젝트에서 호출]  라이브러리 식별자를 'PublishEngine'으로 추가 후:
 *    PublishEngine.getConfig()              // 공용 설정 묶음
 *    PublishEngine.getSetting('DB_SHEET_ID')// 공용 값 하나
 *    PublishEngine.getSecret('GEMINI_KEY')  // 민감 값(허용된 키만)
 * ============================================================
 */

/** 공용 설정 키(민감하지 않음). getConfig()가 이 목록을 묶어 반환. */
const PUBLIC_KEYS = [
  'PARENT_FOLDER_ID',   // 시스템 파일 저장 기본 폴더 ID
  'DB_SHEET_ID',        // 관리 DB 스프레드시트 ID
  'VIEWER_URL',         // 시스템 A(뷰어) 웹앱 배포 URL
  'AI_SERVER_URL'       // ai-server(Cloud Run, Python+LangChain) 서비스 URL
];

/** 민감 설정 키(API 키 등). getSecret()로만, 등록된 키만 반환. */
const SECRET_KEYS = [
  'GEMINI_KEY',         // Gemini API 키
  'SUPABASE_URL',       // Supabase 프로젝트 URL
  'SUPABASE_KEY',       // Supabase API 키
  'AI_SERVER_KEY'       // ai-server 호출 인증용 공유 비밀키(X-API-Key 헤더)
];

/**
 * 게시엔진 자체가 쓰는 기존 설정(하위 호환 유지).
 * 배포/목차 로직이 이 함수를 그대로 사용한다.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const parentFolderId = props.getProperty('PARENT_FOLDER_ID');
  const dbSheetId = props.getProperty('DB_SHEET_ID');

  if (!parentFolderId || !dbSheetId) {
    throw new Error('스크립트 속성에 PARENT_FOLDER_ID, DB_SHEET_ID를 설정하세요.');
  }

  return {
    parentFolderId: parentFolderId,
    dbSheetId: dbSheetId
  };
}

/**
 * 공용 설정 전체를 객체로 반환(다른 프로젝트가 호출).
 * @return {Object}  { PARENT_FOLDER_ID, DB_SHEET_ID, VIEWER_URL }
 */
function getPublicConfig() {
  const props = PropertiesService.getScriptProperties();
  const result = {};
  PUBLIC_KEYS.forEach(function (key) {
    const v = props.getProperty(key);
    result[key] = v == null ? '' : v;
  });
  return result;
}

/**
 * 이름으로 공용 설정값 하나를 반환(다른 프로젝트가 호출).
 * 민감 키는 여기서 못 가져온다 → getSecret 사용.
 * @param {string} name
 * @return {string}  값(없으면 빈 문자열)
 */
function getSetting(name) {
  if (SECRET_KEYS.indexOf(name) !== -1) {
    throw new Error('민감한 설정은 getSecret()으로 요청하세요: ' + name);
  }
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value == null ? '' : value;
}

/**
 * 민감 설정값을 반환(다른 프로젝트가 호출). SECRET_KEYS에 등록된 키만 허용.
 * @param {string} name
 * @return {string}  값(없으면 빈 문자열)
 */
function getSecret(name) {
  if (SECRET_KEYS.indexOf(name) === -1) {
    throw new Error('허용되지 않은 민감 설정 요청입니다: ' + name);
  }
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value == null ? '' : value;
}

/**
 * 설정 상태 점검(편집기에서 실행). 민감값은 실제 값을 찍지 않고 설정 여부만 표시.
 */
function checkSettings() {
  const props = PropertiesService.getScriptProperties();
  const lines = ['[공용 설정]'];
  PUBLIC_KEYS.forEach(function (key) {
    const v = props.getProperty(key);
    lines.push('  ' + key + ' : ' + (v ? v : '(미설정)'));
  });
  lines.push('[민감 설정]');
  SECRET_KEYS.forEach(function (key) {
    const v = props.getProperty(key);
    lines.push('  ' + key + ' : ' + (v ? 'OK (설정됨)' : '(미설정)'));
  });
  Logger.log(lines.join('\n'));
}

