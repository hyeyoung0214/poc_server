import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

from logger import setup_logger

# 로깅 설정 (다른 모듈 import 전에 실행)
LOG_FILE = setup_logger()
log = logging.getLogger("main")

from fetch_news import fetch_articles, filter_articles, filter_by_days
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
    """기본 키워드 + EXTRA_KEYWORDS 환경 변수(쉼표 구분) 병합 — 중복 제거"""
    with open(KEYWORDS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    keywords = data.get("default", []) + data.get("custom", [])

    extra = os.environ.get("EXTRA_KEYWORDS", "").strip()
    if extra:
        extra_list = [k.strip() for k in extra.split(",") if k.strip()]
        log.info(f"사용자 추가 키워드: {extra_list}")
        keywords += extra_list

    # 중복 제거 (순서 유지)
    seen = set()
    deduped = []
    for k in keywords:
        if k not in seen:
            seen.add(k)
            deduped.append(k)
    return deduped


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

        # 환경변수 파싱
        display       = int(os.environ.get("DISPLAY_PER_KEYWORD", "30") or 30)
        days_back     = int(os.environ.get("DAYS_BACK", "0") or 0)
        max_workers   = int(os.environ.get("MAX_WORKERS", "5") or 5)
        whitelist_env = os.environ.get("WHITELIST", "").strip()
        blacklist_env = os.environ.get("BLACKLIST", "").strip()
        whitelist = [w.strip() for w in whitelist_env.split(",") if w.strip()] if whitelist_env else []
        blacklist = [b.strip() for b in blacklist_env.split(",") if b.strip()] if blacklist_env else []

        log.info(
            f"설정 — 키워드당 수집:{display} / 기간:{days_back}일(0=전체) / "
            f"병렬 워커:{max_workers}"
        )

        log.info("\n[1단계] 뉴스 수집")
        fetched = fetch_articles(keywords, display=display)

        # 기간 필터
        if days_back > 0:
            log.info(f"\n[1.3단계] 기간 필터 — 최근 {days_back}일")
            fetched = filter_by_days(fetched, days_back)

        # 화이트/블랙리스트 필터 (Gemini 호출 전 사전 필터)
        if whitelist or blacklist:
            log.info(f"\n[1.5단계] 사전 필터링 — 화이트: {whitelist} / 블랙: {blacklist}")
            fetched = filter_articles(fetched, whitelist, blacklist)

        new_articles = [a for a in fetched if a["url"] not in existing_urls]
        log.info(f"신규 기사: {len(new_articles)}개")

        if new_articles:
            log.info(f"\n[2단계] AI 분석 ({len(new_articles)}건, 병렬 {max_workers} 워커)")
            analyzed = analyze_articles(new_articles, max_workers=max_workers)
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
