/**
 * 의견형 설문 요약(summarizeOpinions_) 연동 확인용 테스트. 편집기에서 이 함수를
 * 직접 실행해 AI_MODE·AI_SERVER_URL/AI_SERVER_KEY 설정과 ai-server 호출이
 * 정상인지 확인한다. null이 반환되면 AI 요약을 못 받은 것이고(화면에서는 답변
 * 원문 표시 경로를 탄다), 원인은 실행 로그에서 확인한다.
 */
function testSummarizeOpinions() {
  var answers = ['속도가 너무 빠르다', '실습 시간이 더 있었으면 좋겠다', '설명이 명확하다'];
  var summary = summarizeOpinions_('test-keyword', '오늘 수업 어땠나요?', answers);
  Logger.log('요약 결과: %s', summary);
}
