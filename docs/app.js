/* =====================================================
   현대차 수소/HTWO 미디어 모니터 — 프론트엔드
   articles.json을 fetch해 통계·차트·카드를 렌더링
   ===================================================== */

const DATA_URL = './data/articles.json';

const SENTIMENT_LABEL = { positive: '긍정', negative: '부정', neutral: '중립' };
const SENTIMENT_EMOJI  = { positive: '😊', negative: '😟', neutral: '😐' };

const DEFAULT_KEYWORDS = ['넥쏘', '수소 연료전지', 'HTWO'];

const REPO_OWNER = 'hyeyoung0214';
const REPO_NAME  = 'poc_server';
const WORKFLOW_FILE = 'fetch_news.yml';

/* ----- state ----- */
let allArticles   = [];
let activeKeywords = [...DEFAULT_KEYWORDS];   // keyword filter (OR match)
let activeSentiment = 'all';
let activeCategory  = 'all';
let activePeriod    = 30;
let activeSort      = 'date';
let activeMinRelevance = 0.5;
let activeDateFrom = null;   // YYYY-MM-DD
let activeDateTo   = null;   // YYYY-MM-DD
let charts = {};

const CATEGORY_CSS_MAP = {
  '수소차/HTWO 직접': 'cat-h2',
  '수소 모빌리티':    'cat-mobility',
  'EV/전기차':        'cat-ev',
  '자율주행':         'cat-auto',
  '모빌리티 일반':    'cat-general',
  '기타':             'cat-etc',
};

const LS_RUN_PREFS    = 'poc_run_prefs_v1';
const LS_PAT          = 'poc_github_pat_v1';
const LS_EXCLUDED_IDS = 'poc_excluded_ids_v1';

const POLL_INTERVAL_MS = 8000;   // 8초마다 폴링
const MAX_POLL_MIN     = 15;     // 15분 타임아웃

