import os
import json
import time
import google.generativeai as genai

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

_model = genai.GenerativeModel(
    "gemini-1.5-flash",
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
    # 마크다운 코드블록 제거 (안전 처리)
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


def analyze_article(article: dict) -> dict | None:
    prompt = PROMPT_TEMPLATE.format(
        title=article["title"],
        description=article.get("description") or article["title"],
    )
    try:
        response = _model.generate_content(prompt)
        return _parse_result(response.text)
    except Exception as e:
        print(f"  [ERROR] 분석 실패 ({article['title'][:30]}): {e}")
        return None


def analyze_articles(articles: list, delay: float = 4.5) -> list:
    """Gemini 무료 티어 15 RPM → 기사 간 4.5초 대기"""
    total = len(articles)
    for i, article in enumerate(articles):
        print(f"  [{i + 1}/{total}] 분석: {article['title'][:45]}...")
        result = analyze_article(article)
        if result:
            article.update(result)
            article["analyzed"] = True
        if i < total - 1:
            time.sleep(delay)
    return articles
