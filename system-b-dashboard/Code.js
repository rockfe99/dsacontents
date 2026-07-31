/**
 * 시스템 B - 강사 대시보드
 * 설정값은 자체 스크립트 속성이 아니라 배포엔진 라이브러리에서 가져온다.
 *
 * [사전 준비 - 라이브러리 추가]
 *   1. 배포엔진 프로젝트의 스크립트 ID 확보
 *      (배포엔진 편집기 > 프로젝트 설정 > 스크립트 ID)
 *   2. 이 프로젝트 편집기 왼쪽 "라이브러리 +" 클릭
 *   3. 스크립트 ID 붙여넣고 조회 → 식별자를 'PublishEngine'으로 추가
 *   → 이후 PublishEngine.getPublicConfig() 등으로 호출
 *
 * 설정값(DB_SHEET_ID, VIEWER_URL 등)은 배포엔진 한 곳에만 저장되어 있고,
 * 이 프로젝트는 그것을 빌려 쓴다. 값이 바뀌면 배포엔진만 고치면 됨.
 */

/**
 * 웹앱 진입점. ?page=help 이면 도움말, 아니면 대시보드를 렌더링한다.
 * HtmlService 페이지는 script.googleusercontent.com iframe 안에서 뜨기 때문에
 * 화면 내 링크는 상대경로("?page=help")가 아니라 실제 배포 URL을 기준으로 한
 * 절대경로여야 한다. 그래서 baseUrl을 템플릿에 넘겨준다.
 */
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'dashboard';
  const baseUrl = ScriptApp.getService().getUrl();

  if (page === 'help') {
    const tpl = HtmlService.createTemplateFromFile('Help');
    tpl.baseUrl = baseUrl;
    return tpl.evaluate()
      .setTitle('도움말 - 강의 컨텐츠 관리')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const tpl = HtmlService.createTemplateFromFile('Dashboard');
  tpl.baseUrl = baseUrl;
  return tpl.evaluate()
    .setTitle('강의 컨텐츠 관리')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 대시보드에서 호출: 강의 목록을 스프레드시트에서 읽어 반환.
 * 설정값은 배포엔진 라이브러리에서 가져온다.
 * 반환: [{ keyword, title, updated, viewerUrl }, ...]
 */
function getLectureList() {
  // 배포엔진 라이브러리에서 공용 설정을 한 번에 가져옴
  const cfg = PublishEngine.getPublicConfig();  // { PARENT_FOLDER_ID, DB_SHEET_ID, VIEWER_URL }
  const sheetId = cfg.DB_SHEET_ID;
  const viewerBase = cfg.VIEWER_URL || '';

  if (!sheetId) {
    throw new Error('배포엔진 설정에 DB_SHEET_ID가 없습니다. 배포엔진의 스크립트 속성을 확인하세요.');
  }

  // 시트 순서가 바뀌어도 안전하도록 이름("강의목록")으로 찾는다
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('강의목록');
  if (!sheet) {
    throw new Error('DB 스프레드시트에 "강의목록" 시트가 없습니다. 시트 이름을 확인하세요.');
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  // 헤더 이름이 문서와 달라도(오타·변경) 배포엔진이 정해진 열 번호로 대체해줌
  const cols = PublishEngine.getDbColumnIndexes(values[0]);

  const rows = values.slice(1);
  return rows
    .filter(function (r) { return r[cols.keyword]; })
    .map(function (r) {
      const keyword = String(r[cols.keyword]).trim();
      return {
        keyword: keyword,
        title: String(r[cols.title] || '').trim(),
        sourceUrl: String(r[cols.sourceUrl] || '').trim(),
        updated: formatDate_(r[cols.updated]),
        viewerUrl: viewerBase ? (viewerBase + '?k=' + encodeURIComponent(keyword)) : ''
      };
    });
}

/**
 * 대시보드의 [배포] 버튼에서 호출: 새 강의 추가/배포 수정 공용.
 * 실제 처리는 배포엔진에 위임(다리 역할).
 * isNew=true("새 강의 추가")인데 이미 있는 키워드면 등록을 막는다 — 기존 강의
 * 수정은 반드시 목록의 "배포 수정"(isNew=false)으로만 하도록 강제.
 * 배포 수정에서 URL을 비워두면(기존 슬라이드 그대로 유지) 제목만 갱신하고
 * 목차는 재추출하지 않는다 — URL을 입력하면 그 슬라이드로 전체 재배포한다.
 * tocMethod: 목차 추출 방식 - 'title'(제목만) 또는 'firstText'(첫 문자열).
 *            URL이 없으면(제목만 갱신) 슬라이드를 다시 안 읽으므로 무시된다.
 * @return {Object} { keyword, title, slideId, viewerUrl }
 */
function deployLecture(url, keyword, title, isNew, tocMethod) {
  const cleanUrl = String(url || '').trim();
  const cleanKeyword = String(keyword || '').trim();
  const cleanTitle = String(title || '').trim();
  const cleanTocMethod = (tocMethod === 'firstText') ? 'firstText' : 'title';

  if (!cleanKeyword || !cleanTitle) {
    throw new Error('키워드와 제목을 입력하세요.');
  }

  if (isNew) {
    if (!cleanUrl) {
      throw new Error('키워드, 제목, 슬라이드 URL을 모두 입력하세요.');
    }
    if (PublishEngine.lectureExists(cleanKeyword)) {
      throw new Error('이미 등록된 키워드입니다: ' + cleanKeyword + ' (기존 강의는 목록의 "배포 수정"으로 변경하세요)');
    }
    return PublishEngine.publishLecture(cleanUrl, cleanKeyword, cleanTitle, cleanTocMethod);
  }

  if (cleanUrl) {
    return PublishEngine.publishLecture(cleanUrl, cleanKeyword, cleanTitle, cleanTocMethod);
  }
  return PublishEngine.updateLectureTitle(cleanKeyword, cleanTitle);
}

/**
 * 대시보드의 "배포 수정" 모달 [삭제] 버튼에서 호출: 배포를 내린다.
 * 실제 처리는 배포엔진에 위임(다리 역할). 슬라이드 파일 자체는 삭제되지 않고
 * 공유 범위만 되돌아가며, 목차 json 삭제와 DB 행 제거까지 배포엔진이 처리한다.
 * @return {Object} { keyword }
 */
function deleteLecture(keyword) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) {
    throw new Error('키워드가 없습니다.');
  }
  return PublishEngine.unpublishLecture(cleanKeyword);
}

