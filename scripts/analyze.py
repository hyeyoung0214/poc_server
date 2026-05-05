import os
import re
import json
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import google.generativeai as genai

log = logging.getLogger("analyze")

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

_model = genai.GenerativeModel(
    "gemini-3-flash-preview",
    generation_config={
        "response_mime_type": "application/json",
        "temperature": 0.1,
    },
)

# === 미디어 애널리스트 페르소나 ===
PERSONA = """\
당신은 한국 자동차·에너지 산업을 10년 이상 분석해 온 시니어 미디어 애널리스트입니다.
기업의 PR 의도, 산업·정책 동향, 시장 영향력, 보도 프레임을 종합적으로 평가하는 전문가입니다.
관심 영역: 현대자동차그룹 HTWO 사업부, 수소연료전지(FCEV), 수소 모빌리티(트럭·버스·철도·선박),
수소충전 인프라, 글로벌 수소 정책 및 경쟁사 동향.
당신은 분석 결과를 항상 객관적이고 정밀한 JSON 형식으로 제공합니다."""


BASE_CATEGORIES = [
    "수소차/HTWO 직접",
    "수소 모빌리티",
    "모빌리티 일반",
    "기타",
]
BASE_CATEGORY_SET = set(BASE_CATEGORIES)


def build_prompt(title: str, description: str, keyword_categories: list) -> str:
    """기사·키워드 카테고리를 기반으로 동적 프롬프트 생성"""
    keyword_categories = list(keyword_categories or [])
    cat_enum = " | ".join(BASE_CATEGORIES + keyword_categories)
    kw_rule = ""
    if keyword_categories:
        kw_list = ", ".join(f'"{k}"' for k in keyword_categories)
        kw_rule = (
            f"\n  ※ 단, 기사의 가장 핵심 주제가 다음 키워드 중 하나라면 "
            f"위 4개 대신 해당 키워드를 카테고리로 선택하세요: {kw_list}\n"
            f"     (여러 키워드가 동시에 매칭되면 가장 비중이 큰 1개만 선택, "
            f"키워드가 부수적으로만 언급되면 무시하고 위 4개 중 적절한 것 선택)"
        )

    return PERSONA + f"""

[분석 대상 기사]
제목: {title}
내용: {description}

[분석 관점]
이 기사를 "현대자동차 HTWO 사업부 및 수소연료전지·수소 모빌리티 사업"의
미디어 모니터링 관점에서 평가해주세요.

[필수 출력 — 아래 JSON 형식만 사용]
{{
  "summary": "기사 핵심을 2-3문장 객관적으로 요약",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3", "핵심키워드4", "핵심키워드5"],
  "sentiment": "positive | negative | neutral",
  "sentiment_score": 0.0,
  "sentiment_reason": "감성 판단 근거 한 문장",
  "relevance_score": 0.0,
  "relevance_reason": "HTWO·수소연료전지·수소 모빌리티와의 관련성 근거 한 문장",
  "category": "{cat_enum}"
}}

[평가 기준]

▸ sentiment (HTWO·수소 사업 관점에서):
  - positive: 사업 성과·수출·투자·기술 진보·수상·우호적 정책
  - negative: 실적 부진·비판·논란·사고·규제·경쟁 열세
  - neutral: 단순 사실 전달·일정 안내·통계

▸ sentiment_score: 감성 강도 (0.0=약함 ~ 1.0=매우 강함)

▸ relevance_score: HTWO·수소 사업과의 관련성 강도
  - 0.9~1.0: HTWO 또는 수소연료전지·수소차가 기사 메인 주제
  - 0.6~0.8: 주요 비중으로 다루지만 다른 주제도 함께 등장
  - 0.3~0.5: 일부 단락에서 부수적으로 언급
  - 0.0~0.2: 거의 무관, 단발 언급 또는 전혀 등장 안 함

▸ category: 정확히 다음 4개 중 하나를 선택
  - "수소차/HTWO 직접": HTWO 사업·넥쏘·수소승용차 직접 보도
  - "수소 모빌리티": 수소버스·수소트럭·수소철도·수소선박·충전소 인프라
  - "모빌리티 일반": 그룹 종합·미래 모빌리티 비전·복합 주제
  - "기타": 그 외 (EV/전기차·자율주행·금융·정치·인사·기타 산업){kw_rule}
"""


