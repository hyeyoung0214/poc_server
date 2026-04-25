# 현대차 수소/HTWO 미디어 모니터링 PoC

현대자동차 수소차 및 HTWO 관련 뉴스를 **사용자 요청 시** 수집·분석하는 대시보드.

## 라이브 데모

https://hyeyoung0214.github.io/poc_server/

## 사용법

1. 대시보드 우측 상단 **「📊 분석 시작」** 클릭
2. (옵션) 추가 검색 키워드 입력 — 쉼표 구분
3. (옵션) 기존 데이터 초기화 체크
4. **「🚀 GitHub Actions에서 실행」** 클릭 → 새 탭 열림
5. GitHub Actions 페이지에서 **[Run workflow]** 클릭
6. 약 5~15분 후 새로고침하면 결과 반영

## 구조 문서

[ARCHITECTURE.md](ARCHITECTURE.md) — 전체 아키텍처, 스키마, 수정 가이드

## GitHub Secrets (필수 — 1회 설정)

`Settings → Secrets and variables → Actions`:

| 이름 | 설명 |
|------|------|
| `NAVER_CLIENT_ID` | Naver Developers Client ID |
| `NAVER_CLIENT_SECRET` | Naver Developers Client Secret |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key |

## GitHub Pages 설정 (1회)

`Settings → Pages → Source: Deploy from branch → Branch: main / docs`

## 영구 키워드 변경

`scripts/keywords.json`의 `default` 배열 수정 후 커밋 (모든 실행에 적용됨).