/** 날짜 값을 'yyyy-MM-dd HH:mm' 문자열로 변환. */
function formatDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return String(value);
}

/**
 * 실시간 설문 - "학생들에게 공개" 버튼에서 호출. 저장·고유키 생성은
 * 배포엔진(publish-engine/Survey.js)에 위임한다.
 * @param {string} keyword           강의 키워드
 * @param {string} questionText
 * @param {string} questionType      'multiple_choice' | 'short_answer' | 'opinion'
 * @param {Array<string>|null} options          객관식 보기(그 외 타입은 무시됨)
 * @param {string} correctAnswersCsv 쉼표로 구분된 정답들(의견형은 무시됨)
 * @return {Object} { id, access_key, started_at, ... }
 */
function createSurvey(keyword, questionText, questionType, options, correctAnswersCsv) {
  var cleanKeyword = String(keyword || '').trim();
  var cleanQuestion = String(questionText || '').trim();

  if (!cleanKeyword || !cleanQuestion) {
    throw new Error('강의 키워드와 질문 내용을 입력하세요.');
  }
  if (['multiple_choice', 'short_answer', 'opinion'].indexOf(questionType) === -1) {
    throw new Error('알 수 없는 문제 유형입니다.');
  }

  var cleanOptions = null;
  if (questionType === 'multiple_choice') {
    cleanOptions = (options || []).map(function (o) { return String(o).trim(); }).filter(function (o) { return o; });
    if (cleanOptions.length < 2) {
      throw new Error('객관식은 선택보기를 2개 이상 입력하세요.');
    }
  }

  // 의견형은 정답을 입력받지 않고 채점도 하지 않는다.
  var cleanAnswers = null;
  if (questionType !== 'opinion') {
    cleanAnswers = String(correctAnswersCsv || '')
      .split(',')
      .map(function (a) { return a.trim(); })
      .filter(function (a) { return a; });
    if (cleanAnswers.length === 0) {
      throw new Error('정답을 최소 1개 입력하세요.');
    }
    // 객관식은 텍스트가 아니라 보기 번호(1부터)로 정답을 받는다 - 학생 제출값도 번호라
    // 텍스트 일치 여부를 따질 필요가 없어지고 오타·표현 차이 문제가 사라진다.
    if (questionType === 'multiple_choice') {
      var optionCount = cleanOptions.length;
      var hasInvalid = cleanAnswers.some(function (a) {
        var n = Number(a);
        return !Number.isInteger(n) || n < 1 || n > optionCount;
      });
      if (hasInvalid) {
        throw new Error('정답은 1~' + optionCount + ' 사이의 보기 번호로 입력하세요(여러 개면 쉼표로 구분).');
      }
    }
  }

  return PublishEngine.createSurveyQuestion(cleanKeyword, cleanQuestion, questionType, cleanOptions, cleanAnswers);
}

