// Main application - init, tab routing, refresh loop, dashboard rendering
import { loadTeams, getTeamById, teamLogoUrl } from './teams.js';
import { loadEntry, getEntry, getPickedTeamIds, hasAnyPicks, onChange, renderEntryCard, savePlayerCache, isViewOnly, getOpponents, switchToMyEntry, switchToOpponent, getActiveView, getActiveViewName } from './entry.js';
import { refreshScores, isAnyGameLive, getLastFetchTime, getGamesForTeam, getTeamResult, fetchPlayerScoring, fetchNews } from './espn.js';
import { calculateScoring } from './scoring.js';
import { renderBracket } from './bracket.js';

let refreshTimer = null;
let activeTab = 'dashboard';

const STATUS_LABELS = {
  alive: 'Alive',
  eliminated: 'Eliminated',
  playing: 'Playing',
  pending: 'Pending',
  correct: 'Correct',
  incorrect: 'Incorrect',
  champion: 'Champion',
  not_in_game: 'Pending',
  empty: 'Not Set',
};

function displayStatus(status) {
  return STATUS_LABELS[status] || status;
}

// ---- Init ----
async function init() {
  await loadTeams();
  loadEntry();

  setupTabs();
  setupRefreshButton();
  setupEntrySwitcher();

  // Render entry card
  renderEntryCard();
  renderEntrySwitcher();

  // Wire entry changes to re-render
  onChange(async () => {
    if (hasAnyPicks()) {
      await refreshScores();
      renderDashboard();
      if (activeTab === 'bracket') renderBracket(getActiveRegion());
      startRefreshLoop();
      updateLastRefresh();
    } else {
      renderDashboard();
    }
    // Entry card manages its own rendering — don't rebuild it here
    // (rebuilding destroys focused inputs mid-keystroke)
  });

  // Only fetch data and start refresh loop if picks exist
  if (hasAnyPicks()) {
    await refreshScores();
    renderDashboard();
    renderBracket();
    startRefreshLoop();
    updateLastRefresh();
  } else {
    renderDashboard();
    renderBracket();
  }
}

// ---- Tab Navigation ----
function setupTabs() {
  const nav = document.getElementById('tab-nav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;

    const tab = btn.dataset.tab;
    activeTab = tab;

    // Update active states
    nav.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.getElementById(tab).classList.add('active');

    // Lazy-load tab content
    if (tab === 'bracket') renderBracket(getActiveRegion());
    if (tab === 'entry') renderEntryCard();
    if (tab === 'highscorer') renderHighScorer();
    if (tab === 'leaderboard') renderLeaderboard();
  });

  // Bracket region buttons
  document.querySelector('.bracket-controls')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.region-btn');
    if (!btn) return;
    document.querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderBracket(btn.dataset.region);
  });
}

function getActiveRegion() {
  return document.querySelector('.region-btn.active')?.dataset.region || 'all';
}

function setupRefreshButton() {
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    await refreshScores();
    renderDashboard();
    if (activeTab === 'bracket') renderBracket(getActiveRegion());
    updateLastRefresh();
  });
}

// ---- Refresh Loop ----
function startRefreshLoop() {
  clearInterval(refreshTimer);
  const interval = isAnyGameLive() ? 30000 : 60000;
  refreshTimer = setInterval(async () => {
    await refreshScores();
    renderDashboard();
    if (activeTab === 'bracket') renderBracket(getActiveRegion());
    updateLastRefresh();
  }, interval);
}

function updateLastRefresh() {
  const el = document.getElementById('last-refresh');
  const time = getLastFetchTime();
  if (time) {
    el.textContent = new Date(time).toLocaleTimeString();
  }

  // Update live indicator
  const indicator = document.getElementById('live-indicator');
  indicator.hidden = !isAnyGameLive();

  // Adjust refresh rate based on live games
  startRefreshLoop();
}

