# 현대차 수소/HTWO 미디어 모니터링 — 아키텍처 문서

## 개요

현대자동차 수소차 및 HTWO 관련 뉴스를 자동 수집·분석하여 감성(긍/부/중립), 요약, 키워드를 대시보드로 제공하는 PoC 시스템.

---

## 기술 스택

| 역할 | 기술 | 비용 |
|------|------|------|
| 호스팅 | GitHub Pages (`docs/` 폴더) | 무료 |
| 실행 서버 | GitHub Actions (사용자 트리거 — workflow_dispatch) | 무료 (월 2,000분) |
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
│   ├── logger.py               # 파일+콘솔 로깅 셋업
│   ├── keywords.json           # 검색 키워드 설정
│   ├── requirements.txt        # Python 의존성
│   └── logs/                   # 실행 로그 (.gitignore — Actions 아티팩트로 업로드)
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
[사용자가 대시보드의 「📊 분석 시작」 버튼 클릭]
         │
         ├─ 추가 키워드 입력 (옵션)
         ├─ 기존 데이터 초기화 체크 (옵션)
         │
         ▼
[GitHub Actions workflow_dispatch UI — 새 탭으로 자동 이동]
         │
         ├─ extra_keywords 입력란에 사용자 키워드 붙여넣기
         └─ [Run workflow] 클릭
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
      "relevance_score": 0.95,
      "relevance_reason": "HTWO 사업이 기사 메인 주제",
      "category": "수소차/HTWO 직접",
      "analyzed": true
    }
  ]
}
```

### 필드 설명
| 필드 | 타입 | 설명 |
|------|------|------|
| `summary` | string | Gemini 요약 2-3문장 |
| `keywords` | array | 핵심 키워드 5개 |
| `sentiment` | enum | positive / negative / neutral |
| `sentiment_score` | float (0-1) | 감성 강도 |
| `sentiment_reason` | string | 감성 판단 근거 |
| `relevance_score` | float (0-1) | HTWO·수소 사업과의 관련성 강도 |
| `relevance_reason` | string | 관련성 판단 근거 |
| `category` | enum | 수소차/HTWO 직접 / 수소 모빌리티 / EV/전기차 / 자율주행 / 모빌리티 일반 / 기타 |

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

## Gemini 페르소나 & 분석 출력

### 페르소나
```
시니어 미디어 애널리스트 (10년+ 자동차·에너지 산업 분석 경력).
관심 영역: HTWO, 수소연료전지(FCEV), 수소 모빌리티, 충전 인프라.
객관적·정밀한 JSON 분석 결과 제공.
```

### 분석 출력 (JSON 단일 호출)
- 요약 (summary)
- 키워드 5개 (keywords)
- 감성 분류 + 점수 + 근거 (sentiment, sentiment_score, sentiment_reason)
- **관련성 점수 + 근거** (relevance_score, relevance_reason)
- **카테고리 분류** (category — 6종)

---

## 워크플로 입력 파라미터 (workflow_dispatch)

| 입력 | 환경변수 | 기본값 | 설명 |
|------|---------|--------|------|
| `extra_keywords` | `EXTRA_KEYWORDS` | (빈값) | 추가 검색 키워드 (쉼표) |
| `whitelist` | `WHITELIST` | (빈값) | 필수 포함 단어 (1개+ 매칭만 통과) |
| `blacklist` | `BLACKLIST` | (빈값) | 제외 단어 (1개+ 매칭이면 제외) |
| `display_per_keyword` | `DISPLAY_PER_KEYWORD` | 30 | 키워드당 Naver 수집 건수 (5~100) |
| `days_back` | `DAYS_BACK` | 0 | 최근 N일 기사만 (0=전체) |
| `max_workers` | `MAX_WORKERS` | 5 | Gemini 병렬 워커 수 (1~10) |
| `reset_data` | — | false | articles.json 초기화 |

---

## 병렬 분석 아키텍처

```
analyze_articles(articles, max_workers=5)
  └─ ThreadPoolExecutor (max_workers개 워커)
       ├─ Worker 1 ─→ analyze_article() ─→ Gemini API
       ├─ Worker 2 ─→ analyze_article() ─→ Gemini API
       ├─ Worker 3 ─→ analyze_article() ─→ Gemini API
       ├─ Worker 4 ─→ analyze_article() ─→ Gemini API
       └─ Worker 5 ─→ analyze_article() ─→ Gemini API
                                             │
                                  429 발생 시 워커 단위 자동 재시도
                                  (다른 워커는 영향 없이 진행)
```

**성능 비교 (73건 기준):**
| 모드 | 소요 시간 |
|------|-----------|
| Sequential (8초 대기) | ~10분 |
| Parallel 5 워커 | ~30~60초 |
| Parallel 10 워커 | ~20~40초 (RPM 한도 주의) |

---

## 화이트/블랙리스트 사전 필터

Gemini 호출 전 단계에서 제목·요약문 기준으로 필터링하여 비용 절감.

| 입력 | 동작 |
|------|------|
| `WHITELIST` 환경변수 (쉼표 구분) | 1개 이상 매칭된 기사만 통과 |
| `BLACKLIST` 환경변수 (쉼표 구분) | 하나라도 매칭되면 제외 |
| 둘 다 빈 값 | 모든 기사 통과 (필터 없음) |

워크플로 입력으로 전달 → `main.py`에서 환경변수 파싱 → `fetch_news.filter_articles()`.

프론트엔드에서 입력하면 자동으로 클립보드에 복사되어 GitHub Actions UI에 붙여넣기 가능.

---

## 로그 시스템

- **위치**: `scripts/logs/run_YYYYMMDD_HHMMSS.log` (실행마다 신규 파일)
- **수준**: 파일=DEBUG, 콘솔=INFO
- **포맷**: `시간 [수준] 모듈: 메시지`
- **저장 항목**: API 오류, 429 Rate Limit, JSON 파싱 실패, 분석 실패 기사 (URL 포함)
- **Actions**: `poc-logs-{run_id}` 아티팩트로 14일 보관

---

## 주요 제약사항

| 항목 | 제한 | 대응 |
|------|------|------|
| Gemini API Rate Limit | 모델별 RPM 제한 | 병렬 워커 (기본 5) + 429 자동 재시도 |
| Naver Search API | 일 25,000건 | 사용자 트리거, 키워드당 5~100건 (기본 30) |
| 분석 시간 (병렬화) | — | 5워커 기준 50~70건이 약 30~60초 |
| GitHub Pages | 정적 파일만 서빙 | JSON 파일로 데이터 전달 |
| articles.json | 최대 500건 유지 | 오래된 기사 자동 삭제 |

---

## 수정 가이드

| 수정 내용 | 파일 |
|-----------|------|
| 검색 키워드 추가/변경 (영구) | `scripts/keywords.json` |
| 검색 키워드 추가 (1회) | 대시보드 「📊 분석 시작」 → 추가 키워드 입력 |
| 실행 트리거 변경 | `.github/workflows/fetch_news.yml` → `on:` 섹션 |
| 분석 프롬프트 변경 | `scripts/analyze.py` → `PROMPT_TEMPLATE` |
| 수집 기사 수 조정 | `scripts/fetch_news.py` → `display` 파라미터 |
| 실행 주기 변경 | `.github/workflows/fetch_news.yml` → `cron` |
| UI 레이아웃 변경 | `docs/index.html`, `docs/style.css` |
| 차트/필터 로직 변경 | `docs/app.js` |
