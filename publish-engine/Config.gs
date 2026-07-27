/**
 * 게시엔진 전역 설정을 스크립트 속성에서 읽어온다.
 * 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 아래 키를 반드시 등록할 것:
 *   PARENT_FOLDER_ID, DB_SHEET_ID
 * 코드에 ID를 직접 적지 않는다 (CLAUDE.md 개발 규칙 1).
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
