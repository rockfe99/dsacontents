/**
 * 의견형 설문 요약(summarizeOpinions_) 연동 확인용 테스트. 편집기에서 이 함수를
 * 직접 실행해 AI_SERVER_URL/AI_SERVER_KEY 설정과 ai-server 호출이 정상인지
 * 확인한다. ai-server에 /opinion-summary가 아직 없으면 null이 반환되는 것이
 * 정상 동작이다(서버 배포 전까지는 항상 원문 표시 경로를 탄다).
 */
function testSummarizeOpinions() {
  var answers = ['속도가 너무 빠르다', '실습 시간이 더 있었으면 좋겠다', '설명이 명확하다'];
  var summary = summarizeOpinions_('test-keyword', '오늘 수업 어땠나요?', answers);
  Logger.log('요약 결과: %s', summary);
}
