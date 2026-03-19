// Bracket rendering
import { getTeamsByRegion, getTeamById, getRegions, teamLogoUrl } from './teams.js';
import { getPickedTeamIds, getEntry } from './entry.js';
import { getGamesForTeam, getTeamResult, getAllGames } from './espn.js';

// Standard bracket matchups by seed (1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15)
const SEED_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]
];

export function renderBracket(activeRegion = 'all') {
  const container = document.getElementById('bracket-container');
  const regions = activeRegion === 'all' ? getRegions() : [activeRegion];
  const pickedIds = new Set(getPickedTeamIds());
  const entry = getEntry();
  const ffPicks = entry?.finalFour || {};
  const championPick = entry?.champion || null;
  const ffPickIds = new Set(Object.values(ffPicks).filter(Boolean));

  // Legend
  let html = `<div class="bracket-legend">
    <span class="bracket-legend-item"><span class="legend-swatch picked"></span> Your Pick (Part I)</span>
    <span class="bracket-legend-item"><span class="legend-swatch ff-pick"></span> Your Pick (Part II)</span>
    <span class="bracket-legend-item"><span class="legend-swatch won"></span> Won</span>
    <span class="bracket-legend-item"><span class="legend-swatch playing"></span> Playing</span>
    <span class="bracket-legend-item"><span class="legend-swatch lost"></span> Eliminated</span>
  </div>`;

  for (const region of regions) {
    // Regional brackets: only highlight Part I picks (blue)
    html += renderRegionBracket(region, pickedIds);
  }

  // Final Four (only when showing all): only highlight Part II picks (purple)
  if (activeRegion === 'all') {
    html += renderFinalFour(ffPickIds, ffPicks, championPick);
  }

  container.innerHTML = html;
}

function getTeamStatus(teamId) {
  const games = getGamesForTeam(teamId);
  let wins = 0;
  let eliminated = false;
  let playing = false;
  let latestScore = null;

  for (const game of games) {
    const result = getTeamResult(game, teamId);
    if (!result) continue;
    if (result.completed && result.won) wins++;
    if (result.completed && result.lost) eliminated = true;
    if (result.live) {
      playing = true;
      latestScore = result;
    }
  }

  return { wins, eliminated, playing, latestScore };
}

// highlightClass: 'picked' for Part I (blue), 'ff-pick' for Part II (purple)
function teamClass(teamId, highlightIds, highlightClass) {
  const status = getTeamStatus(teamId);
  const classes = ['bracket-team'];
  if (highlightIds.has(teamId)) classes.push(highlightClass);
  if (status.eliminated) classes.push('lost');
  else if (status.playing) classes.push('playing');
  else if (status.wins > 0) classes.push('won');
  return classes.join(' ');
}

function renderRegionBracket(region, pickedIds) {
  const teams = getTeamsByRegion(region);
  const teamsBySeed = {};
  teams.forEach(t => { teamsBySeed[t.seed] = t; });

  const r64 = SEED_MATCHUPS.map(([s1, s2]) => ({
    top: teamsBySeed[s1],
    bottom: teamsBySeed[s2],
  }));

  const advancedTeams = getAdvancedTeams(region);

  let html = `<div class="bracket-region">
    <div class="bracket-region-title">${region} Region</div>
    <div class="bracket-grid" style="grid-template-columns: repeat(4, 1fr);">`;

  // Round of 64
  html += '<div class="bracket-round">';
  for (const matchup of r64) {
    html += renderMatchup(matchup.top, matchup.bottom, pickedIds, 'picked');
  }
  html += '</div>';

  // R32
  html += '<div class="bracket-round">';
  for (let i = 0; i < 4; i++) {
    const t1 = advancedTeams.r32?.[i * 2];
    const t2 = advancedTeams.r32?.[i * 2 + 1];
    html += renderMatchup(
      t1 ? getTeamById(t1) : null,
      t2 ? getTeamById(t2) : null,
      pickedIds, 'picked'
    );
  }
  html += '</div>';

  // S16
  html += '<div class="bracket-round">';
  for (let i = 0; i < 2; i++) {
    const t1 = advancedTeams.s16?.[i * 2];
    const t2 = advancedTeams.s16?.[i * 2 + 1];
    html += renderMatchup(
      t1 ? getTeamById(t1) : null,
      t2 ? getTeamById(t2) : null,
      pickedIds, 'picked'
    );
  }
  html += '</div>';

  // E8
  html += '<div class="bracket-round">';
  const e1 = advancedTeams.e8?.[0];
  const e2 = advancedTeams.e8?.[1];
  html += renderMatchup(
    e1 ? getTeamById(e1) : null,
    e2 ? getTeamById(e2) : null,
    pickedIds, 'picked'
  );
  html += '</div>';

  html += '</div></div>';
  return html;
}

function renderMatchup(team1, team2, highlightIds, highlightClass) {
  return `<div class="bracket-matchup">
    ${renderBracketTeam(team1, highlightIds, highlightClass)}
    ${renderBracketTeam(team2, highlightIds, highlightClass)}
  </div>`;
}