/**
 * 실시간 설문 - "설문종료" 버튼에서 호출. 종료 처리 → 임시답변 집계/채점
 * (또는 의견형은 summarizeOpinions_() 요약) → 결과 영구 저장까지 한 번에 수행한다.
 * 의견형 요약(ai-server)이 실패해도 학생 답변 원문(opinion_raw)은 그대로
 * 결과에 남기고 finalizeSurveyResult는 항상 호출한다 - 재시도 없이도
 * 데이터 유실이 생기지 않도록 하기 위함.
 * @param {number} questionId
 * @return {Object} 결과(화면 렌더링용) { question_text, question_type,
 *                    total_responses, correct_count, accuracy_rate,
 *                    answer_distribution, opinion_summary, opinion_raw }
 */
function finishSurvey(questionId) {
  var q = PublishEngine.endSurveyQuestion(questionId);
  var answers = PublishEngine.getSurveyTempAnswers(questionId);

  var result = { total_responses: answers.length };

  if (q.question_type === 'opinion') {
    result.correct_count = null;
    result.accuracy_rate = null;
    result.answer_distribution = null;
    result.opinion_raw = answers;
    if (answers.length === 0) {
      result.opinion_summary = null;
    } else {
      result.opinion_summary = summarizeOpinions_(q.lecture_keyword, q.question_text, answers);
    }
  } else {
    var correctSet = {};
    (q.correct_answers || []).forEach(function (c) { correctSet[normalizeAnswer_(c)] = true; });

    var isMultipleChoice = (q.question_type === 'multiple_choice');

    // 정규화(공백·대소문자 무시) 키로 묶는다. 객관식은 제출값이 보기 번호이므로,
    // 화면 표시용 라벨은 그 번호에 해당하는 보기 텍스트로 바꿔서 보여준다.
    var groups = {};
    answers.forEach(function (a) {
      var key = normalizeAnswer_(a);
      if (!key) return;
      if (!groups[key]) {
        var label = String(a).trim();
        if (isMultipleChoice) {
          var idx = parseInt(label, 10);
          if (Number.isInteger(idx) && q.options && q.options[idx - 1] != null) {
            label = idx + '. ' + q.options[idx - 1];
          }
        }
        groups[key] = { count: 0, label: label };
      }
      groups[key].count++;
    });

    var total = answers.length;
    var correctCount = 0;
    var distribution = Object.keys(groups).map(function (key) {
      var g = groups[key];
      var isCorrect = !!correctSet[key];
      if (isCorrect) correctCount += g.count;
      return {
        label: g.label,
        count: g.count,
        ratio: total ? Math.round(g.count / total * 1000) / 10 : 0,
        is_correct: isCorrect
      };
    }).sort(function (a, b) { return b.count - a.count; });

    result.correct_count = correctCount;
    result.accuracy_rate = total ? Math.round(correctCount / total * 10000) / 100 : 0;
    result.answer_distribution = distribution;
    result.opinion_summary = null;
    result.opinion_raw = null;
  }

  PublishEngine.finalizeSurveyResult(questionId, result);

  result.question_text = q.question_text;
  result.question_type = q.question_type;
  return result;
}

