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

/** 제목/첫 텍스트를 못 찾았을 때의 표식. 이 값인 슬라이드는 목차에서 제외한다. */
const NO_TITLE_ = '(제목 없음)';

/**
 * 슬라이드ID로 프레젠테이션을 열어 목차(슬라이드별 제목)를 추출한다.
 * 제목(또는 첫 텍스트)이 없는 슬라이드는 목차에 아예 포함하지 않는다 — 그래서
 * index는 원래 슬라이드 위치를 그대로 유지하며(연속되지 않을 수 있음), 목차
 * 항목 개수만큼 재번호를 매기지 않는다.
 * objectId는 뷰어에서 목차 클릭 시 해당 슬라이드로 바로 이동하는 데 쓰인다.
 * @param {string} slideId
 * @param {string} [method]  'title'(제목 플레이스홀더만, 기본값) 또는
 *                            'firstText'(슬라이드의 첫 텍스트 도형 사용)
 * 반환: [{ index: 1, objectId: '...', title: '...' }, ...]  (제목 없는 슬라이드 제외)
 */
function extractSlideToc(slideId, method) {
  const presentation = SlidesApp.openById(slideId);
  const slides = presentation.getSlides();

  const toc = [];
  slides.forEach(function (slide, i) {
    const title = getSlideTitle(slide, method);
    if (title === NO_TITLE_) return; // 제목 없는 슬라이드는 목차에서 제외
    toc.push({
      index: i + 1,
      objectId: slide.getObjectId(),
      title: title
    });
  });
  return toc;
}

/**
 * 슬라이드 한 장에서 목차용 텍스트를 뽑는다. 방식은 두 가지 중 하나(교집합 없음):
 * - 'title'(기본값): 제목 플레이스홀더(TITLE/CENTERED_TITLE)만 사용, 없으면 "(제목 없음)"
 * - 'firstText': 플레이스홀더 구분 없이 슬라이드 내 첫 번째 텍스트 도형을 그대로 사용
 */
function getSlideTitle(slide, method) {
  if (method === 'firstText') {
    return getFirstShapeText_(slide);
  }
  return getTitlePlaceholderText_(slide);
}

/** 'title' 방식: 제목 플레이스홀더만 확인(대체 없음). */
function getTitlePlaceholderText_(slide) {
  const titlePlaceholder =
    slide.getPlaceholder(SlidesApp.PlaceholderType.TITLE) ||
    slide.getPlaceholder(SlidesApp.PlaceholderType.CENTERED_TITLE);

  if (titlePlaceholder) {
    const text = titlePlaceholder.asShape().getText().asString().trim();
    if (text) return text;
  }
  return NO_TITLE_;
}

/** 'firstText' 방식: 슬라이드 내 도형을 순서대로 훑어 첫 번째 텍스트를 사용. */
function getFirstShapeText_(slide) {
  const shapes = slide.getShapes();
  for (let i = 0; i < shapes.length; i++) {
    try {
      const text = shapes[i].getText().asString().trim();
      if (text) return text;
    } catch (e) {
      // 텍스트 프레임이 없는 도형은 건너뜀
    }
  }
  return NO_TITLE_;
}
