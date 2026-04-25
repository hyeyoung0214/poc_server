# 현대차 수소/HTWO 미디어 모니터링 PoC

현대자동차 수소차 및 HTWO 관련 뉴스를 자동 수집·분석하는 대시보드.

## 라이브 데모

https://hyeyoung0214.github.io/poc_server/

## 구조 문서

[ARCHITECTURE.md](ARCHITECTURE.md) — 전체 아키텍처, 스키마, 수정 가이드

## GitHub Secrets 등록 (필수)

`Settings → Secrets and variables → Actions`에서 아래 3개 등록:

| 이름 | 설명 |
|------|------|
| `NAVER_CLIENT_ID` | Naver Developers Client ID |
| `NAVER_CLIENT_SECRET` | Naver Developers Client Secret |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key |

## GitHub Pages 설정

`Settings → Pages → Source: Deploy from branch → Branch: main / docs`

## 키워드 추가

`scripts/keywords.json`의 `custom` 배열에 추가 후 커밋.
