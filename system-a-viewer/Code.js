/**
 * 시스템 A - 수강생 뷰어
 * ?k=키워드로 접속. 로그인 불필요, 열람 전용(편집·다운로드 불가).
 * 목차·슬라이드ID는 게시엔진의 PublishEngine.getTocData(keyword) 하나로만 가져온다.
 *
 * [사전 준비] 이 프로젝트 편집기 > 왼쪽 "라이브러리 +" > 게시엔진 스크립트ID로
 *            'PublishEngine' 식별자 추가 (appsscript.json에도 등록되어 있어야 함)
 */

var MSG_NO_KEYWORD = '주소에 강의 키워드(?k=)가 없습니다.';
var MSG_NOT_FOUND  = '아직 관리자가 강의를 배포하지 않았거나 존재하지 않는 키워드입니다.';
var MSG_ERROR      = '일시적인 오류로 강의를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

function doGet(e) {
  var keyword = String((e && e.parameter && e.parameter.k) || '').trim();

  if (!keyword) {
    return plainMessage_(MSG_NO_KEYWORD);
  }

  var data;
  try {
    data = PublishEngine.getTocData(keyword);
  } catch (err) {
    // 내부 오류 메시지는 화면에 노출하지 않는다
    return plainMessage_(MSG_ERROR);
  }

  if (!data) {
    return plainMessage_(MSG_NOT_FOUND); // keyword를 절대 이어붙이지 않는다(보안 정책)
  }

  var toc = Array.isArray(data.toc) ? data.toc : [];
  // <script> 태그 안에 원문 그대로 주입되므로 "</script" 조기 종료 방지용 최소 이스케이프
  var tocJson = JSON.stringify(toc).replace(/</g, '\\u003c');

  var template = HtmlService.createTemplateFromFile('Portal');
  template.title   = data.title || '강의 자료';
  template.slideId = data.slideId || '';
  template.tocJson = tocJson;

  return template.evaluate()
    .setTitle(data.title || '강의 자료')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 고정 안내 문구만 출력한다. 사용자 입력을 절대 이어붙이지 않는 용도로만 쓴다. */
function plainMessage_(message) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:\'Malgun Gothic\',sans-serif;padding:60px 20px;' +
    'text-align:center;color:#495057;font-size:15px;">' + message + '</div>'
  );
}

/**
 * 실시간 설문 - 학생이 고유키를 입력했을 때 호출. 진행 중인 문제를 조회한다.
 * 내부 오류도 "없는 키"와 동일하게 취급해 화면에 노출하지 않는다(뷰어 보안 정책과 동일).
 * @param {string} accessKey
 * @return {Object|null} { id, question_text, question_type, options } 또는 없으면 null
 */
function getSurveyQuestion(accessKey) {
  try {
    return PublishEngine.getSurveyByAccessKey(String(accessKey || '').trim());
  } catch (err) {
    // 화면에는 노출하지 않되, 실행 로그에는 원인을 남긴다(진단용).
    Logger.log('getSurveyQuestion 오류: ' + err);
    return null;
  }
}

/**
 * 실시간 설문 - 학생 답변 전송.
 * @param {number} questionId
 * @param {string} answerText
 * @return {boolean} 저장 성공 여부(false면 이미 종료된 설문)
 */
function submitSurveyAnswer(questionId, answerText) {
  return PublishEngine.submitSurveyAnswer(questionId, String(answerText || '').trim());
}

/**
 * 진단용(임시) - 이 프로젝트에 script.external_request 권한을 승인시키기 위한 함수.
 * getSurveyQuestion과 달리 try/catch로 감싸지 않아, 편집기에서 직접 실행하면
 * 권한 부족 예외가 그대로 올라와 "권한 검토" 승인 팝업이 뜬다. 승인 후 이 함수는
 * 지워도 된다.
 */
function authorizeSurveyScopes_TEMP() {
  return PublishEngine.getSurveyByAccessKey('AUTH-CHECK');
}