/** 채점·집계용 정규화: 앞뒤 공백 제거, 연속 공백 하나로, 대소문자 무시. */
function normalizeAnswer_(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 실시간 설문 의견형 결과 요약 - ai-server(Cloud Run)의 POST /opinion-summary를
 * 호출한다(CLAUDE.md 정책: AI 기능은 GAS에서 모델 API를 직접 부르지 않고 전부
 * ai-server 엔드포인트로 위임, GAS는 UrlFetchApp으로 그 엔드포인트만 호출).
 * AI_MODE가 꺼져 있거나, 서버 설정이 없거나, 호출이 실패·타임아웃·오류 응답이면
 * 원인을 불문하고 null을 반환한다 - 예외를 던지지 않는다. 호출자(finishSurvey)는
 * null을 받으면 크레딧 모달이 아니라 학생 답변 원문을 그대로 보여주는 방식으로
 * 흡수한다(CLAUDE.md 개발 규칙 10). 상세 원인은 로그로만 남긴다.
 * @param {string} keyword
 * @param {string} questionText
 * @param {Array<string>} answers
 * @return {string|null}
 */
function summarizeOpinions_(keyword, questionText, answers) {
  if (!isAiEnabled()) return null;

  try {
    var serverUrl = PublishEngine.getSetting('AI_SERVER_URL');
    var apiKey = PublishEngine.getSecret('AI_SERVER_KEY');
    if (!serverUrl || !apiKey) {
      throw new Error('AI_SERVER_URL/AI_SERVER_KEY가 설정되어 있지 않다.');
    }

    var res = UrlFetchApp.fetch(serverUrl + '/opinion-summary', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': apiKey },
      payload: JSON.stringify({
        keyword: keyword,
        question_text: questionText,
        answers: answers
      }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      Logger.log('의견형 요약 서버 오류: %s %s', res.getResponseCode(), res.getContentText());
      return null;
    }

    var data = JSON.parse(res.getContentText());
    return (data && data.summary) ? data.summary : null;
  } catch (err) {
    Logger.log('의견형 요약 오류: %s', err);
    return null;
  }
}

/**
 * 대시보드에서 호출: AI 활용 기능(시험문제 생성·가상질문 생성·강의자료 평가) 사용
 * 가능 여부. 배포엔진의 AI_MODE 스크립트 속성이 'true'일 때만 true - 관리자가
 * 이 값을 스크립트 속성에서 바꿔가며 AI 기능을 즉시 켜고 끌 수 있다(미설정 시
 * 안전하게 꺼진 것으로 간주).
 * @return {boolean}
 */
function isAiEnabled() {
  return PublishEngine.getSetting('AI_MODE') === 'true';
}

/**
 * 시험문제 자동생성 - ai-server(Cloud Run, Python+LangChain)를 호출해 문제 목록을
 * 받아온다. slide_contents(그 키워드의 슬라이드 본문)를 근거로 생성된다.
 * CLAUDE.md 규칙 10: 호출 실패(오류·타임아웃·할당량 등)는 원인 불문하고 고정
 * 안내 문구로 흡수하고, 배포·목차 등 나머지 기능에는 영향이 없어야 한다.
 * AI_MODE가 꺼져 있으면 ai-server를 아예 호출하지 않고 바로 에러로 응답한다
 * (화면 쪽 안내 문구는 대시보드가 통일해서 띄운다 - 여기서는 성공/실패만 전달).
 * @param {string} keyword
 * @param {string} questionType  'multiple_choice' | 'short_answer'
 * @param {number} count
 * @param {string} provider  'gemini' | 'chatgpt' | 'claude' (현재는 'gemini'만 지원)
 * @return {Object} { questions: [...] } 또는 실패 시 { error: true }
 */
function generateExamQuestions(keyword, questionType, count, provider) {
  try {
    if (!isAiEnabled()) {
      return { error: true };
    }

    var serverUrl = PublishEngine.getSetting('AI_SERVER_URL');
    var apiKey = PublishEngine.getSecret('AI_SERVER_KEY');
    if (!serverUrl || !apiKey) {
      throw new Error('AI_SERVER_URL/AI_SERVER_KEY가 설정되어 있지 않습니다.');
    }

    var res = UrlFetchApp.fetch(serverUrl + '/exam-questions', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': apiKey },
      payload: JSON.stringify({
        keyword: keyword,
        question_type: questionType,
        count: count,
        provider: provider || 'gemini'
      }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      Logger.log('시험문제 생성 서버 오류: %s %s', res.getResponseCode(), res.getContentText());
      return { error: true };
    }

    return JSON.parse(res.getContentText());
  } catch (err) {
    Logger.log('시험문제 생성 오류: %s', err);
    return { error: true };
  }
}