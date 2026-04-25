/* =====================================================
   현대차 수소/HTWO 미디어 모니터 — 프론트엔드
   articles.json을 fetch해 통계·차트·카드를 렌더링
   ===================================================== */

const DATA_URL = './data/articles.json';

const SENTIMENT_LABEL = { positive: '긍정', negative: '부정', neutral: '중립' };
const SENTIMENT_EMOJI  = { positive: '😊', negative: '😟', neutral: '😐' };

const DEFAULT_KEYWORDS = ['현대 수소차', 'HTWO', '현대자동차 수소연료전지'];

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
let charts = {};

const CATEGORY_CSS_MAP = {
  '수소차/HTWO 직접': 'cat-h2',
  '수소 모빌리티':    'cat-mobility',
  'EV/전기차':        'cat-ev',
  '자율주행':         'cat-auto',
  '모빌리티 일반':    'cat-general',
  '기타':             'cat-etc',
};

const LS_RUN_PREFS = 'poc_run_prefs_v1';

/* ===================== BOOT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  renderKeywordTags();
  initRunPanel();
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
  let arr = [...allArticles];

  /* period */
  if (activePeriod > 0) {
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
  renderArticles(filtered);
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
<div class="article-card ${esc(sent)}">
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
  document.getElementById('filter-period').addEventListener('change', e => {
    activePeriod = parseInt(e.target.value);
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
  } catch {}

  /* 입력 변경 시 자동 저장 */
  const savePrefs = () => {
    const prefs = {
      extra: extraInput.value.trim(),
      whitelist: whiteInput.value.trim(),
      blacklist: blackInput.value.trim(),
    };
    localStorage.setItem(LS_RUN_PREFS, JSON.stringify(prefs));
  };
  [extraInput, whiteInput, blackInput].forEach(el => {
    el.addEventListener('input', savePrefs);
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
  goBtn.addEventListener('click', async () => {
    const extra     = extraInput.value.trim();
    const whitelist = whiteInput.value.trim();
    const blacklist = blackInput.value.trim();
    const reset     = resetBox.checked;

    savePrefs();

    /* GitHub Actions workflow_dispatch UI URL */
    const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;
    window.open(url, '_blank', 'noopener');

    /* 입력값을 한꺼번에 클립보드에 복사 (사용자가 분기별 input란에 붙여넣을 수 있게) */
    const clipText = [
      extra     && `[추가 키워드]   ${extra}`,
      whitelist && `[필수 포함]    ${whitelist}`,
      blacklist && `[제외 단어]    ${blacklist}`,
      reset     && `[초기화]      체크 활성화`,
    ].filter(Boolean).join('\n');

    if (clipText && navigator.clipboard) {
      navigator.clipboard.writeText(clipText).catch(() => {});
    }

    /* 사용자 안내 */
    const lines = [
      '✅ GitHub Actions 페이지가 열렸습니다.',
      '',
      '아래 순서로 진행하세요:',
      '1. 우측 상단 [Run workflow] 클릭',
      extra     ? `2. "추가 검색 키워드"란 → ${extra}` : '2. 추가 키워드 없음',
      whitelist ? `3. "필수 포함 단어"란 → ${whitelist}` : '3. whitelist 없음',
      blacklist ? `4. "제외 단어"란 → ${blacklist}`     : '4. blacklist 없음',
      reset     ? '5. "기존 데이터 초기화" 체크' : '5. 초기화 미사용',
      '6. 초록색 [Run workflow] 클릭',
      '',
      '※ 위 입력값은 자동으로 클립보드에 복사되었습니다.',
      '※ 분석은 약 5~15분 소요되며, 완료 후 페이지 새로고침 시 반영됩니다.',
    ];
    alert(lines.join('\n'));
  });

  /* ESC 키로 닫기 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
}
