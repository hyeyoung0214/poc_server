import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from logger import setup_logger

# 로깅 설정 (다른 모듈 import 전에 실행)
LOG_FILE = setup_logger()
log = logging.getLogger("main")

from fetch_news import fetch_articles
from analyze import analyze_articles

ROOT = Path(__file__).resolve().parent.parent
ARTICLES_PATH = ROOT / "docs" / "data" / "articles.json"
KEYWORDS_PATH = Path(__file__).resolve().parent / "keywords.json"
MAX_ARTICLES = 500


def load_existing() -> list:
    if ARTICLES_PATH.exists():
        with open(ARTICLES_PATH, encoding="utf-8") as f:
            return json.load(f).get("articles", [])
    return []


def load_keywords() -> list:
    with open(KEYWORDS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("default", []) + data.get("custom", [])


def save_articles(articles: list) -> None:
    ARTICLES_PATH.parent.mkdir(parents=True, exist_ok=True)
    articles_sorted = sorted(
        articles,
        key=lambda x: x.get("published_at", ""),
        reverse=True,
    )[:MAX_ARTICLES]

    output = {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(articles_sorted),
        "articles": articles_sorted,
    }
    with open(ARTICLES_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    log.info(f"[DONE] {len(articles_sorted)}개 기사 저장 → {ARTICLES_PATH}")


def main() -> int:
    log.info("=" * 50)
    log.info("현대차 수소/HTWO 뉴스 수집·분석 시작")
    log.info(f"로그 파일: {LOG_FILE}")
    log.info("=" * 50)

    try:
        existing = load_existing()
        existing_urls = {a["url"] for a in existing}
        log.info(f"기존 기사: {len(existing)}개")

        keywords = load_keywords()
        log.info(f"검색 키워드: {keywords}")

        log.info("\n[1단계] 뉴스 수집")
        fetched = fetch_articles(keywords)

        new_articles = [a for a in fetched if a["url"] not in existing_urls]
        log.info(f"신규 기사: {len(new_articles)}개")

        if new_articles:
            log.info(f"\n[2단계] AI 분석 ({len(new_articles)}건)")
            analyzed = analyze_articles(new_articles)
            all_articles = analyzed + existing
        else:
            log.info("신규 기사 없음 — 저장 건너뜀")
            all_articles = existing

        save_articles(all_articles)

        # 분석 통계 요약
        analyzed_count = sum(1 for a in all_articles if a.get("analyzed"))
        failed_count = sum(1 for a in all_articles if not a.get("analyzed"))
        log.info(f"분석 완료: {analyzed_count}건 / 분석 실패: {failed_count}건")
        return 0

    except Exception as e:
        log.exception(f"[FATAL] 파이프라인 중단: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