def _parse_result(raw: str, keyword_categories: list = None) -> dict:
    valid_cats = BASE_CATEGORY_SET | set(keyword_categories or [])
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    # raw_decode로 첫 JSON 객체만 파싱 — "Extra data" 에러 방지
    try:
        data, _ = json.JSONDecoder().raw_decode(text)
    except json.JSONDecodeError:
        # 폴백: 첫 { 부터 마지막 } 까지 추출
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(text[start:end + 1])
        else:
            raise

    sentiment = data.get("sentiment", "neutral")
    if sentiment not in ("positive", "negative", "neutral"):
        sentiment = "neutral"

    category = data.get("category", "기타")
    if category not in valid_cats:
        category = "기타"

    return {
        "summary": str(data.get("summary", "")),
        "keywords": [str(k) for k in data.get("keywords", [])][:5],
        "sentiment": sentiment,
        "sentiment_score": float(data.get("sentiment_score", 0.5)),
        "sentiment_reason": str(data.get("sentiment_reason", "")),
        "relevance_score": float(data.get("relevance_score", 0.5)),
        "relevance_reason": str(data.get("relevance_reason", "")),
        "category": category,
    }


def _get_retry_delay(err_str: str, default: int = 65) -> int:
    """429 에러 메시지에서 retry_delay(초) 추출"""
    match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", err_str)
    return int(match.group(1)) + 5 if match else default


def analyze_article(article: dict, keyword_categories: list = None) -> dict | None:
    prompt = build_prompt(
        title=article["title"],
        description=article.get("description") or article["title"],
        keyword_categories=keyword_categories or [],
    )
    for attempt in range(3):
        try:
            response = _model.generate_content(prompt)
            return _parse_result(response.text, keyword_categories or [])
        except Exception as e:
            err_str = str(e)
            if "429" in err_str:
                wait = _get_retry_delay(err_str)
                log.warning(
                    f"[RATE LIMIT] {wait}초 대기 후 재시도 (시도 {attempt + 1}/3) "
                    f"— {article['title'][:40]}"
                )
                log.debug(f"전체 에러: {err_str}")
                time.sleep(wait)
            else:
                log.error(
                    f"[ERROR] 분석 실패 — {article['title'][:40]} | "
                    f"URL: {article.get('url', 'N/A')} | 에러: {e}"
                )
                return None
    log.error(f"[SKIP] 재시도 초과 — {article['title'][:40]}")
    return None


def analyze_articles(articles: list, keywords: list = None, max_workers: int = 5) -> list:
    """병렬 분석 — ThreadPoolExecutor, 429 발생 시 워커별 자동 재시도

    keywords: Gemini 카테고리 분류에 동적으로 추가할 키워드 목록 (예: default + extra)
    """
    keyword_categories = list(keywords or [])
    total = len(articles)
    if total == 0:
        return articles

    if keyword_categories:
        log.info(f"키워드 카테고리 활성: {keyword_categories}")

    success = 0
    fail = 0
    lock = threading.Lock()
    completed = [0]

    def _process(article: dict) -> tuple:
        result = analyze_article(article, keyword_categories)
        with lock:
            completed[0] += 1
            cur = completed[0]
        log.info(f"  [{cur}/{total}] 완료: {article['title'][:45]}")
        return article, result

    log.info(f"병렬 분석 시작 — {total}건, 동시 워커 {max_workers}개")
    start_ts = time.time()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_process, a) for a in articles]
        for future in as_completed(futures):
            try:
                article, result = future.result()
            except Exception as e:
                log.error(f"  [WORKER ERROR] {e}")
                fail += 1
                continue

            if result:
                article.update(result)
                article["analyzed"] = True
                success += 1
            else:
                fail += 1
                log.warning(
                    f"  [FAIL] 미분석 — {article['title'][:40]} | URL: {article.get('url', 'N/A')}"
                )

    elapsed = time.time() - start_ts
    log.info(
        f"분석 결과: 성공 {success}건, 실패 {fail}건 "
        f"(소요 {elapsed:.1f}초, 병렬 {max_workers} 워커, {total / max(elapsed, 1):.1f}건/초)"
    )
    return articles
