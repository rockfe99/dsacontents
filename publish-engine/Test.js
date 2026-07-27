/**
 * 1단계 테스트 실행 함수.
 * TEST_SLIDE_URL에 테스트용 구글슬라이드 편집 URL을 넣고 이 함수를 실행한다.
 * (스크립트 속성에 PARENT_FOLDER_ID, DB_SHEET_ID가 먼저 설정돼 있어야 함)
 */
function testStep1() {
  //
  const TEST_SLIDE_URL = 'https://docs.google.com/presentation/d/1vXh5uK7-RTrfUZR3orBM0cZoPv7HBkdwU00dhjqgfUA/edit?slide=id.p1#slide=id.p1';

  const config = getConfig();
  Logger.log('설정 확인: %s', JSON.stringify(config));

  const slideId = extractSlideId(TEST_SLIDE_URL);
  Logger.log('슬라이드ID: %s', slideId);

  const toc = extractSlideToc(slideId);
  Logger.log('목차(%s개): %s', toc.length, JSON.stringify(toc, null, 2));
}
