import os
import re
import json
import time
import logging
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

PROMPT_TEMPLATE = """\
다음 뉴스 기사를 분석해주세요.

제목: {title}
내용: {description}

아래 JSON 형식으로만 응답하세요:
{{
  "summary": "기사 핵심 내용을 2-3문장으로 요약",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3", "핵심키워드4", "핵심키워드5"],
  "sentiment": "positive 또는 negative 또는 neutral",
  "sentiment_score": 0.0에서 1.0 사이 숫자,
  "sentiment_reason": "긍정/부정/중립으로 판단한 근거 한 문장"
}}

감성 판단 기준:
- positive: 현대차·수소차·HTWO에 우호적, 성과·성장·투자·수상 관련
- negative: 문제점·비판·사고·논란·규제·실적 악화 관련
- neutral: 단순 사실 전달, 통계, 일정 안내"""


def _parse_result(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    data = json.loads(text)
    sentiment = data.get("sentiment", "neutral")
    if sentiment not in ("positive", "negative", "neutral"):
        sentiment = "neutral"
    return {
        "summary": str(data.get("summary", "")),
        "keywords": [str(k) for k in data.get("keywords", [])][:5],
        "sentiment": sentiment,
        "sentiment_score": float(data.get("sentiment_score", 0.5)),
        "sentiment_reason": str(data.get("sentiment_reason", "")),
    }


def _get_retry_delay(err_str: str, default: int = 65) -> int:
    """429 에러 메시지에서 retry_delay(초) 추출"""
    match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", err_str)
    return int(match.group(1)) + 5 if match else default


def analyze_article(article: dict) -> dict | None:
    prompt = PROMPT_TEMPLATE.format(
        title=article["title"],
        description=article.get("description") or article["title"],
    )
    for attempt in range(3):
        try:
            response = _model.generate_content(prompt)
            return _parse_result(response.text)
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


def analyze_articles(articles: list, delay: float = 8.0) -> list:
    """요청 간 8초 대기 + 429 시 자동 재시도"""
    total = len(articles)
    success_count = 0
    fail_count = 0

    for i, article in enumerate(articles):
        log.info(f"  [{i + 1}/{total}] 분석: {article['title'][:45]}...")
        result = analyze_article(article)
        if result:
            article.update(result)
            article["analyzed"] = True
            success_count += 1
        else:
            fail_count += 1
            log.warning(
                f"  [FAIL] 미분석 처리 — {article['title'][:40]} | URL: {article.get('url', 'N/A')}"
            )
        if i < total - 1:
            time.sleep(delay)

    log.info(f"분석 결과: 성공 {success_count}건, 실패 {fail_count}건")
    return articles