function renderBracketTeam(team, highlightIds, highlightClass) {
  if (!team) {
    return `<div class="bracket-team"><span class="bracket-seed">-</span><span>TBD</span></div>`;
  }

  const cls = teamClass(team.id, highlightIds, highlightClass);
  const status = getTeamStatus(team.id);
  let scoreHtml = '';
  if (status.latestScore) {
    scoreHtml = `<span class="bracket-score">${status.latestScore.teamScore}</span>`;
  }

  return `<div class="${cls}">
    <span class="bracket-seed">${team.seed}</span>
    <span>${team.name}</span>
    ${scoreHtml}
  </div>`;
}

// Figure out which teams advanced in each round based on actual game results
function getAdvancedTeams(region) {
  const allGames = getAllGames();
  const regionTeams = getTeamsByRegion(region);
  const regionTeamIds = new Set(regionTeams.map(t => t.id));

  const result = { r32: [], s16: [], e8: [] };

  for (const game of allGames) {
    const comp = game.competitions?.[0];
    if (!comp || !game.status?.type?.completed) continue;

    const c1 = comp.competitors[0];
    const c2 = comp.competitors[1];
    const id1 = parseInt(c1?.team?.id);
    const id2 = parseInt(c2?.team?.id);

    if (!regionTeamIds.has(id1) && !regionTeamIds.has(id2)) continue;

    const winner = c1?.winner ? id1 : c2?.winner ? id2 : null;
    if (!winner) continue;

    const roundLabel = getRoundFromGame(game);
    if (roundLabel === 'R64') result.r32.push(winner);
    else if (roundLabel === 'R32') result.s16.push(winner);
    else if (roundLabel === 'S16') result.e8.push(winner);
  }

  return result;
}

function getRoundFromGame(game) {
  const note = game.competitions?.[0]?.notes?.[0]?.headline || '';
  if (note.includes('Elite')) return 'E8';
  if (note.includes('Sweet')) return 'S16';
  if (note.includes('Second') || note.includes('2nd')) return 'R32';
  if (note.includes('First') || note.includes('1st')) return 'R64';
  const date = game.date?.slice(0, 10)?.replace(/-/g, '') || '';
  if (date <= '20260320') return 'R64';
  if (date <= '20260322') return 'R32';
  if (date <= '20260327') return 'S16';
  if (date <= '20260329') return 'E8';
  if (date <= '20260404') return 'FF';
  return 'Final';
}

function renderFinalFour(ffPickIds, ffPicks, championPick) {
  const allGames = getAllGames();

  const ffGames = allGames.filter(g => {
    const note = g.competitions?.[0]?.notes?.[0]?.headline || '';
    const date = g.date?.slice(0, 10)?.replace(/-/g, '') || '';
    return note.includes('Semifinal') || note.includes('Final Four') || date === '20260404';
  });

  const champGame = allGames.find(g => {
    const note = g.competitions?.[0]?.notes?.[0]?.headline || '';
    const date = g.date?.slice(0, 10)?.replace(/-/g, '') || '';
    return note.includes('National Championship') || date === '20260406';
  });

  const champTeam = championPick ? getTeamById(championPick) : null;

  let html = `<div class="bracket-region bracket-final-four">
    <div class="bracket-region-title">Part II — Final Four & Championship${champTeam ? ` <span class="bracket-region-pick">Champion pick: ${champTeam.name}</span>` : ''}</div>
    <div class="bracket-grid" style="grid-template-columns: repeat(2, 1fr);">`;

  // Semifinals — highlight with purple (Part II picks)
  html += '<div class="bracket-round">';
  if (ffGames.length >= 2) {
    for (const game of ffGames.slice(0, 2)) {
      const comp = game.competitions?.[0];
      const t1 = comp?.competitors?.[0]?.team;
      const t2 = comp?.competitors?.[1]?.team;
      html += renderMatchup(
        t1 ? getTeamById(parseInt(t1.id)) : null,
        t2 ? getTeamById(parseInt(t2.id)) : null,
        ffPickIds, 'ff-pick'
      );
    }
  } else {
    const regions = ['East', 'South', 'West', 'Midwest'];
    for (let i = 0; i < 2; i++) {
      const r1 = regions[i * 2];
      const r2 = regions[i * 2 + 1];
      html += renderMatchup(
        ffPicks[r1] ? getTeamById(ffPicks[r1]) : null,
        ffPicks[r2] ? getTeamById(ffPicks[r2]) : null,
        ffPickIds, 'ff-pick'
      );
    }
  }
  html += '</div>';

  // Championship
  html += '<div class="bracket-round">';
  if (champGame) {
    const comp = champGame.competitions?.[0];
    const t1 = comp?.competitors?.[0]?.team;
    const t2 = comp?.competitors?.[1]?.team;
    html += renderMatchup(
      t1 ? getTeamById(parseInt(t1.id)) : null,
      t2 ? getTeamById(parseInt(t2.id)) : null,
      ffPickIds, 'ff-pick'
    );
  } else {
    html += renderMatchup(null, null, ffPickIds, 'ff-pick');
  }
  html += '</div>';

  html += '</div></div>';
  return html;
}
