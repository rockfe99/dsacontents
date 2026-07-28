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

/**
 * 실시간 설문 라운드트립 테스트. 이 함수 하나로 Survey.js/Supabase 연동이
 * 정상인지(생성 → 고유키로 조회 → 답변 제출 → 종료 → 결과 저장) 편집기에서
 * 바로 확인할 수 있다. 시스템 A/B 웹앱을 거치지 않아 배포 문제와 데이터 계층
 * 문제를 구분하는 데 쓴다.
 */
function testSurvey() {
  const created = createSurveyQuestion('test01', '테스트 질문입니다', 'short_answer', null, ['정답']);
  Logger.log('1) 생성됨: %s', JSON.stringify(created));

  const found = getSurveyByAccessKey(created.access_key);
  Logger.log('2) 고유키로 조회: %s', JSON.stringify(found));
  if (!found) {
    Logger.log('❌ 방금 만든 키로 조회가 안 됩니다 - Survey.js/Supabase 데이터 계층 문제');
    return;
  }

  const submitted = submitSurveyAnswer(found.id, '정답');
  Logger.log('3) 답변 제출 성공 여부: %s', submitted);

  const ended = endSurveyQuestion(created.id);
  Logger.log('4) 종료 처리 결과: %s', JSON.stringify(ended));

  const answers = getSurveyTempAnswers(created.id);
  Logger.log('5) 종료 후 답변 목록: %s', JSON.stringify(answers));

  finalizeSurveyResult(created.id, {
    total_responses: answers.length,
    correct_count: 1,
    accuracy_rate: 100,
    answer_distribution: [{ label: '정답', count: 1, ratio: 100, is_correct: true }],
    opinion_summary: null,
    opinion_raw: null
  });
  Logger.log('✅ 6) 결과 저장까지 완료. Supabase survey_results 테이블에서 test01 확인 가능.');
}