/* ===================== LOGGER ===================== */
const _logBuffer = [];
const MAX_LOG_LINES = 300;
function log(level, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = args.map(a => {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  const line = `[${ts}] [${level}] ${msg}`;
  _logBuffer.push(line);
  if (_logBuffer.length > MAX_LOG_LINES) _logBuffer.shift();
  if (level === 'ERROR')      console.error(line);
  else if (level === 'WARN')  console.warn(line);
  else                         console.log(line);
}
/* 콘솔에서 pocLogs() / pocCopyLogs() 로 호출 가능 */
window.pocLogs = () => { const t = _logBuffer.join('\n'); console.log(t); return t; };
window.pocCopyLogs = async () => {
  const t = _logBuffer.join('\n');
  try { await navigator.clipboard.writeText(t); console.log('📋 logs copied to clipboard'); }
  catch (e) { console.log(t); }
};
window.pocClearLogs = () => { _logBuffer.length = 0; console.log('🗑️ logs cleared'); };

/* PAT/헤더용 sanitize — 공백·제어 문자·zero-width 등 제거 후 ASCII printable만 유지 */
function sanitizeAscii(s) {
  return String(s || '').replace(/[^\x21-\x7E]/g, '');
}
function isValidPat(s) {
  return /^[\x21-\x7E]+$/.test(s);   // ASCII printable only (33-126)
}

/* ===================== BOOT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  renderKeywordTags();
  initRunPanel();
  initPatModal();
  initProgressModal();
  initExcludeFeature();
  loadData();
});

/* ===================== DATA ===================== */
async function loadData() {
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const ts = data.last_updated;
    document.getElementById('last-updated').textContent =
      ts ? '마지막 업데이트: ' + ts : '데이터 없음';

    allArticles = (data.articles || []).filter(a => a.analyzed);
    applyFilters();
    buildCharts();
  } catch (e) {
    document.getElementById('articles-grid').innerHTML =
      `<div class="error-state">
        데이터를 불러오지 못했습니다.<br>
        GitHub Actions가 아직 실행되지 않았거나 네트워크 오류입니다.<br>
        <small>${e.message}</small>
       </div>`;
    document.getElementById('last-updated').textContent = '로드 실패';
  }
}

/* ===================== FILTER ===================== */
function getFiltered() {
  /* 사용자가 제외한 기사 — 모든 통계/차트/카드에서 빠짐 */
  const excluded = getExcludedIds();
  let arr = allArticles.filter(a => !excluded.has(a.id));

  /* period */
  if (activePeriod === 'custom') {
    if (activeDateFrom) arr = arr.filter(a => (a.published_at || '') >= activeDateFrom);
    if (activeDateTo)   arr = arr.filter(a => (a.published_at || '') <= activeDateTo);
  } else if (activePeriod > 0) {
    const cut = new Date();
    cut.setDate(cut.getDate() - activePeriod);
    arr = arr.filter(a => new Date(a.published_at) >= cut);
  }

  /* sentiment */
  if (activeSentiment !== 'all') {
    arr = arr.filter(a => a.sentiment === activeSentiment);
  }

  /* category */
  if (activeCategory !== 'all') {
    arr = arr.filter(a => (a.category || '기타') === activeCategory);
  }

  /* relevance (구버전 데이터에 relevance_score 없으면 통과시킴) */
  if (activeMinRelevance > 0) {
    arr = arr.filter(a => {
      if (a.relevance_score == null) return true;
      return a.relevance_score >= activeMinRelevance;
    });
  }

  /* keyword — 사용자가 추가한 키워드가 기사 제목/내용에 포함되는지 확인 */
  const customKws = activeKeywords.filter(k => !DEFAULT_KEYWORDS.includes(k));
  if (customKws.length > 0) {
    arr = arr.filter(a => {
      const text = (a.title + ' ' + (a.description || '') + ' ' +
                    (a.keywords || []).join(' ')).toLowerCase();
      return customKws.some(k => text.includes(k.toLowerCase()));
    });
  }

  /* sort */
  if (activeSort === 'date') {
    arr.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  } else if (activeSort === 'relevance_desc') {
    arr.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
  } else if (activeSort === 'score_desc') {
    arr.sort((a, b) => (b.sentiment_score || 0) - (a.sentiment_score || 0));
  } else if (activeSort === 'score_asc') {
    arr.sort((a, b) => (a.sentiment_score || 0) - (b.sentiment_score || 0));
  }

  return arr;
}

function applyFilters() {
  const filtered = getFiltered();
  renderStats(filtered);
  renderDefaultKeywordStats(filtered);
  renderArticles(filtered);
  renderExcludedInfo();
  if (Object.keys(charts).length) updateCharts(filtered);
}

/* ===================== STATS ===================== */
function renderStats(articles) {
  const total = articles.length;
  const pos   = articles.filter(a => a.sentiment === 'positive').length;
  const neg   = articles.filter(a => a.sentiment === 'negative').length;
  const neu   = articles.filter(a => a.sentiment === 'neutral').length;
  const pct   = n => total ? Math.round(n / total * 100) + '%' : '—';

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-positive').textContent = pos;
  document.getElementById('stat-negative').textContent = neg;
  document.getElementById('stat-neutral').textContent  = neu;
  document.getElementById('stat-positive-pct').textContent = pct(pos);
  document.getElementById('stat-negative-pct').textContent = pct(neg);
  document.getElementById('stat-neutral-pct').textContent  = pct(neu);
}

/* ===================== DEFAULT KEYWORD FREQUENCY ===================== */
function renderDefaultKeywordStats(articles) {
  const container = document.getElementById('keyword-freq-grid');
  if (!container) return;

  /* 공백 제거 + lowercase 후 매칭 — "수소 연료전지" ↔ "수소연료전지" 모두 매칭 */
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const total = articles.length;

  const cards = DEFAULT_KEYWORDS.map(kw => {
    const nkw = norm(kw);
    const cnt = articles.filter(a => {
      const text = norm(
        (a.title || '') + ' ' +
        (a.description || '') + ' ' +
        (a.summary || '') + ' ' +
        (a.keywords || []).join(' ')
      );
      return nkw && text.includes(nkw);
    }).length;
    const pct = total ? Math.round(cnt / total * 100) : 0;
    return { kw, cnt, pct };
  });

  container.innerHTML = cards.map(({kw, cnt, pct}) => `
    <div class="kw-stat-card">
      <div class="kw-stat-label">#${esc(kw)}</div>
      <div><span class="kw-stat-value">${cnt}</span><span class="kw-stat-suffix">건</span></div>
      <div class="kw-stat-pct">${total ? pct + '% (전체 ' + total + '건 중)' : '데이터 없음'}</div>
    </div>
  `).join('');
}

/* ===================== ARTICLES ===================== */
function renderArticles(articles) {
  const grid = document.getElementById('articles-grid');
  document.getElementById('articles-count').textContent =
    articles.length + '건';

  if (!articles.length) {
    grid.innerHTML = '<div class="empty-state">조건에 맞는 기사가 없습니다.</div>';
    return;
  }

  grid.innerHTML = articles.map(a => buildCard(a)).join('');
}

function buildCard(a) {
  const sent     = a.sentiment || 'neutral';
  const score    = typeof a.sentiment_score === 'number' ? a.sentiment_score : 0.5;
  const scorePct = Math.round(score * 100);

  const cat      = a.category || '기타';
  const catCss   = CATEGORY_CSS_MAP[cat] || 'cat-etc';

  const rel      = typeof a.relevance_score === 'number' ? a.relevance_score : null;
  const relPct   = rel != null ? Math.round(rel * 100) : null;
  const relLevel = rel == null ? '' : (rel >= 0.7 ? 'relevance-high' : rel >= 0.4 ? 'relevance-mid' : 'relevance-low');

  const kwTags = (a.keywords || []).slice(0, 4)
    .map(k => `<span class="card-kw-tag">#${esc(k)}</span>`).join('');

  const summary = a.summary
    ? `<p class="card-summary">${esc(a.summary)}</p>`
    : (a.description ? `<p class="card-summary">${esc(a.description)}</p>` : '');

  const relBlock = rel != null
    ? `<div class="relevance-row ${relLevel}" title="${esc(a.relevance_reason || '')}">
         <span>관련성</span>
         <div class="relevance-bar"><div class="relevance-bar-fill" style="width:${relPct}%"></div></div>
         <span>${relPct}%</span>
       </div>`
    : '';

  return `
<div class="article-card ${esc(sent)}" data-id="${esc(a.id)}">
  <button class="btn-exclude" data-id="${esc(a.id)}" type="button"
          title="이 기사를 분석에서 제외" aria-label="기사 제외">×</button>
  <div class="card-meta">
    <span class="card-source">${esc(a.source || '알 수 없음')}</span>
    <span class="card-date">${esc(a.published_at || '')}</span>
    <span class="card-category ${catCss}">${esc(cat)}</span>
    <span class="card-keyword">${esc(a.search_keyword || '')}</span>
  </div>
  <h4 class="card-title">
    <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
  </h4>
  ${summary}
  ${relBlock}
  <div class="card-footer">
    <div class="card-keywords-wrap">${kwTags}</div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
      <span class="badge ${esc(sent)}" title="${esc(a.sentiment_reason || '')}">
        ${SENTIMENT_EMOJI[sent]} ${SENTIMENT_LABEL[sent]}
      </span>
      <div class="score-bar-wrap">
        <div class="score-bar">
          <div class="score-bar-fill" style="width:${scorePct}%"></div>
        </div>
        <span>${scorePct}%</span>
      </div>
    </div>
  </div>
</div>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ===================== CHARTS ===================== */
function buildCharts() {
  const arr = getFiltered();

  /* sentiment donut */
  const pos = arr.filter(a => a.sentiment === 'positive').length;
  const neg = arr.filter(a => a.sentiment === 'negative').length;
  const neu = arr.filter(a => a.sentiment === 'neutral').length;

  charts.sentiment = new Chart(
    document.getElementById('chart-sentiment'),
    {
      type: 'doughnut',
      data: {
        labels: ['긍정', '부정', '중립'],
        datasets: [{
          data: [pos, neg, neu],
          backgroundColor: ['#43A047', '#E53935', '#78909C'],
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 12 } },
        },
        cutout: '62%',
      },
    }
  );

  /* timeline line chart */
  const timelineData = buildTimelineData(arr);
  charts.timeline = new Chart(
    document.getElementById('chart-timeline'),
    {
      type: 'bar',
      data: {
        labels: timelineData.labels,
        datasets: [
          {
            label: '긍정',
            data: timelineData.positive,
            backgroundColor: 'rgba(67,160,71,.7)',
            stack: 'stack',
          },
          {
            label: '부정',
            data: timelineData.negative,
            backgroundColor: 'rgba(229,57,53,.7)',
            stack: 'stack',
          },
          {
            label: '중립',
            data: timelineData.neutral,
            backgroundColor: 'rgba(120,144,156,.7)',
            stack: 'stack',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { font: { size: 11 } } },
          y: { stacked: true, ticks: { font: { size: 11 }, precision: 0 }, beginAtZero: true },
        },
      },
    }
  );

  /* keyword bar chart */
  const kwData = buildKeywordData(arr);
  charts.keywords = new Chart(
    document.getElementById('chart-keywords'),
    {
      type: 'bar',
      data: {
        labels: kwData.labels,
        datasets: [{
          label: '빈도',
          data: kwData.counts,
          backgroundColor: 'rgba(0,60,143,.65)',
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 11 }, precision: 0 }, beginAtZero: true },
          y: { ticks: { font: { size: 11 } } },
        },
      },
    }
  );
}

function updateCharts(arr) {
  /* sentiment donut */
  const pos = arr.filter(a => a.sentiment === 'positive').length;
  const neg = arr.filter(a => a.sentiment === 'negative').length;
  const neu = arr.filter(a => a.sentiment === 'neutral').length;
  charts.sentiment.data.datasets[0].data = [pos, neg, neu];
  charts.sentiment.update();

  /* timeline */
  const td = buildTimelineData(arr);
  charts.timeline.data.labels = td.labels;
  charts.timeline.data.datasets[0].data = td.positive;
  charts.timeline.data.datasets[1].data = td.negative;
  charts.timeline.data.datasets[2].data = td.neutral;
  charts.timeline.update();

  /* keywords */
  const kd = buildKeywordData(arr);
  charts.keywords.data.labels = kd.labels;
  charts.keywords.data.datasets[0].data = kd.counts;
  charts.keywords.update();
}

function buildTimelineData(arr) {
  const map = {};
  arr.forEach(a => {
    const d = a.published_at || '';
    if (!d) return;
    if (!map[d]) map[d] = { positive: 0, negative: 0, neutral: 0 };
    map[d][a.sentiment || 'neutral']++;
  });
  const dates = Object.keys(map).sort();
  return {
    labels:   dates,
    positive: dates.map(d => map[d].positive),
    negative: dates.map(d => map[d].negative),
    neutral:  dates.map(d => map[d].neutral),
  };
}

function buildKeywordData(arr) {
  const freq = {};
  arr.forEach(a => {
    (a.keywords || []).forEach(k => {
      if (k) freq[k] = (freq[k] || 0) + 1;
    });
  });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { labels: sorted.map(x => x[0]), counts: sorted.map(x => x[1]) };
}

/* ===================== FILTER INIT ===================== */
function initFilters() {
  /* period */
  const periodSel    = document.getElementById('filter-period');
  const customWrap   = document.getElementById('filter-custom-date');
  const dateFromInp  = document.getElementById('filter-date-from');
  const dateToInp    = document.getElementById('filter-date-to');

  periodSel.addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'custom') {
      activePeriod = 'custom';
      customWrap.hidden = false;
    } else {
      activePeriod = parseInt(v);
      customWrap.hidden = true;
    }
    applyFilters();
  });
  dateFromInp.addEventListener('change', e => {
    activeDateFrom = e.target.value || null;
    applyFilters();
  });
  dateToInp.addEventListener('change', e => {
    activeDateTo = e.target.value || null;
    applyFilters();
  });

  /* sort */
  document.getElementById('filter-sort').addEventListener('change', e => {
    activeSort = e.target.value;
    applyFilters();
  });

  /* relevance threshold */
  const relSel = document.getElementById('filter-relevance');
  if (relSel) {
    activeMinRelevance = parseFloat(relSel.value);
    relSel.addEventListener('change', e => {
      activeMinRelevance = parseFloat(e.target.value);
      applyFilters();
    });
  }

  /* sentiment buttons */
  document.getElementById('sentiment-btns').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#sentiment-btns .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSentiment = btn.dataset.v;
    applyFilters();
  });

  /* category buttons */
  const catBtns = document.getElementById('category-btns');
  if (catBtns) {
    catBtns.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      catBtns.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      applyFilters();
    });
  }

  /* keyword add */
  const input = document.getElementById('keyword-input');
  const addBtn = document.getElementById('keyword-add-btn');

  const addKeyword = () => {
    const kw = input.value.trim();
    if (!kw || activeKeywords.includes(kw)) { input.value = ''; return; }
    activeKeywords.push(kw);
    input.value = '';
    renderKeywordTags();
    applyFilters();
  };

  addBtn.addEventListener('click', addKeyword);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addKeyword(); });
}

function renderKeywordTags() {
  const container = document.getElementById('keyword-tags');
  container.innerHTML = activeKeywords.map(kw => {
    const isDefault = DEFAULT_KEYWORDS.includes(kw);
    return `<span class="keyword-tag ${isDefault ? '' : 'removable'}" data-kw="${esc(kw)}">
      ${esc(kw)}
      ${isDefault ? '' : `<span class="tag-x" data-kw="${esc(kw)}">×</span>`}
    </span>`;
  }).join('');

  container.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', () => {
      const kw = x.dataset.kw;
      activeKeywords = activeKeywords.filter(k => k !== kw);
      renderKeywordTags();
      applyFilters();
    });
  });
}

/* ===================== RUN PANEL ===================== */
function initRunPanel() {
  const panel        = document.getElementById('run-panel');
  const openBtn      = document.getElementById('btn-run-analysis');
  const closeBtn     = document.getElementById('run-close');
  const goBtn        = document.getElementById('btn-run-go');
  const extraInput   = document.getElementById('run-extra-kws');
  const whiteInput   = document.getElementById('run-whitelist');
  const blackInput   = document.getElementById('run-blacklist');
  const displayInput = document.getElementById('run-display');
  const daysSelect   = document.getElementById('run-days');
  const workersInput = document.getElementById('run-workers');
  const resetBox     = document.getElementById('run-reset');

  /* 기본 키워드 표시 */
  const defaultKwsBox = document.getElementById('run-default-kws');
  defaultKwsBox.innerHTML = DEFAULT_KEYWORDS
    .map(k => `<span class="keyword-tag">${esc(k)}</span>`)
    .join('');

  /* localStorage에서 이전 입력값 복원 */
  try {
    const saved = JSON.parse(localStorage.getItem(LS_RUN_PREFS) || '{}');
    if (saved.extra)     extraInput.value = saved.extra;
    if (saved.whitelist) whiteInput.value = saved.whitelist;
    if (saved.blacklist) blackInput.value = saved.blacklist;
    if (saved.display)   displayInput.value = saved.display;
    if (saved.days)      daysSelect.value = saved.days;
    if (saved.workers)   workersInput.value = saved.workers;
  } catch {}

  /* 입력 변경 시 자동 저장 */
  const savePrefs = () => {
    const prefs = {
      extra:     extraInput.value.trim(),
      whitelist: whiteInput.value.trim(),
      blacklist: blackInput.value.trim(),
      display:   displayInput.value,
      days:      daysSelect.value,
      workers:   workersInput.value,
    };
    localStorage.setItem(LS_RUN_PREFS, JSON.stringify(prefs));
  };
  [extraInput, whiteInput, blackInput, displayInput, daysSelect, workersInput].forEach(el => {
    el.addEventListener('input', savePrefs);
    el.addEventListener('change', savePrefs);
  });

  /* 패널 열기 */
  openBtn.addEventListener('click', () => {
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    extraInput.focus();
  });

  /* 패널 닫기 */
  closeBtn.addEventListener('click', () => {
    panel.hidden = true;
  });

  /* 분석 실행 — workflow_dispatch UI 열기 + 입력값 클립보드 자동 복사 */
  /* 현재 입력값 → workflow inputs 객체 변환 */
  const buildInputs = () => ({
    extra_keywords:      extraInput.value.trim(),
    whitelist:           whiteInput.value.trim(),
    blacklist:           blackInput.value.trim(),
    display_per_keyword: displayInput.value || '30',
    days_back:           daysSelect.value || '0',
    max_workers:         workersInput.value || '5',
    reset_data:          resetBox.checked,
  });

  /* === 자동 실행 === */
  const autoBtn = document.getElementById('btn-run-auto');
  autoBtn.addEventListener('click', async () => {
    savePrefs();
    const inputs = buildInputs();

    /* 저장된 PAT 검증 — 비ASCII가 섞였거나 sanitize 후 빈 값이면 모달 띄우기 */
    const rawPat = getPat();
    const pat = sanitizeAscii(rawPat);
    if (!pat || !isValidPat(pat)) {
      if (rawPat) {
        log('WARN', `[autoBtn] 저장된 PAT 손상 (raw ${rawPat.length}자 → sanitized ${pat.length}자) — 자동 삭제 후 재등록 요청`);
        setPatStored('');
      } else {
        log('INFO', '[autoBtn] PAT 미등록 — 모달 표시');
      }
      openPatModal(() => startAutoRun(inputs));
      return;
    }
    if (rawPat !== pat) {
      log('WARN', '[autoBtn] PAT 자동 정리됨 — 정리된 값으로 재저장');
      setPatStored(pat);
    }
    panel.hidden = true;
    await startAutoRun(inputs);
  });

  /* === 수동 실행 === */
  const manualBtn = document.getElementById('btn-run-manual');
  manualBtn.addEventListener('click', () => {
    savePrefs();
    const inputs = buildInputs();

    const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;
    window.open(url, '_blank', 'noopener');

    const clipText = [
      inputs.extra_keywords && `[추가 키워드] ${inputs.extra_keywords}`,
      inputs.whitelist      && `[필수 포함] ${inputs.whitelist}`,
      inputs.blacklist      && `[제외 단어] ${inputs.blacklist}`,
      `[수집 건수] ${inputs.display_per_keyword}`,
      `[기간(일)] ${inputs.days_back}`,
      `[병렬 워커] ${inputs.max_workers}`,
      inputs.reset_data && `[초기화] 체크`,
    ].filter(Boolean).join('\n');
    if (clipText && navigator.clipboard) navigator.clipboard.writeText(clipText).catch(() => {});

    showToast('📋 Actions 페이지를 열었습니다 — 입력값은 클립보드에 복사됨');
  });

  /* ESC 키로 닫기 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
}

/* ===================== PAT MANAGEMENT ===================== */
function getPat() {
  return localStorage.getItem(LS_PAT) || '';
}
function setPatStored(token) {
  if (token) localStorage.setItem(LS_PAT, token);
  else       localStorage.removeItem(LS_PAT);
}

let _patPendingCb = null;

function openPatModal(onSavedCb) {
  _patPendingCb = onSavedCb || null;
  const modal      = document.getElementById('pat-modal');
  const input      = document.getElementById('pat-input');
  const clearBtn   = document.getElementById('pat-clear');

  input.value = '';
  clearBtn.hidden = !getPat();
  modal.hidden = false;
  input.focus();
}

function closePatModal() {
  document.getElementById('pat-modal').hidden = true;
  _patPendingCb = null;
}

function initPatModal() {
  const modal    = document.getElementById('pat-modal');
  const input    = document.getElementById('pat-input');
  const closeBtn = document.getElementById('pat-modal-close');
  const skipBtn  = document.getElementById('pat-skip');
  const saveBtn  = document.getElementById('pat-save');
  const clearBtn = document.getElementById('pat-clear');

  closeBtn.addEventListener('click', closePatModal);
  skipBtn.addEventListener('click', () => {
    closePatModal();
    showToast('수동 실행은 [📋 수동 실행] 버튼을 사용하세요');
  });
  saveBtn.addEventListener('click', () => {
    const raw = input.value;
    const tok = sanitizeAscii(raw);
    if (!tok) {
      log('WARN', '[PAT] 입력값 비어있음');
      input.focus();
      return;
    }
    if (!isValidPat(tok)) {
      log('ERROR', '[PAT] 비ASCII 문자 포함 — sanitize 후에도 유효하지 않음');
      showToast('⚠️ 토큰에 사용할 수 없는 문자가 섞여 있습니다. 다시 복사해주세요.');
      return;
    }
    if (raw !== tok) {
      log('WARN', `[PAT] 입력값 자동 정리됨: 원본 ${raw.length}자 → ${tok.length}자 (공백·invisible 제거)`);
    }
    log('INFO', `[PAT] 저장 완료 (${tok.length}자, prefix=${tok.slice(0, 10)}…)`);
    setPatStored(tok);
    const cb = _patPendingCb;
    closePatModal();
    showToast('🔑 Token 저장 완료');
    if (cb) cb();
  });
  clearBtn.addEventListener('click', () => {
    setPatStored('');
    clearBtn.hidden = true;
    input.value = '';
    showToast('🗑️ Token 삭제됨');
  });

  /* 외부 클릭 시 닫기 */
  modal.addEventListener('click', e => {
    if (e.target === modal) closePatModal();
  });
}

/* ===================== TOAST ===================== */
let _toastTimer  = null;
let _toastUndoCb = null;

function showToast(msg, durMs = 3500, undoCb = null) {
  const t       = document.getElementById('toast');
  const undoBtn = document.getElementById('toast-undo');
  document.getElementById('toast-text').textContent = msg;

  _toastUndoCb = undoCb || null;
  if (undoBtn) undoBtn.hidden = !undoCb;

  t.hidden = false;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.hidden = true;
    if (undoBtn) undoBtn.hidden = true;
    _toastUndoCb = null;
  }, durMs);
}

/* ===================== EXCLUDE (분석 제외) ===================== */
function getExcludedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_EXCLUDED_IDS) || '[]'));
  } catch { return new Set(); }
}
function setExcludedIds(set) {
  localStorage.setItem(LS_EXCLUDED_IDS, JSON.stringify([...set]));
}
function addExcludedId(id) {
  const s = getExcludedIds();
  s.add(id);
  setExcludedIds(s);
}
function removeExcludedId(id) {
  const s = getExcludedIds();
  s.delete(id);
  setExcludedIds(s);
}
function clearExcludedIds() {
  localStorage.removeItem(LS_EXCLUDED_IDS);
}

function excludeArticle(id) {
  const article = allArticles.find(a => a.id === id);
  if (!article) return;
  addExcludedId(id);
  applyFilters();
  const titleShort = (article.title || '').slice(0, 28);
  showToast(`🗑️ 제외됨 — ${titleShort}${article.title.length > 28 ? '…' : ''}`, 5000, () => {
    removeExcludedId(id);
    applyFilters();
    showToast('↩️ 복원되었습니다');
  });
}

function renderExcludedInfo() {
  const wrap = document.getElementById('excluded-info');
  if (!wrap) return;
  const count = getExcludedIds().size;
  if (count > 0) {
    wrap.hidden = false;
    document.getElementById('excluded-count').textContent = `제외 ${count}건`;
  } else {
    wrap.hidden = true;
  }
}

function initExcludeFeature() {
  /* 카드 × 버튼 — 이벤트 위임 */
  const grid = document.getElementById('articles-grid');
  if (grid) {
    grid.addEventListener('click', e => {
      const btn = e.target.closest('.btn-exclude');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      excludeArticle(btn.dataset.id);
    });
  }

  /* 전체 복원 */
  const restoreBtn = document.getElementById('btn-restore-all');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      const count = getExcludedIds().size;
      if (count === 0) return;
      if (!confirm(`제외한 ${count}건을 모두 복원하시겠습니까?`)) return;
      clearExcludedIds();
      applyFilters();
      showToast('↩️ 모두 복원되었습니다');
    });
  }

  /* 토스트 되돌리기 버튼 */
  const undoBtn = document.getElementById('toast-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      const cb = _toastUndoCb;
      _toastUndoCb = null;
      document.getElementById('toast').hidden = true;
      undoBtn.hidden = true;
      if (_toastTimer) clearTimeout(_toastTimer);
      if (cb) cb();
    });
  }
}

/* ===================== GITHUB API CLIENT ===================== */
const GH_API = 'https://api.github.com';

async function ghFetch(path, options = {}) {
  const rawPat = getPat();
  if (!rawPat) {
    log('ERROR', '[ghFetch] PAT 미설정');
    throw new Error('GitHub Token이 설정되지 않았습니다.');
  }

  /* PAT sanitize — 줄바꿈/공백/zero-width/한글 IME 잔존문자 모두 제거 */
  const pat = sanitizeAscii(rawPat);
  if (pat !== rawPat) {
    log('WARN', `[ghFetch] PAT에 비ASCII/공백 ${rawPat.length - pat.length}자 발견 — 자동 정리 후 재저장`);
    setPatStored(pat);
  }
  if (!pat || !isValidPat(pat)) {
    log('ERROR', '[ghFetch] PAT이 유효한 ASCII 형식이 아님 — sanitize 후도 부적합');
    setPatStored('');
    throw new Error('Token에 비ASCII 문자가 섞여 있습니다. 모달의 「🗑️ 저장된 Token 삭제」 후 새로 복사해 등록해주세요.');
  }

  const url = `${GH_API}${path}`;
  const method = options.method || 'GET';
  log('INFO', `[ghFetch] ${method} ${path}`);

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    log('ERROR', `[ghFetch] fetch 실패 ${method} ${path}:`, err);
    throw new Error(`fetch 호출 실패: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    log('ERROR', `[ghFetch] 인증 실패 ${res.status} ${method} ${path}`);
    setPatStored('');
    throw new Error(`인증 실패 (HTTP ${res.status}) — Token 만료 또는 권한 부족. 새 토큰으로 다시 등록해주세요.`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    log('ERROR', `[ghFetch] HTTP ${res.status} ${method} ${path} — ${txt.slice(0, 300)}`);
    throw new Error(`GitHub API 오류 ${res.status}: ${txt.slice(0, 200)}`);
  }
  log('INFO', `[ghFetch] ${res.status} OK ${method} ${path}`);
  if (res.status === 204) return null;
  return res.json();
}

async function triggerWorkflow(inputs) {
  /* boolean → string for API */
  const apiInputs = {
    ...inputs,
    reset_data: inputs.reset_data ? 'true' : 'false',
  };
  await ghFetch(
    `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: apiInputs }),
    },
  );
}

async function findLatestRun(triggeredAfterISO) {
  const data = await ghFetch(
    `/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=10&event=workflow_dispatch`,
  );
  const runs = data.workflow_runs || [];
  /* triggeredAfterISO 이후 생성된 것 중 가장 최근 */
  const after = new Date(triggeredAfterISO);
  const candidates = runs.filter(r => new Date(r.created_at) >= after);
  return candidates.length ? candidates[0] : (runs[0] || null);
}

async function getRunDetail(runId) {
  return ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${runId}`);
}

async function getRunJobs(runId) {
  return ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${runId}/jobs`);
}

/* ===================== PROGRESS MODAL ===================== */
function setProgressStep(stepName, state) {
  /* state: 'pending' | 'active' | 'done' | 'failed' */
  const li = document.querySelector(`.step[data-step="${stepName}"]`);
  if (!li) return;
  li.classList.remove('pending', 'active', 'done', 'failed');
  li.classList.add(state);
}

function resetProgressSteps() {
  ['trigger','queued','setup','analyze','commit','reload'].forEach(s =>
    setProgressStep(s, 'pending')
  );
}

function setProgressStatus(text, type = 'running') {
  document.getElementById('progress-text').textContent = text;
  const wrap = document.querySelector('.progress-status');
  wrap.classList.remove('success', 'error');
  if (type === 'success') wrap.classList.add('success');
  if (type === 'error')   wrap.classList.add('error');

  const icon = document.getElementById('progress-icon');
  icon.classList.remove('spinner-sm');
  if (type === 'success') {
    icon.textContent = '✅';
    icon.style.fontSize = '20px';
  } else if (type === 'error') {
    icon.textContent = '❌';
    icon.style.fontSize = '20px';
  } else {
    icon.textContent = '';
    icon.style.fontSize = '';
    icon.classList.add('spinner-sm');
  }
}

function openProgressModal() {
  resetProgressSteps();
  setProgressStatus('워크플로 시작 중…', 'running');
  document.getElementById('progress-elapsed').textContent = '0초';
  document.getElementById('progress-actions-link').href =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions`;
  document.getElementById('progress-close').hidden = true;
  document.getElementById('progress-modal').hidden = false;
}

function closeProgressModal() {
  document.getElementById('progress-modal').hidden = true;
}

function fmtElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}분 ${s}초`;
}

/* 단계별 시작 퍼센트 — analyze는 시간 기반으로 25→85% 점근 */
const STAGE_BASE_PERCENT = {
  trigger: 5,
  queued:  12,
  setup:   22,
  analyze: 25,
  commit:  88,
  reload:  95,
};

function setProgressPercent(percent) {
  const fill = document.getElementById('progress-bar-fill');
  const pctEl = document.getElementById('progress-pct');
  if (!fill || !pctEl) return;
  const clamped = Math.max(0, Math.min(100, percent));
  fill.style.width = clamped + '%';
  pctEl.textContent = Math.round(clamped) + '%';
}

function calcStageProgress(stage, analyzeStartedAt) {
  if (stage === 'analyze' && analyzeStartedAt) {
    /* 25% → 85%로 점근 (1 - exp(-t/45)) — 30초:~58%, 60초:~74%, 90초:~82% */
    const sec = (Date.now() - analyzeStartedAt) / 1000;
    const ratio = 1 - Math.exp(-sec / 45);
    return 25 + 60 * ratio;
  }
  return STAGE_BASE_PERCENT[stage] || 0;
}

/* GitHub Actions step 이름 → UI 단계 매핑 */
function mapStepToUiStage(stepName) {
  const n = (stepName || '').toLowerCase();
  if (n.includes('checkout') || n.includes('python') || n.includes('install')) return 'setup';
  if (n.includes('reset')) return 'setup';
  if (n.includes('fetch') || n.includes('analyze')) return 'analyze';
  if (n.includes('upload')) return 'commit';
  if (n.includes('commit') || n.includes('push')) return 'commit';
  return null;
}

/* ===================== AUTO RUN ORCHESTRATOR ===================== */
async function startAutoRun(inputs) {
  log('INFO', '[startAutoRun] 시작', inputs);
  openProgressModal();
  const start = Date.now();
  let lastStage = 'trigger';
  let analyzeStartedAt = null;
  setProgressPercent(2);

  /* 경과시간 + 진행률 통합 타이머 (1초마다) */
  const timer = setInterval(() => {
    document.getElementById('progress-elapsed').textContent = fmtElapsed(Date.now() - start);
    setProgressPercent(calcStageProgress(lastStage, analyzeStartedAt));
  }, 1000);

  const finish = (status, msg) => {
    clearInterval(timer);
    setProgressStatus(msg, status);
    document.getElementById('progress-close').hidden = false;
    /* 성공 시 5초 후 위젯 자동 닫힘 — 백그라운드 진행 자연스럽게 마무리 */
    if (status === 'success') {
      setProgressPercent(100);
      setTimeout(closeProgressModal, 5000);
    }
  };

  try {
    /* 1. 트리거 */
    const triggeredAt = new Date().toISOString();
    setProgressStep('trigger', 'active');
    await triggerWorkflow(inputs);
    setProgressStep('trigger', 'done');

    /* 2. 큐 등록된 run 찾기 (최대 30초 대기) */
    setProgressStep('queued', 'active');
    setProgressStatus('실행 큐 등록 대기 중…');
    let run = null;
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      run = await findLatestRun(triggeredAt);
      if (run) break;
    }
    if (!run) throw new Error('새 워크플로 실행을 찾을 수 없습니다.');
    document.getElementById('progress-actions-link').href = run.html_url;

    /* 3. 폴링 */
    const deadline = Date.now() + MAX_POLL_MIN * 60_000;

    while (Date.now() < deadline) {
      run = await getRunDetail(run.id);

      if (run.status === 'queued') {
        setProgressStep('queued', 'active');
        setProgressStatus(`큐 대기 중 (${fmtElapsed(Date.now() - start)})…`);
        lastStage = 'queued';
      } else if (run.status === 'in_progress') {
        if (lastStage === 'queued') setProgressStep('queued', 'done');

        /* 현재 실행 중인 step 확인 */
        let currentStepName = '';
        try {
          const jobs = await getRunJobs(run.id);
          const job = jobs.jobs && jobs.jobs[0];
          if (job) {
            const inProg = (job.steps || []).find(s => s.status === 'in_progress');
            currentStepName = inProg ? inProg.name : '';
          }
        } catch {}

        const stage = mapStepToUiStage(currentStepName) || 'analyze';

        /* 이전 stage들을 done 처리 */
        const order = ['queued','setup','analyze','commit'];
        const idx = order.indexOf(stage);
        for (let i = 0; i < idx; i++) setProgressStep(order[i], 'done');
        setProgressStep(stage, 'active');
        if (stage === 'analyze' && !analyzeStartedAt) analyzeStartedAt = Date.now();
        lastStage = stage;
        setProgressPercent(calcStageProgress(stage, analyzeStartedAt));

        const stageLabel = {
          setup:   '환경 설정',
          analyze: '뉴스 수집 + AI 분석 (이 단계가 가장 오래 걸립니다)',
          commit:  '결과 저장 중',
        }[stage] || '진행 중';
        setProgressStatus(stageLabel);

      } else if (run.status === 'completed') {
        ['queued','setup','analyze','commit'].forEach(s => setProgressStep(s, 'done'));
        setProgressPercent(95);

        if (run.conclusion === 'success') {
          /* 4. 데이터 새로고침 */
          lastStage = 'reload';
          setProgressStep('reload', 'active');
          setProgressStatus('데이터 새로고침 중…');
          /* GitHub Pages 캐시 갱신 대기 */
          await sleep(8000);
          await loadData();
          setProgressStep('reload', 'done');
          setProgressPercent(100);
          finish('success', `✅ 완료! (${fmtElapsed(Date.now() - start)})`);
          showToast('🎉 분석 완료 — 새 데이터가 반영되었습니다');
          return;
        } else {
          ['queued','setup','analyze','commit'].forEach(s => setProgressStep(s, 'pending'));
          setProgressStep('analyze', 'failed');
          finish('error', `실패: ${run.conclusion} — Actions 로그를 확인하세요`);
          return;
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    finish('error', '⏰ 타임아웃 — Actions에서 직접 확인해주세요');

  } catch (err) {
    log('ERROR', '[startAutoRun] 실패:', err);
    finish('error', `❌ ${err.message}`);
  }
}

function initProgressModal() {
  document.getElementById('progress-close').addEventListener('click', closeProgressModal);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
