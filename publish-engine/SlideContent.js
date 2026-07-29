/**
 * ============================================================
 *  SlideContent.js — 슬라이드 본문 텍스트 저장 (Supabase slide_contents)
 * ============================================================
 *  강의 요약·챗봇·강의자료평가·시험문제 생성에 쓸 원문. survey_results와
 *  달리 "누적"이 아니라 "현재 슬라이드의 스냅샷"이다 - 재배포(URL 변경) 시
 *  이전 내용을 지우고 새로 채운다(DB구조.sql 4번 섹션 참고).
 *
 *  supabaseRequest_()는 Survey.js에 정의되어 있고 같은 프로젝트 안이라
 *  그대로 재사용한다(중복 구현 안 함).
 * ============================================================
 */

/**
 * 슬라이드 본문 텍스트를 추출해 그 키워드의 기존 내용을 지우고 새로 저장한다.
 * Publish.js의 publishLecture()에서 신규 등록·URL 재배포 시 호출한다(제목만
 * 수정할 때는 호출하지 않음 - 슬라이드 내용 자체가 안 바뀌므로).
 * @param {string} keyword
 * @param {string} slideId
 */
function saveSlideContents_(keyword, slideId) {
  const contents = extractSlideContents(slideId);

  deleteSlideContentsForKeyword(keyword);
  if (!contents.length) return;

  const rows = contents.map(function (c) {
    return {
      lecture_keyword: keyword,
      slide_index: c.index,
      object_id: c.objectId,
      slide_text: c.text
    };
  });

  const res = supabaseRequest_('slide_contents', 'post', rows);
  if (res.code !== 201) {
    throw new Error('슬라이드 본문 저장 실패: ' + res.code + ' ' + JSON.stringify(res.body));
  }
}

/**
 * 그 키워드로 저장된 슬라이드 본문 텍스트를 전부 삭제한다.
 * Publish.js의 unpublishLecture()에서 강의 완전 삭제 시 호출한다(라이브러리 공개 함수).
 * @param {string} keyword
 */
function deleteSlideContentsForKeyword(keyword) {
  supabaseRequest_('slide_contents?lecture_keyword=eq.' + encodeURIComponent(keyword), 'delete');
}
