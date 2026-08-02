/**
 * ============================================================
 *  LectureEvaluation.js — 강의자료 평가 데이터 계층 (Supabase 연동)
 * ============================================================
 *  시스템 B(강사 대시보드)가 이 라이브러리를 통해서만 강의자료 평가 결과
 *  테이블(DB구조.sql 6-1번 섹션 lecture_evaluations)에 접근한다.
 *
 *  AI 생성 자체(ai-server POST /lecture-evaluation 호출)는 여기서 하지 않는다 -
 *  CLAUDE.md 규칙상 AI 호출은 전부 ai-server 경유이고, 시스템 B의
 *  generateLectureEvaluation()이 그 호출을 맡는다. 이 파일은 순수 DB
 *  접근(결과 캐시 조회/저장/삭제)만 담당한다.
 *
 *  supabaseRequest_()는 Survey.js에 정의되어 있고 같은 프로젝트 안이라
 *  그대로 재사용한다(중복 구현 안 함).
 * ============================================================
 */

/**
 * 이미 생성되어 있는 강의자료 평가 결과를 조회한다(강의 키워드당 1건 -
 * "다시 평가"를 누르기 전까지는 이 캐시를 그대로 보여준다).
 * @param {string} keyword
 * @return {Object|null} { evidence_basis, structure_review, learner_signal_review,
 *   currency_review, suggestions, data_coverage, generated_at } 또는 없으면 null
 */
function getLectureEvaluation(keyword) {
  var query = 'lecture_keyword=eq.' + encodeURIComponent(keyword) +
    '&select=evidence_basis,structure_review,learner_signal_review,currency_review,suggestions,data_coverage,generated_at';
  var res = supabaseRequest_('lecture_evaluations?' + query, 'get');
  if (res.code !== 200) {
    throw new Error('강의자료 평가 결과 조회 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
  return (res.body && res.body.length) ? res.body[0] : null;
}

/**
 * 강의자료 평가 결과를 저장한다. 키워드당 최신 결과 1건만 유지한다
 * (uq_lecture_evaluations_keyword 유니크 인덱스 기준 UPSERT) - "다시 평가"면
 * 기존 결과를 덮어쓰고, 히스토리는 누적하지 않는다.
 * @param {string} keyword
 * @param {Object} result  ai-server POST /lecture-evaluation 응답 그대로
 *   { evidence_basis, structure_review, learner_signal_review, currency_review,
 *     suggestions, data_coverage }
 */
function saveLectureEvaluation(keyword, result) {
  var payload = {
    lecture_keyword: keyword,
    evidence_basis: result.evidence_basis,
    structure_review: result.structure_review,
    learner_signal_review: result.learner_signal_review || null,
    currency_review: result.currency_review || null,
    suggestions: result.suggestions || [],
    data_coverage: result.data_coverage,
    generated_at: new Date().toISOString()
  };
  var res = supabaseRequest_(
    'lecture_evaluations?on_conflict=lecture_keyword',
    'post',
    payload,
    { 'Prefer': 'resolution=merge-duplicates,return=representation' }
  );
  if (res.code !== 201 && res.code !== 200) {
    throw new Error('강의자료 평가 결과 저장 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
}

/**
 * 강의(키워드)를 완전히 삭제할 때 그 키워드의 강의자료 평가 결과를 지운다.
 * Publish.js의 unpublishLecture()에서 설문·슬라이드본문·가상질문 삭제와 함께
 * 호출한다(키워드 재사용 시 예전 강의의 평가 결과가 새 강의에 섞이지 않도록 함).
 * @param {string} keyword
 */
function deleteLectureEvaluationForKeyword(keyword) {
  supabaseRequest_('lecture_evaluations?lecture_keyword=eq.' + encodeURIComponent(keyword), 'delete');
}
