/**
 * ============================================================
 *  Survey.js — 실시간 설문 데이터 계층 (Supabase 연동)
 * ============================================================
 *  시스템 B(강사 대시보드)·시스템 A(수강생 뷰어)가 이 라이브러리를 통해서만
 *  Supabase의 설문 테이블에 접근한다. 둘 다 SUPABASE_KEY(service_role)를
 *  직접 갖지 않고, 이 파일이 대신 REST API를 호출한다.
 *
 *  AI 호출(의견형 요약)은 여기서 하지 않는다 - CLAUDE.md 규칙상 AI 호출은
 *  시스템 B의 callAI_()에서만 하고, 이 파일은 순수 DB 접근만 담당한다.
 *
 *  [사전 준비] Supabase 프로젝트에 저장소 최상위의 DB구조.sql을 실행해
 *  테이블·인덱스·RLS·함수(submit_survey_answer, finalize_survey)를
 *  만들어둘 것.
 * ============================================================
 */

// 숫자와 헷갈리는 O, I와 문자와 헷갈리는 0, 1은 제외한다(32자)
var SURVEY_ACCESS_KEY_CHARS_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var SURVEY_ACCESS_KEY_LENGTH_ = 4;
var SURVEY_STALE_HOURS_ = 24;

/**
 * 새 설문 문제를 공개한다("학생들에게 공개" 버튼). 저장 직전, 하루 이상
 * 지난 미완료 설문을 정리한다(DB구조.sql 처리 흐름 0단계).
 * @param {string} lectureKeyword
 * @param {string} questionText
 * @param {string} questionType       'multiple_choice' | 'short_answer' | 'opinion'
 * @param {Array<string>|null} options        객관식 보기(그 외 타입은 null)
 * @param {Array<string>|null} correctAnswers 정답들(의견형은 null)
 * @return {Object} 생성된 행 { id, access_key, lecture_keyword, question_text,
 *                              question_type, options, correct_answers, started_at }
 */
function createSurveyQuestion(lectureKeyword, questionText, questionType, options, correctAnswers) {
  cleanupStaleSurveys_();

  var payload = {
    lecture_keyword: lectureKeyword,
    question_text: questionText,
    question_type: questionType,
    options: options || null,
    correct_answers: correctAnswers || null
  };

  for (var attempt = 0; attempt < 5; attempt++) {
    payload.access_key = generateSurveyAccessKey_();
    var res = supabaseRequest_('survey_temp_questions', 'post', payload, { 'Prefer': 'return=representation' });

    if (res.code === 201) {
      return res.body[0];
    }
    if (!isDuplicateKeyError_(res)) {
      throw new Error('설문 문제 저장 실패: ' + res.code + ' ' + JSON.stringify(res.body));
    }
    // 활성 고유키 충돌 - 새 키로 재시도
  }
  throw new Error('고유키 생성에 반복 실패했습니다. 다시 시도해 주세요.');
}

/**
 * 학생이 입력한 고유키로 진행 중인 문제를 조회한다.
 * @param {string} accessKey
 * @return {Object|null} { id, lecture_keyword, question_text, question_type, options } 또는 없으면 null
 */
function getSurveyByAccessKey(accessKey) {
  var query = 'access_key=eq.' + encodeURIComponent(accessKey) +
    '&status=eq.active&select=id,lecture_keyword,question_text,question_type,options';
  var res = supabaseRequest_('survey_temp_questions?' + query, 'get');
  if (res.code !== 200 || !res.body || !res.body.length) return null;
  return res.body[0];
}

/**
 * 학생 답변을 제출한다. 문제가 활성 상태일 때만 저장된다(원자적 RPC).
 * @param {number} questionId
 * @param {string} answerText
 * @return {boolean} 저장 성공 여부(false면 없는 문제이거나 이미 종료됨)
 */