// ---- Dashboard Rendering ----
function renderDashboard() {
  if (!hasAnyPicks()) {
    renderEmptyState();
    return;
  }

  const scoring = calculateScoring();
  if (!scoring) return;

  // Update header scores
  const viewName = getActiveViewName();
  const totalLabel = document.querySelector('.total-points .label');
  if (totalLabel) totalLabel.textContent = viewName === 'My Entry' ? 'Total Points' : viewName;
  document.getElementById('total-points').textContent = scoring.partITotal;
  document.getElementById('max-points').textContent = scoring.maxPossible;

  // Team cards
  renderTeamCards(scoring.teamResults);

  // Bonus card
  renderBonusCard(scoring.championResult, scoring.highScorerResult);

  // Final Four card
  renderFinalFourCard(scoring.finalFourResult);

  // Upcoming games
  renderUpcomingGames(scoring.teamResults);

  // Headlines (async, non-blocking)
  renderHeadlines();
}

function renderEmptyState() {
  document.getElementById('total-points').textContent = '-';
  document.getElementById('max-points').textContent = '-';

  document.getElementById('team-cards').innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <div class="empty-state-icon">🏀</div>
      <h2>Welcome to the Pool Tracker</h2>
      <p>Get started by entering your picks on the Entry Card.</p>
      <button class="btn" id="go-to-entry">Set Up Your Entry Card</button>
    </div>
  `;

  document.querySelector('#bonus-card .bonus-items').innerHTML = '';
  document.querySelector('#ff-card .ff-items').innerHTML = '';
  document.querySelector('#upcoming-card .upcoming-list').innerHTML = '';

  document.getElementById('go-to-entry')?.addEventListener('click', () => {
    document.querySelector('.tab[data-tab="entry"]').click();
  });

  renderHeadlines();
}

const ROUND_LABELS = ['R64', 'R32', 'S16', 'E8', 'FF', 'Final'];

function renderTeamCards(teamResults) {
  const container = document.getElementById('team-cards');

  // Sort: playing first, then alive, then eliminated; within each group sort by points desc
  const sorted = [...teamResults].sort((a, b) => {
    const statusOrder = { playing: 0, alive: 1, champion: 1, eliminated: 2 };
    const sa = statusOrder[a.status] ?? 1;
    const sb = statusOrder[b.status] ?? 1;
    if (sa !== sb) return sa - sb;
    return b.points - a.points;
  });

  container.innerHTML = sorted.map(tr => {
    const t = tr.team;
    const statusClass = `status-${tr.status}`;
    const cardClass = `team-card ${tr.status === 'eliminated' ? 'eliminated' : ''} ${tr.status === 'playing' ? 'playing' : ''}`;

    // Round progress dots
    const roundDots = ROUND_LABELS.map(r => {
      const state = tr.roundResults[r];
      const cls = state ? `round-dot ${state}` : 'round-dot';
      return `<div class="${cls}">${r}</div>`;
    }).join('');

    // Live score line
    let liveHtml = '';
    if (tr.liveGame) {
      const lg = tr.liveGame;
      liveHtml = `<div class="live-score">
        <strong>${lg.teamScore} - ${lg.opponentScore}</strong> vs ${lg.opponentName}
        &middot; ${lg.clock} ${lg.period ? `P${lg.period}` : ''} ${lg.broadcast ? `&middot; ${lg.broadcast}` : ''}
      </div>`;
    }

    return `<div class="${cardClass}">
      <div class="team-card-header">
        <img src="${teamLogoUrl(t.id)}" class="team-logo" alt="${t.name}" onerror="this.style.display='none'">
        <div class="team-info">
          <div class="team-name">${t.name}</div>
          <div class="team-seed">(${t.seed}) ${t.region} &middot; ${tr.ptsPerWin} pts/win</div>
        </div>
        <span class="status-badge ${statusClass}">${displayStatus(tr.status)}</span>
      </div>
      <div class="team-stats">
        <div><span class="stat-label">Wins</span> <span class="stat-value">${tr.wins}</span></div>
        <div><span class="stat-label">Points</span> <span class="stat-value">${tr.points}</span></div>
        <div><span class="stat-label">Max</span> <span class="stat-value">${tr.maxPoints}</span></div>
      </div>
      <div class="round-progress">${roundDots}</div>
      ${liveHtml}
    </div>`;
  }).join('');
}

function renderBonusCard(championResult, highScorerResult) {
  const container = document.querySelector('#bonus-card .bonus-items');
  const champTeam = championResult.pick;

  const champStatusColor = {
    correct: 'var(--accent-green)',
    alive: 'var(--accent-blue)',
    playing: 'var(--accent-amber)',
    eliminated: 'var(--accent-red)',
    incorrect: 'var(--accent-red)',
    pending: 'var(--text-secondary)',
    not_in_game: 'var(--text-secondary)',
  };

  container.innerHTML = `
    <div class="bonus-item">
      <div>
        <div class="bonus-pick">Champion: ${champTeam?.name || 'None'}</div>
        <div class="muted" style="font-size:0.75rem">+10 points if correct</div>
      </div>
      <span class="status-badge" style="background: ${champStatusColor[championResult.status]}22; color: ${champStatusColor[championResult.status]}">
        ${displayStatus(championResult.status)}
      </span>
    </div>
    <div class="bonus-item">
      <div>
        <div class="bonus-pick">High Scorer: ${highScorerResult.pick || 'None'}</div>
        <div class="muted" style="font-size:0.75rem">+10 points if correct (${getTeamById(highScorerResult.teamId)?.name || ''})</div>
      </div>
      <span class="status-badge" style="background: var(--text-secondary)22; color: var(--text-secondary)">
        ${displayStatus(highScorerResult.status)}
      </span>
    </div>
  `;
}

function renderFinalFourCard(ffResult) {
  const container = document.querySelector('#ff-card .ff-items');
  const regions = ['East', 'West', 'South', 'Midwest'];

  const statusColors = {
    correct: 'var(--accent-green)',
    alive: 'var(--accent-blue)',
    eliminated: 'var(--accent-red)',
    incorrect: 'var(--accent-red)',
    playing: 'var(--accent-amber)',
    empty: 'var(--text-secondary)',
  };

  let html = regions.map(r => {
    const res = ffResult.results[r];
    const color = statusColors[res.status] || 'var(--text-secondary)';
    return `<div class="ff-item">
      <div>
        <div class="bonus-pick">${r}: ${res.pick?.name || 'None'}</div>
      </div>
      <span class="status-badge" style="background: ${color}22; color: ${color}">
        ${displayStatus(res.status)}
      </span>
    </div>`;
  }).join('');

  if (ffResult.sweepWin) {
    html += `<div style="text-align:center; padding:12px; color:var(--accent-purple); font-weight:800; font-size:1.2rem;">
      ALL 4 CORRECT - WIN ENTIRE POT!
    </div>`;
  } else if (ffResult.possible) {
    html += `<div style="text-align:center; padding:8px; color:var(--accent-blue); font-size:0.8rem;">
      Pot sweep still possible!
    </div>`;
  } else {
    html += `<div style="text-align:center; padding:8px; color:var(--text-secondary); font-size:0.8rem;">
      Pot sweep no longer possible
    </div>`;
  }

  container.innerHTML = html;
}

function renderUpcomingGames(teamResults) {
  const container = document.querySelector('#upcoming-card .upcoming-list');
  const heading = document.querySelector('#upcoming-card h3');
  if (heading) heading.textContent = getActiveViewName() === 'My Entry' ? 'Your Upcoming Games' : getActiveViewName().replace(/'s Entry$/, "'s Upcoming Games");
  const upcoming = [];

  for (const tr of teamResults) {
    if (tr.status === 'eliminated') continue;
    const games = getGamesForTeam(tr.team.id);
    for (const game of games) {
      const result = getTeamResult(game, tr.team.id);
      if (!result) continue;
      if (result.scheduled || result.live) {
        upcoming.push({ ...result, team: tr.team });
      }
    }
  }

  // Sort by start time
  upcoming.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  if (upcoming.length === 0) {
    container.innerHTML = '<p class="muted">No upcoming games for your teams</p>';
    return;
  }

  container.innerHTML = upcoming.map(g => {
    const time = new Date(g.startTime);
    const timeStr = g.live
      ? `<span style="color:var(--accent-amber)">LIVE ${g.clock} P${g.period}</span>`
      : time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' +
        time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return `<div class="upcoming-game">
      <div>
        <strong>${g.team.name}</strong> vs ${g.opponentName}
        <div class="upcoming-time">${timeStr}</div>
      </div>
      ${g.broadcast ? `<span class="upcoming-tv">${g.broadcast}</span>` : ''}
    </div>`;
  }).join('');
}

// ---- High Scorer Tab ----
async function renderHighScorer() {
  const container = document.getElementById('player-leaderboard');
  container.innerHTML = '<p class="muted">Loading player stats...</p>';

  const entry = getEntry();
  const players = await fetchPlayerScoring();

  if (!players || players.length === 0) {
    container.innerHTML = '<p class="muted">No player scoring data available yet. Stats will appear as games complete.</p>';
    return;
  }

  // Cache player names for high scorer autocomplete on entry card
  savePlayerCache(players);

  const highScorerName = entry?.highScorer?.toLowerCase() || '';

  let html = `<table class="player-table">
    <thead><tr>
      <th>#</th><th>Player</th><th>Team</th><th>GP</th><th>PTS</th><th>PPG</th>
    </tr></thead><tbody>`;

  players.slice(0, 50).forEach((p, i) => {
    const isHighlight = p.name.toLowerCase().includes(highScorerName) ||
      (entry?.highScorerTeamId && p.teamId === entry.highScorerTeamId && p.name.toLowerCase().includes(highScorerName.split(' ').pop()));
    const cls = isHighlight ? 'highlight' : '';
    const ppg = p.games > 0 ? (p.totalPoints / p.games).toFixed(1) : '0.0';

    html += `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${p.name} ${isHighlight ? '⭐' : ''}</td>
      <td>${p.teamName}</td>
      <td>${p.games}</td>
      <td><strong>${p.totalPoints}</strong></td>
      <td>${ppg}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ---- Dashboard Headlines ----
async function renderHeadlines() {
  const container = document.querySelector('#headlines-card .headlines-list');
  if (!container) return;

  const entry = getEntry();
  const newsData = await fetchNews();

  if (!newsData?.articles?.length) {
    container.innerHTML = '<p class="muted">No headlines available</p>';
    return;
  }

  // Build set of picked team names for matching
  const pickedTeams = [];
  if (entry) {
    for (const pick of entry.teams) {
      const team = getTeamById(pick.teamId);
      if (team) pickedTeams.push(team);
    }
  }

  // Filter to articles that mention a picked team
  const relevant = newsData.articles.filter(article => {
    if (pickedTeams.length === 0) return false;
    const text = (article.headline + ' ' + (article.description || '')).toLowerCase();
    return pickedTeams.some(t => text.includes(t.name.toLowerCase()));
  });

  // Use relevant articles, or fall back to general headlines if none match
  const articles = relevant.length > 0 ? relevant.slice(0, 8) : newsData.articles.slice(0, 5);
  const isFiltered = relevant.length > 0;

  if (articles.length === 0) {
    container.innerHTML = '<p class="muted">No headlines available</p>';
    return;
  }

  // Update card heading based on active view
  const heading = document.querySelector('#headlines-card h3');
  if (heading) heading.textContent = getActiveViewName() === 'My Entry' ? 'Your Headlines' : getActiveViewName().replace(/'s Entry$/, "'s Headlines");

  container.innerHTML = articles.map(article => {
    const matchedTeams = [];
    const text = (article.headline + ' ' + (article.description || '')).toLowerCase();
    for (const t of pickedTeams) {
      if (text.includes(t.name.toLowerCase())) matchedTeams.push(t.name);
    }
    const teamTags = matchedTeams.length > 0
      ? ' ' + matchedTeams.map(n => `<span class="news-team-tag">${n}</span>`).join(' ')
      : '';

    return `<div class="headline-item">
      <a href="${article.links?.web?.href || '#'}" target="_blank">${article.headline}</a>${teamTags}
    </div>`;
  }).join('');

  if (!isFiltered && pickedTeams.length > 0) {
    container.innerHTML += '<p class="muted" style="margin-top:6px;font-size:0.75rem">No news specific to your teams — showing general headlines</p>';
  }
}

// ---- Entry Switcher ----
function setupEntrySwitcher() {
  const sel = document.getElementById('entry-switcher');
  sel.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === '__manage__') {
      // Navigate to entry card's Share & Opponents section
      document.querySelector('.tab[data-tab="entry"]').click();
      sel.value = getActiveView().type === 'mine' ? 'mine' : getActiveView().id;
      // Scroll to the share section
      setTimeout(() => {
        document.getElementById('entry-share')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }
    if (val === 'mine') {
      switchToMyEntry();
    } else {
      switchToOpponent(val);
    }
    renderDashboard();
    if (activeTab === 'bracket') renderBracket(getActiveRegion());
    if (activeTab === 'leaderboard') renderLeaderboard();
  });

  window.addEventListener('opponents-changed', () => {
    renderEntrySwitcher();
    if (activeTab === 'leaderboard') renderLeaderboard();
  });
}

function renderEntrySwitcher() {
  const sel = document.getElementById('entry-switcher');
  const opponents = getOpponents();
  const active = getActiveView();

  let html = `<option value="mine" ${active.type === 'mine' ? 'selected' : ''}>My Entry</option>`;

  if (opponents.length > 0) {
    html += `<optgroup label="Opponents">`;
    html += opponents.map(o =>
      `<option value="${o.id}" ${active.type === 'opponent' && active.id === o.id ? 'selected' : ''}>${o.name}</option>`
    ).join('');
    html += `</optgroup>`;
  }

  html += `<option value="__manage__">Manage Entries...</option>`;

  sel.innerHTML = html;
}

// ---- Leaderboard ----
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-content');
  const opponents = getOpponents();

  if (opponents.length === 0) {
    container.innerHTML = '<p class="muted">Save opponent entries to see the leaderboard.</p>';
    return;
  }

  // Score own entry
  const STORAGE_KEY = 'mm2026_entry';
  let myEntry;
  try { myEntry = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { myEntry = null; }

  const rows = [];

  if (myEntry) {
    const scoring = calculateScoring(myEntry);
    if (scoring) {
      rows.push({
        name: 'My Entry',
        points: scoring.partITotal,
        maxPossible: scoring.maxPossible,
        champion: scoring.championResult,
        finalFour: scoring.finalFourResult,
        isMine: true,
      });
    }
  }

  for (const opp of opponents) {
    const scoring = calculateScoring(opp.entry);
    if (scoring) {
      rows.push({
        name: opp.name,
        points: scoring.partITotal,
        maxPossible: scoring.maxPossible,
        champion: scoring.championResult,
        finalFour: scoring.finalFourResult,
        isMine: false,
      });
    }
  }

  rows.sort((a, b) => b.points - a.points);

  let html = `<table class="leaderboard-table">
    <thead><tr>
      <th>#</th><th>Name</th><th>Pts</th><th>Max</th><th>Champion</th><th>FF Sweep</th>
    </tr></thead><tbody>`;

  rows.forEach((r, i) => {
    const champName = r.champion.pick?.name || 'None';
    const champStatus = r.champion.status;
    const ffStatus = r.finalFour.sweepWin ? 'WON' : r.finalFour.possible ? 'Alive' : 'Dead';
    const cls = r.isMine ? 'highlight' : '';
    html += `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${r.name}${r.isMine ? ' (you)' : ''}</td>
      <td><strong>${r.points}</strong></td>
      <td>${r.maxPossible}</td>
      <td>${champName} <span class="muted">(${displayStatus(champStatus)})</span></td>
      <td>${ffStatus}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ---- Start ----
init().catch(err => {
  console.error('Init failed:', err);
  document.querySelector('main').innerHTML = `<div class="card"><h3>Error</h3><p>${err.message}</p></div>`;
});
