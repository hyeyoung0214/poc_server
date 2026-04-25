# 현대차 수소/HTWO 미디어 모니터링 — 아키텍처 문서

## 개요

현대자동차 수소차 및 HTWO 관련 뉴스를 자동 수집·분석하여 감성(긍/부/중립), 요약, 키워드를 대시보드로 제공하는 PoC 시스템.

---

## 기술 스택

| 역할 | 기술 | 비용 |
|------|------|------|
| 호스팅 | GitHub Pages (`docs/` 폴더) | 무료 |
| 자동화 서버 | GitHub Actions (6시간 cron) | 무료 (월 2,000분) |
| 뉴스 수집 | Naver Search API | 무료 (일 25,000건) |
| AI 분석 | Google Gemini 1.5 Flash | 무료 (일 1M 토큰, 15 RPM) |
| 데이터 저장 | JSON 파일 in GitHub repo | 무료 |
| 차트 | Chart.js (CDN) | 무료 |

---

## 디렉토리 구조

```
poc_server/
├── .github/
│   └── workflows/
│       └── fetch_news.yml      # GitHub Actions 스케줄 워크플로
├── scripts/
│   ├── main.py                 # 파이프라인 진입점
│   ├── fetch_news.py           # Naver API 뉴스 수집
│   ├── analyze.py              # Gemini AI 분석 (요약·감성·키워드)
│   ├── keywords.json           # 검색 키워드 설정
│   └── requirements.txt        # Python 의존성
├── docs/                       # GitHub Pages 루트
│   ├── index.html              # 메인 대시보드
│   ├── style.css               # 스타일
│   ├── app.js                  # 프론트엔드 로직 (Chart.js 포함)
│   └── data/
│       └── articles.json       # 분석 결과 (Actions이 자동 업데이트)
├── ARCHITECTURE.md             # 이 파일 — 수정 전 반드시 확인
└── README.md
```

---

## 데이터 흐름

```
[GitHub Actions Cron — 0, 6, 12, 18시 UTC]
         │
         ▼
[scripts/main.py]
    ├─ docs/data/articles.json 로드 (기존 기사)
    ├─ scripts/keywords.json 로드 (검색 키워드)
    │
    ▼
[scripts/fetch_news.py]
    └─ Naver Search API 호출 (키워드별)
       → 신규 기사 필터링 (URL 중복 제거)
    │
    ▼
[scripts/analyze.py]
    └─ Gemini 1.5 Flash API 호출 (기사별, 4.5초 간격)
       → 요약 / 키워드 5개 / 감성(positive|negative|neutral) / 감성점수
    │
    ▼
[docs/data/articles.json 업데이트]
    └─ git commit & push → GitHub Pages 자동 반영
    │
    ▼
[브라우저 — GitHub Pages]
    └─ app.js → articles.json fetch → 대시보드 렌더링
```

---

## articles.json 스키마

```json
{
  "last_updated": "2026-04-25 12:00:00",
  "total": 120,
  "articles": [
    {
      "id": "abc123def456",
      "title": "현대차 HTWO 유럽 진출 확대",
      "url": "https://...",
      "source": "한국경제",
      "published_at": "2026-04-25",
      "description": "원문 요약 (Naver API 제공)",
      "search_keyword": "HTWO",
      "summary": "Gemini가 생성한 2-3문장 요약",
      "keywords": ["HTWO", "수소", "유럽", "현대차", "연료전지"],
      "sentiment": "positive",
      "sentiment_score": 0.87,
      "sentiment_reason": "해외 시장 확대 성과를 긍정적으로 보도",
      "analyzed": true
    }
  ]
}
```

---

## keywords.json 스키마

```json
{
  "default": ["현대 수소차", "HTWO", "현대자동차 수소연료전지"],
  "custom":  []
}
```

- `default`: 기본 모니터링 키워드 (repo에서 직접 수정)
- `custom`: 추가 키워드 (필요 시 확장)

---

## GitHub Secrets (키 노출 금지)

| Secret 이름 | 설명 |
|-------------|------|
| `NAVER_CLIENT_ID` | Naver Developers Client ID |
| `NAVER_CLIENT_SECRET` | Naver Developers Client Secret |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key |

등록 경로: `GitHub Repo → Settings → Secrets and variables → Actions`

---

## GitHub Pages 설정

`Repo → Settings → Pages → Source: Deploy from branch → Branch: main / docs`

배포 URL: `https://hyeyoung0214.github.io/poc_server/`

---

## 주요 제약사항

| 항목 | 제한 | 대응 |
|------|------|------|
| Gemini 무료 티어 | 15 RPM | 기사당 4.5초 대기 |
| Naver Search API | 일 25,000건 | 6시간 주기, 키워드당 30건 |
| GitHub Pages | 정적 파일만 서빙 | JSON 파일로 데이터 전달 |
| articles.json | 최대 500건 유지 | 오래된 기사 자동 삭제 |

---

## 수정 가이드

| 수정 내용 | 파일 |
|-----------|------|
| 검색 키워드 추가/변경 | `scripts/keywords.json` |
| 분석 프롬프트 변경 | `scripts/analyze.py` → `PROMPT_TEMPLATE` |
| 수집 기사 수 조정 | `scripts/fetch_news.py` → `display` 파라미터 |
| 실행 주기 변경 | `.github/workflows/fetch_news.yml` → `cron` |
| UI 레이아웃 변경 | `docs/index.html`, `docs/style.css` |
| 차트/필터 로직 변경 | `docs/app.js` |
