// Main application - init, tab routing, refresh loop, dashboard rendering
import { loadTeams, getTeamById, teamLogoUrl } from './teams.js';
import { loadParticipants, getAllParticipants, getSelectedParticipant, selectParticipant, getEntry, getPickedTeamIds, hasAnyPicks } from './participants.js';
import { renderEntryCard } from './entry.js';
import { refreshScores, isAnyGameLive, getLastFetchTime, getAllGames, getGamesForTeam, getTeamResult, fetchPlayerScoring, fetchNews } from './espn.js';
import { calculateScoring } from './scoring.js';
import { renderBracket } from './bracket.js';

let refreshTimer = null;
let activeTab = 'dashboard';
let topScorerName = null;

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
  await loadParticipants();

  setupTabs();
  setupRefreshButton();
  setupEntrySwitcher();

  renderEntrySwitcher();

  document.getElementById('team-cards').innerHTML =
    '<div class="loading-indicator"><div class="spinner"></div> Loading scores...</div>';
  await refreshScores();
  renderDashboard();
  renderBracket();
  startRefreshLoop();
  updateLastRefresh();

  // Eager-load player scoring for high scorer bonus (non-blocking)
  fetchPlayerScoring().then(players => {
    if (players?.length > 0) {
      topScorerName = players[0].name;
      renderDashboard();
    }
  });
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
    const btn = document.getElementById('btn-refresh');
    btn.disabled = true;
    btn.classList.add('refreshing');
    await refreshScores();
    btn.disabled = false;
    btn.classList.remove('refreshing');
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
    // Keep player scoring data current (non-blocking, cached per generation)
    fetchPlayerScoring().then(players => {
      if (players?.length > 0) topScorerName = players[0].name;
    });
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

// ---- Helpers ----
function findChampionshipGame() {
  return getAllGames().find(g => {
    const date = g.date?.slice(0, 10)?.replace(/-/g, '') || '';
    return date === '20260406';
  });
}

function isTournamentComplete() {
  const champGame = findChampionshipGame();
  return champGame?.status?.type?.completed === true;
}

function getActualChampionshipTotal() {
  const champGame = findChampionshipGame();
  if (!champGame?.status?.type?.completed) return null;
  const competitors = champGame.competitions?.[0]?.competitors || [];
  if (competitors.length < 2) return null;
  return (parseInt(competitors[0].score) || 0) + (parseInt(competitors[1].score) || 0);
}

function scoringOptions() {
  return { playerLeader: topScorerName, tournamentComplete: isTournamentComplete() };
}

function getViewName() {
  const p = getSelectedParticipant();
  return p ? p.name : 'Unknown';
}

