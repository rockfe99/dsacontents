/**
 * 구글 슬라이드 편집 URL에서 슬라이드ID를 추출한다.
 * 예: https://docs.google.com/presentation/d/{ID}/edit#slide=id.p
 */
function extractSlideId(url) {
  const match = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error('URL에서 슬라이드ID를 찾을 수 없습니다: ' + url);
  }
  return match[1];
}

/**
 * 슬라이드ID로 프레젠테이션을 열어 목차(슬라이드별 제목)를 추출한다.
 * 반환: [{ index: 1, title: '...' }, ...]
 */
function extractSlideToc(slideId) {
  const presentation = SlidesApp.openById(slideId);
  const slides = presentation.getSlides();

  return slides.map(function (slide, i) {
    return {
      index: i + 1,
      title: getSlideTitle(slide)
    };
  });
}

/**
 * 슬라이드 한 장에서 제목 텍스트를 뽑는다.
 * 제목 플레이스홀더 우선, 없으면 슬라이드 내 첫 텍스트 도형을 사용한다.
 */
function getSlideTitle(slide) {
  const titlePlaceholder =
    slide.getPlaceholder(SlidesApp.PlaceholderType.TITLE) ||
    slide.getPlaceholder(SlidesApp.PlaceholderType.CENTERED_TITLE);

  if (titlePlaceholder) {
    const text = titlePlaceholder.asShape().getText().asString().trim();
    if (text) return text;
  }

  const shapes = slide.getShapes();
  for (let i = 0; i < shapes.length; i++) {
    try {
      const text = shapes[i].getText().asString().trim();
      if (text) return text;
    } catch (e) {
      // 텍스트 프레임이 없는 도형은 건너뜀
    }
  }

  return '(제목 없음)';
}
