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

/**
 * 2단계 테스트 실행 함수(publishLecture).
 * TEST_SLIDE_URL에 테스트용 구글슬라이드 편집 URL을 넣고 이 함수를 실행한다.
 * 실행 후 확인할 것: ① 슬라이드가 "링크 있는 사람 보기"로 공유됐는지
 * ② 목차데이터 폴더에 keyword.json이 생겼는지 ③ DB 스프레드시트에 행이 들어갔는지.
 */
function testPublish() {
  const TEST_SLIDE_URL = 'https://docs.google.com/presentation/d/1vXh5uK7-RTrfUZR3orBM0cZoPv7HBkdwU00dhjqgfUA/edit?slide=id.p1#slide=id.p1';
  const TEST_KEYWORD = 'test01';
  const TEST_TITLE = '테스트 강의';

  const result = publishLecture(TEST_SLIDE_URL, TEST_KEYWORD, TEST_TITLE);
  Logger.log('배포 결과: %s', JSON.stringify(result, null, 2));
}