// ---- Dashboard Rendering ----
function renderDashboard() {
  const scoring = calculateScoring(null, scoringOptions());
  if (!scoring) return;

  // Update header scores
  const viewName = getViewName();
  const totalLabel = document.querySelector('.total-points .label');
  if (totalLabel) totalLabel.textContent = viewName;
  document.getElementById('total-points').textContent = scoring.partITotal;
  document.getElementById('max-points').textContent = scoring.maxPossible;

  // Team cards
  renderTeamCards(scoring.teamResults);

  // Bonus card
  renderBonusCard(scoring.championResult, scoring.highScorerResult);

  // Final Four card
  renderFinalFourCard(scoring.finalFourResult);

  // Upcoming games
  renderUpcomingGames(scoring);

  // Headlines (async, non-blocking)
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
        &middot; ${lg.clock} ${lg.period === 1 ? '1st Half' : lg.period === 2 ? '2nd Half' : lg.period ? `OT${lg.period > 3 ? lg.period - 2 : ''}` : ''} ${lg.broadcast ? `&middot; ${lg.broadcast}` : ''}
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

function renderUpcomingGames(scoring) {
  const container = document.querySelector('#upcoming-card .upcoming-list');
  const heading = document.querySelector('#upcoming-card h3');
  if (heading) heading.textContent = getViewName() + "'s Schedule";

  // Collect Part I team IDs
  const partITeamIds = new Set(scoring.teamResults.map(tr => tr.team.id));

  // Build a map of teamId -> { team, tags[] } for all bonus picks not already in Part I
  const bonusTeams = new Map();
  const addBonusTeam = (teamId, team, tag) => {
    if (!teamId || !team || partITeamIds.has(teamId)) return;
    if (!bonusTeams.has(teamId)) bonusTeams.set(teamId, { team, tags: [] });
    bonusTeams.get(teamId).tags.push(tag);
  };

  // Final Four picks
  if (scoring.finalFourResult?.results) {
    for (const region of Object.values(scoring.finalFourResult.results)) {
      if (region.pick) addBonusTeam(region.pick.id, region.pick, 'Final Four');
    }
  }
  // Champion pick
  if (scoring.championResult?.pick) {
    addBonusTeam(scoring.championResult.pick.id, scoring.championResult.pick, 'Champion');
  }
  // High scorer team
  if (scoring.highScorerResult?.teamId) {
    const hsTeam = getTeamById(scoring.highScorerResult.teamId);
    if (hsTeam) addBonusTeam(hsTeam.id, hsTeam, 'High Scorer');
  }

  const upcoming = [];

  // Part I teams (no tag)
  for (const tr of scoring.teamResults) {
    if (tr.status === 'eliminated') continue;
    const games = getGamesForTeam(tr.team.id);
    for (const game of games) {
      const result = getTeamResult(game, tr.team.id);
      if (!result) continue;
      if (result.scheduled || result.live) {
        upcoming.push({ ...result, team: tr.team, tag: null });
      }
    }
  }

  // Bonus teams (with tag)
  for (const [teamId, { team, tags }] of bonusTeams) {
    const games = getGamesForTeam(teamId);
    for (const game of games) {
      const result = getTeamResult(game, teamId);
      if (!result) continue;
      if (result.scheduled || result.live) {
        upcoming.push({ ...result, team, tag: tags.join(', ') });
      }
    }
  }

  // Sort by start time
  upcoming.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  if (upcoming.length === 0) {
    container.innerHTML = '<p class="muted">No upcoming games</p>';
    return;
  }

  container.innerHTML = upcoming.map(g => {
    const time = new Date(g.startTime);

    // Determine tag color based on first tag keyword
    let tagHtml = '';
    if (g.tag) {
      let color = 'var(--accent-purple)';
      if (g.tag.includes('Champion')) color = 'var(--accent-amber)';
      else if (g.tag.includes('High Scorer')) color = 'var(--accent-blue)';
      tagHtml = ` <span class="schedule-tag" style="color:${color}">${g.tag}</span>`;
    }

    if (g.live) {
      const periodStr = g.period === 1 ? '1st Half' : g.period === 2 ? '2nd Half' : g.period ? `OT${g.period > 3 ? g.period - 2 : ''}` : '';
      return `<div class="upcoming-game live">
        <div>
          <strong>${g.team.name}</strong>${tagHtml} vs ${g.opponentName}
          <div class="live-score" style="margin-top:4px">
            <strong>${g.teamScore} - ${g.opponentScore}</strong>
            &middot; ${g.clock} ${periodStr} ${g.broadcast ? `&middot; ${g.broadcast}` : ''}
          </div>
        </div>
      </div>`;
    }

    const timeStr = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' +
      time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    return `<div class="upcoming-game">
      <div>
        <strong>${g.team.name}</strong>${tagHtml} vs ${g.opponentName}
        <div class="upcoming-time">${timeStr}</div>
      </div>
      ${g.broadcast ? `<span class="upcoming-tv">${g.broadcast}</span>` : ''}
    </div>`;
  }).join('');
}

// ---- High Scorer Tab ----
async function renderHighScorer() {
  const container = document.getElementById('player-leaderboard');
  container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div> Loading player stats...</div>';

  const entry = getEntry();
  const players = await fetchPlayerScoring();

  if (!players || players.length === 0) {
    container.innerHTML = '<p class="muted">No player scoring data available yet. Stats will appear as games complete.</p>';
    return;
  }

  // Track tournament scoring leader for high scorer bonus verification
  topScorerName = players[0]?.name || null;

  const highScorerName = entry?.highScorer?.toLowerCase() || '';

  let html = `<table class="player-table">
    <thead><tr>
      <th>#</th><th>Player</th><th>Team</th><th>GP</th><th>PTS</th><th>PPG</th>
    </tr></thead><tbody>`;

  players.slice(0, 50).forEach((p, i) => {
    const isHighlight = highScorerName && p.name.toLowerCase() === highScorerName;
    const cls = isHighlight ? 'highlight' : '';
    const ppg = p.games > 0 ? (p.totalPoints / p.games).toFixed(1) : '0.0';

    html += `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${p.name} ${isHighlight ? '***' : ''}</td>
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

  container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div> Loading headlines...</div>';

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
  if (heading) heading.textContent = getViewName() + "'s Headlines";

  container.innerHTML = articles.map(article => {
    return `<div class="headline-item">
      <a href="${article.links?.web?.href || '#'}" target="_blank">${article.headline}</a>
    </div>`;
  }).join('');

  if (!isFiltered && pickedTeams.length > 0) {
    container.innerHTML += '<p class="muted" style="margin-top:6px;font-size:0.75rem">No news specific to picked teams - showing general headlines</p>';
  }
}

// ---- Entry Switcher ----
function setupEntrySwitcher() {
  const sel = document.getElementById('entry-switcher');
  sel.addEventListener('change', (e) => {
    selectParticipant(e.target.value);
    renderDashboard();
    if (activeTab === 'bracket') renderBracket(getActiveRegion());
    if (activeTab === 'entry') renderEntryCard();
    if (activeTab === 'leaderboard') renderLeaderboard();
  });
}

function renderEntrySwitcher() {
  const sel = document.getElementById('entry-switcher');
  const participants = getAllParticipants();
  const selected = getSelectedParticipant();

  // Sort alphabetically by name
  const sorted = [...participants].sort((a, b) => a.name.localeCompare(b.name));

  sel.innerHTML = sorted.map(p =>
    `<option value="${p.id}" ${p.id === selected?.id ? 'selected' : ''}>${p.name}</option>`
  ).join('');
}

// ---- Leaderboard ----
async function renderLeaderboard() {
  const container = document.getElementById('leaderboard-content');

  // Show loading indicator while computing
  container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div> Loading leaderboard...</div>';

  // Ensure player scoring data is loaded for high scorer bonus
  if (topScorerName === null) {
    const players = await fetchPlayerScoring();
    if (players?.length > 0) topScorerName = players[0].name;
  }

  const opts = scoringOptions();
  const participants = getAllParticipants();
  const selected = getSelectedParticipant();

  const rows = [];
  for (const p of participants) {
    const scoring = calculateScoring(p, opts);
    if (scoring) {
      rows.push({
        id: p.id,
        name: p.name,
        points: scoring.partITotal,
        maxPossible: scoring.maxPossible,
        champion: scoring.championResult,
        finalFour: scoring.finalFourResult,
        tiebreaker: p.tiebreaker || 0,
      });
    }
  }

  // Check for jackpot winners (Part II - all 4 Final Four picks correct)
  const jackpotWinners = rows.filter(r => r.finalFour.sweepWin);
  const isJackpot = jackpotWinners.length > 0;

  // Sort by points descending; jackpot winners always on top
  rows.sort((a, b) => {
    if (isJackpot) {
      const aJackpot = a.finalFour.sweepWin ? 1 : 0;
      const bJackpot = b.finalFour.sweepWin ? 1 : 0;
      if (aJackpot !== bJackpot) return bJackpot - aJackpot;
    }
    return b.points - a.points;
  });

  // Apply tiebreaker for 1st place ties (only when championship is complete)
  const actualTotal = getActualChampionshipTotal();
  if (!isJackpot && actualTotal !== null && rows.length >= 2 && rows[0].points === rows[1].points) {
    const topScore = rows[0].points;
    let tieEnd = 0;
    while (tieEnd < rows.length && rows[tieEnd].points === topScore) tieEnd++;
    const tieGroup = rows.splice(0, tieEnd);
    tieGroup.sort((a, b) => Math.abs(a.tiebreaker - actualTotal) - Math.abs(b.tiebreaker - actualTotal));
    rows.unshift(...tieGroup);
  }

  let html = '';

  // Jackpot banner
  if (isJackpot) {
    const names = jackpotWinners.map(w => w.name).join(', ');
    html += `<div class="jackpot-banner">
      JACKPOT! ${names} picked all 4 Final Four teams correctly and win${jackpotWinners.length === 1 ? 's' : ''} the entire pot!
      <div class="muted" style="font-size:0.8rem;margin-top:4px;">All Part I scoring is voided.</div>
    </div>`;
  }

  // Tiebreaker column header
  const tbHeader = actualTotal !== null ? `TB (Actual: ${actualTotal})` : 'TB';

  html += `<table class="leaderboard-table">
    <thead><tr>
      <th>#</th><th>Name</th><th>Pts</th><th>Max</th><th>${tbHeader}</th><th>Champion</th><th>FF Sweep</th>
    </tr></thead><tbody>`;

  rows.forEach((r, i) => {
    const champName = r.champion.pick?.name || 'None';
    const champStatus = r.champion.status;
    const ffStatus = r.finalFour.sweepWin ? 'WON' : r.finalFour.possible ? 'Alive' : 'Dead';
    const cls = r.id === selected?.id ? 'highlight' : '';
    const ptsClass = isJackpot ? 'voided' : '';

    // Tiebreaker display
    let tbDisplay = r.tiebreaker > 0 ? `${r.tiebreaker}` : '-';
    if (actualTotal !== null && r.tiebreaker > 0) {
      tbDisplay += ` <span class="muted">(${Math.abs(r.tiebreaker - actualTotal)})</span>`;
    }

    html += `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${r.name}</td>
      <td class="${ptsClass}"><strong>${r.points}</strong></td>
      <td class="${ptsClass}">${r.maxPossible}</td>
      <td>${tbDisplay}</td>
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