function submitSurveyAnswer(questionId, answerText) {
  var res = supabaseRequest_('rpc/submit_survey_answer', 'post', {
    p_question_id: questionId,
    p_answer: answerText
  });
  if (res.code !== 200) {
    throw new Error('답변 제출 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return res.body === true;
}

/**
 * 설문을 종료 상태로 바꾸고(이후 답변 접수 중단), 채점·집계에 필요한
 * 문제 정보를 반환한다. "설문종료" 버튼에서 호출.
 * @param {number} questionId
 * @return {Object} { id, lecture_keyword, question_text, question_type, options, correct_answers }
 */
function endSurveyQuestion(questionId) {
  var res = supabaseRequest_('survey_temp_questions?id=eq.' + questionId, 'patch', {
    status: 'ended',
    ended_at: new Date().toISOString()
  }, { 'Prefer': 'return=representation' });

  if (res.code !== 200 || !res.body || !res.body.length) {
    throw new Error('설문 종료 처리 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return res.body[0];
}

/**
 * 종료된 문제에 쌓인 임시 답변 전체를 텍스트 배열로 반환한다.
 * @param {number} questionId
 * @return {Array<string>}
 */
function getSurveyTempAnswers(questionId) {
  var query = 'question_id=eq.' + questionId + '&select=answer_text';
  var res = supabaseRequest_('survey_temp_answers?' + query, 'get');
  if (res.code !== 200) {
    throw new Error('답변 조회 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return (res.body || []).map(function (r) { return r.answer_text; });
}

/**
 * 채점·요약이 끝난 결과를 영구 저장하고, 작업 테이블(문제+임시답변)을
 * 정리한다. finalize_survey RPC 한 트랜잭션으로 처리되어 결과 저장과
 * 정리가 함께 성공/실패한다(DB구조.sql 참고).
 * @param {number} questionId
 * @param {Object} result  { total_responses, correct_count, accuracy_rate,
 *                            answer_distribution, opinion_summary, opinion_raw }
 */
function finalizeSurveyResult(questionId, result) {
  var res = supabaseRequest_('rpc/finalize_survey', 'post', {
    p_question_id: questionId,
    p_result: result
  });
  if (res.code !== 200 && res.code !== 204) {
    throw new Error('설문 결과 저장 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
}

/**
 * 결과를 저장하지 않고 종료할 때("결과를 저장하지 않고 종료" 버튼) 호출.
 * finalizeSurveyResult()와 달리 survey_results에는 아무것도 남기지 않고,
 * 작업 테이블 행만 지운다(survey_temp_answers는 cascade로 함께 삭제).
 * @param {number} questionId
 */
function discardSurveyQuestion(questionId) {
  var res = supabaseRequest_('survey_temp_questions?id=eq.' + questionId, 'delete');
  if (res.code !== 200 && res.code !== 204) {
    throw new Error('설문 결과 폐기 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
}

/** 하루 이상 지난 미완료(active/ended 무관) 설문 문제를 지운다. 임시답변은 cascade 삭제. */
function cleanupStaleSurveys_() {
  var cutoff = new Date(Date.now() - SURVEY_STALE_HOURS_ * 3600 * 1000).toISOString();
  supabaseRequest_('survey_temp_questions?started_at=lt.' + encodeURIComponent(cutoff), 'delete');
}

/**
 * 강의(키워드)를 완전히 삭제할 때 그 키워드에 쌓인 설문 데이터를 전부 지운다.
 * Publish.js의 unpublishLecture()에서 DB 시트 행·키워드.json 삭제와 함께 호출한다
 * (키워드 재사용 시 예전 강의의 설문 결과가 새 강의에 섞이는 것을 방지).
 * 나중에 슬라이드 본문 텍스트 저장 테이블이 생기면, 그 테이블의 키워드별 삭제도
 * 이 함수에 같이 추가할 것.
 * @param {string} lectureKeyword
 */
function deleteSurveyDataForKeyword(lectureKeyword) {
  var keyword = encodeURIComponent(lectureKeyword);
  // survey_temp_questions 삭제 시 survey_temp_answers는 on delete cascade로 함께 삭제됨
  supabaseRequest_('survey_temp_questions?lecture_keyword=eq.' + keyword, 'delete');
  supabaseRequest_('survey_results?lecture_keyword=eq.' + keyword, 'delete');
}

/** 영문 대문자+숫자 고유키를 생성한다(헷갈리는 O/I/0/1 제외, 4자리). */
function generateSurveyAccessKey_() {
  var key = '';
  for (var i = 0; i < SURVEY_ACCESS_KEY_LENGTH_; i++) {
    key += SURVEY_ACCESS_KEY_CHARS_.charAt(Math.floor(Math.random() * SURVEY_ACCESS_KEY_CHARS_.length));
  }
  return key;
}

/** PostgREST 유니크 제약 위반(23505, 활성 고유키 충돌) 응답인지 확인한다. */
function isDuplicateKeyError_(res) {
  return res.code === 409 && res.body && res.body.code === '23505';
}

/**
 * Supabase REST(PostgREST)에 요청을 보낸다. service_role 키는 이 함수 안에서만 다룬다.
 * @param {string} path    'survey_temp_questions', 'survey_temp_questions?id=eq.1', 'rpc/xxx' 등
 * @param {string} method  'get' | 'post' | 'patch' | 'delete'
 * @param {Object} [payload]
 * @param {Object} [extraHeaders]
 * @return {Object} { code, body }
 */
function supabaseRequest_(path, method, payload, extraHeaders) {
  var baseUrl = getSecret('SUPABASE_URL');
  var apiKey = getSecret('SUPABASE_KEY');
  if (!baseUrl || !apiKey) {
    throw new Error('SUPABASE_URL/SUPABASE_KEY가 설정되어 있지 않습니다.');
  }

  // UrlFetchApp은 User-Agent 헤더를 커스텀으로 못 바꾼다(넣어도 무시되고 항상
  // 구글 기본값 'Mozilla/5.0 (compatible; Google-Apps-Script; ...)'가 나간다).
  // 그래서 SUPABASE_KEY는 브라우저 감지 가드가 있는 새 sb_secret_ 형식이 아니라
  // 그 가드가 없는 예전 방식 JWT service_role 키를 써야 한다(스크립트 속성 값 문제,
  // 이 함수에서 고칠 수 있는 부분이 아님).
  var headers = {
    'apikey': apiKey,
    'Authorization': 'Bearer ' + apiKey
  };
  Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });

  var options = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(baseUrl + '/rest/v1/' + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  var body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (e) { body = text; }
  }
  return { code: code, body: body };
}
