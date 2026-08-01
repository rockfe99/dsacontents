/**
 * ============================================================
 *  VirtualQuestion.js — 가상질문 생성 데이터 계층 (Supabase 연동)
 * ============================================================
 *  시스템 B(강사 대시보드)가 이 라이브러리를 통해서만 가상질문 페르소나·
 *  결과 테이블(DB구조.sql 5·6번 섹션)에 접근한다.
 *
 *  AI 생성 자체(ai-server POST /virtual-questions 호출)는 여기서 하지 않는다 -
 *  CLAUDE.md 규칙상 AI 호출은 전부 ai-server 경유이고, 시스템 B의
 *  generateVirtualQuestions()가 그 호출을 맡는다. 이 파일은 순수 DB
 *  접근(페르소나 조회, 결과 캐시 조회/저장)만 담당한다.
 *
 *  supabaseRequest_()는 Survey.js에 정의되어 있고 같은 프로젝트 안이라
 *  그대로 재사용한다(중복 구현 안 함).
 * ============================================================
 */

/**
 * 화면(페르소나 선택 모달)에 보여줄 학생 목록(활성분만, display_order 순).
 * prompt(AI 지시문)는 ai-server가 조회 시점에 직접 읽어서 쓰므로 대시보드에는
 * 내려주지 않는다.
 * @return {Array<Object>} [{ persona_id, name, description, display_order }, ...]
 */
function getVirtualQuestionPersonas() {
  var query = 'active=eq.true&select=persona_id,name,description,display_order&order=display_order.asc';
  var res = supabaseRequest_('virtual_question_personas?' + query, 'get');
  if (res.code !== 200) {
    throw new Error('페르소나 목록 조회 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return res.body || [];
}

/**
 * 이미 생성되어 있는 가상질문 결과를 조회한다(강의 키워드+페르소나 조합당 1건 -
 * "다시 생성"을 누르기 전까지는 이 캐시를 그대로 보여준다).
 * @param {string} keyword
 * @param {string} personaId
 * @return {Object|null} { questions, generated_at } 또는 없으면 null
 */
function getVirtualQuestions(keyword, personaId) {
  var query = 'lecture_keyword=eq.' + encodeURIComponent(keyword) +
    '&persona_id=eq.' + encodeURIComponent(personaId) +
    '&select=questions,generated_at';
  var res = supabaseRequest_('virtual_questions?' + query, 'get');
  if (res.code !== 200) {
    throw new Error('가상질문 결과 조회 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return (res.body && res.body.length) ? res.body[0] : null;
}

/**
 * 가상질문 생성 결과를 저장한다. 키워드+페르소나 조합당 최신 결과 1건만
 * 유지한다(uq_virtual_questions_keyword_persona 유니크 인덱스 기준 UPSERT) -
 * "다시 생성"이면 기존 결과를 덮어쓰고, 히스토리는 누적하지 않는다.
 * @param {string} keyword
 * @param {string} personaId
 * @param {Array<Object>} questions  [{ batch, question }, ...] (필터링된 최종본)
 */
function saveVirtualQuestions(keyword, personaId, questions) {
  var payload = {
    lecture_keyword: keyword,
    persona_id: personaId,
    questions: questions,
    generated_at: new Date().toISOString()
  };
  var res = supabaseRequest_(
    'virtual_questions?on_conflict=lecture_keyword,persona_id',
    'post',
    payload,
    { 'Prefer': 'resolution=merge-duplicates,return=representation' }
  );
  if (res.code !== 201 && res.code !== 200) {
    throw new Error('가상질문 결과 저장 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
}

/**
 * 강의(키워드)를 완전히 삭제할 때 그 키워드에 쌓인 가상질문 결과를 전부 지운다.
 * Publish.js의 unpublishLecture()에서 설문·슬라이드본문 삭제와 함께 호출한다
 * (키워드 재사용 시 예전 강의의 가상질문 결과가 새 강의에 섞이지 않도록 함).
 * @param {string} keyword
 */
function deleteVirtualQuestionsForKeyword(keyword) {
  supabaseRequest_('virtual_questions?lecture_keyword=eq.' + encodeURIComponent(keyword), 'delete');
}
