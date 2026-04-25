import os
import re
import hashlib
import logging
import requests
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

log = logging.getLogger("fetch_news")

NAVER_CLIENT_ID = os.environ["NAVER_CLIENT_ID"]
NAVER_CLIENT_SECRET = os.environ["NAVER_CLIENT_SECRET"]

MEDIA_MAP = {
    "chosun.com": "조선일보",
    "joongang.co.kr": "중앙일보",
    "joins.com": "중앙일보",
    "donga.com": "동아일보",
    "hankookilbo.com": "한국일보",
    "hankyung.com": "한국경제",
    "mk.co.kr": "매일경제",
    "mt.co.kr": "머니투데이",
    "sedaily.com": "서울경제",
    "fnnews.com": "파이낸셜뉴스",
    "etnews.com": "전자신문",
    "zdnet.co.kr": "ZDNet Korea",
    "yonhapnews.co.kr": "연합뉴스",
    "yna.co.kr": "연합뉴스",
    "newsis.com": "뉴시스",
    "news1.kr": "뉴스1",
    "heraldcorp.com": "헤럴드경제",
    "businesspost.co.kr": "비즈니스포스트",
    "autodaily.co.kr": "오토데일리",
    "autotimes.co.kr": "오토타임즈",
    "motorgraph.com": "모터그래프",
    "greenpostkorea.co.kr": "그린포스트코리아",
    "etoday.co.kr": "이투데이",
    "inews24.com": "아이뉴스24",
    "koreaherald.com": "코리아헤럴드",
    "koreatimes.co.kr": "코리아타임즈",
    "jtbc.co.kr": "JTBC",
    "mbc.co.kr": "MBC",
    "kbs.co.kr": "KBS",
    "sbs.co.kr": "SBS",
}


def clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    replacements = {
        "&quot;": '"', "&lt;": "<", "&gt;": ">",
        "&amp;": "&", "&#39;": "'", "&nbsp;": " ",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.strip()


def get_source(url: str) -> str:
    try:
        domain = urlparse(url).netloc.replace("www.", "")
        for key, val in MEDIA_MAP.items():
            if key in domain:
                return val
        return domain
    except Exception:
        return "알 수 없음"


def parse_date(pub_date_str: str) -> str:
    try:
        dt = parsedate_to_datetime(pub_date_str)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")


def make_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


def filter_articles(
    articles: list,
    whitelist: list | None = None,
    blacklist: list | None = None,
) -> list:
    """
    제목+요약문 기준으로 화이트/블랙리스트 적용

    - whitelist: 1개 이상 포함되어야 통과 (없으면 모두 통과)
    - blacklist: 하나라도 매칭되면 제외 (없으면 모두 통과)
    """
    whitelist = [w.strip() for w in (whitelist or []) if w.strip()]
    blacklist = [b.strip() for b in (blacklist or []) if b.strip()]

    if not whitelist and not blacklist:
        return articles

    filtered = []
    excluded_white = 0
    excluded_black = 0

    for a in articles:
        text = f"{a['title']} {a.get('description', '')}".lower()

        if whitelist:
            if not any(w.lower() in text for w in whitelist):
                excluded_white += 1
                log.debug(f"  [WHITELIST 제외] {a['title'][:45]}")
                continue

        if blacklist:
            matched_black = next(
                (b for b in blacklist if b.lower() in text), None
            )
            if matched_black:
                excluded_black += 1
                log.debug(
                    f"  [BLACKLIST '{matched_black}' 매칭] {a['title'][:45]}"
                )
                continue

        filtered.append(a)

    log.info(
        f"  필터링 결과: 통과 {len(filtered)}건 / "
        f"화이트 미매칭 {excluded_white}건 / 블랙 매칭 {excluded_black}건"
    )
    return filtered


def fetch_articles(keywords: list) -> list:
    seen_urls: set = set()
    articles: list = []

    for keyword in keywords:
        try:
            resp = requests.get(
                "https://openapi.naver.com/v1/search/news.json",
                params={"query": keyword, "display": 30, "sort": "date"},
                headers={
                    "X-Naver-Client-Id": NAVER_CLIENT_ID,
                    "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
                },
                timeout=10,
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            log.info(f"  [{keyword}] {len(items)}건 수집")

            for item in items:
                url = item.get("originallink") or item.get("link", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                articles.append({
                    "id": make_id(url),
                    "title": clean_html(item.get("title", "")),
                    "url": url,
                    "source": get_source(url),
                    "published_at": parse_date(item.get("pubDate", "")),
                    "description": clean_html(item.get("description", "")),
                    "search_keyword": keyword,
                    "summary": None,
                    "keywords": [],
                    "sentiment": None,
                    "sentiment_score": None,
                    "sentiment_reason": None,
                    "analyzed": False,
                })

        except Exception as e:
            log.error(f"[ERROR] Naver API 오류 (키워드: {keyword}) — {e}", exc_info=True)

    return articles
