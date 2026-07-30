/**
 * Gemini API 연동(callAI_) 확인용 테스트. 편집기에서 이 함수를 직접 실행해
 * GEMINI_KEY 설정과 API 호출이 정상인지 확인한다.
 */
function testCallAI() {
  var prompt = '"안녕하세요"라고만 정확히 한 번 답해 주세요.';
  var response = callAI_(prompt);
  Logger.log('Gemini 응답: %s', response);
}
