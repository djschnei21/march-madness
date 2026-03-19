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
  const pickedIds = new Set(getPickedTeamIds());
  const entry = getEntry();
  const ffPicks = entry?.finalFour || {};
  const championPick = entry?.champion || null;
  const ffPickIds = new Set(Object.values(ffPicks).filter(Boolean));

  // Legend
  let html = `<div class="bracket-legend">
    <span class="bracket-legend-item"><span class="legend-swatch picked"></span> Your Pick</span>
    <span class="bracket-legend-item"><span class="legend-swatch ff-pick"></span> Final Four Pick</span>
    <span class="bracket-legend-item"><span class="legend-swatch won"></span> Won</span>
    <span class="bracket-legend-item"><span class="legend-swatch playing"></span> Playing</span>
    <span class="bracket-legend-item"><span class="legend-swatch lost"></span> Eliminated</span>
    <span class="bracket-legend-item"><span class="legend-swatch not-played"></span> Not Yet Played</span>
  </div>`;

  // Single region view
  if (activeRegion !== 'all') {
    html += renderRegionBracket(activeRegion, pickedIds, ffPickIds);
    container.innerHTML = html;
    return;
  }

  // Full bracket: traditional NCAA layout
  // Left: East (top) & South (bottom) → Semi 1
  // Right: West (top) & Midwest (bottom) → Semi 2 (mirrored)
  // Center: Championship
  const regions = getRegions(); // ['East', 'West', 'South', 'Midwest']
  const ffCenter = renderFinalFourCenter(pickedIds, ffPickIds, ffPicks, championPick, regions);

  html += '<div class="bracket-full">';
  html += `<div class="bracket-full-left">`;
  html += renderRegionBracket(regions[0], pickedIds, ffPickIds);  // East
  html += renderRegionBracket(regions[2], pickedIds, ffPickIds);  // South
  html += `</div>`;
  html += ffCenter;
  html += `<div class="bracket-full-right">`;
  html += renderRegionBracket(regions[1], pickedIds, ffPickIds);  // West
  html += renderRegionBracket(regions[3], pickedIds, ffPickIds);  // Midwest
  html += `</div>`;
  html += '</div>';

  container.innerHTML = html;
}

// Get status for a team in a specific round only
function getTeamRoundStatus(teamId, roundLabel) {
  const games = getGamesForTeam(teamId);
  for (const game of games) {
    const result = getTeamResult(game, teamId);
    if (!result) continue;
    if (result.roundLabel !== roundLabel) continue;
    if (result.completed && result.won) return 'won';
    if (result.completed && result.lost) return 'lost';
    if (result.live) return { status: 'playing', score: result };
  }
  return null; // no game in this round yet
}

function isTeamEliminated(teamId) {
  const games = getGamesForTeam(teamId);
  return games.some(g => {
    const r = getTeamResult(g, teamId);
    return r && r.completed && r.lost;
  });
}

function teamClass(teamId, pickedIds, ffPickIds, roundLabel) {
  const roundStatus = getTeamRoundStatus(teamId, roundLabel);
  const classes = ['bracket-team'];
  // FF pick (purple) takes precedence over Part I pick (blue)
  if (ffPickIds.has(teamId)) classes.push('ff-pick');
  else if (pickedIds.has(teamId)) classes.push('picked');
  if (typeof roundStatus === 'object' && roundStatus?.status === 'playing') {
    classes.push('playing');
  } else if (roundStatus === 'won') {
    classes.push('won');
  } else if (roundStatus === 'lost') {
    classes.push('lost');
  }
  return classes.join(' ');
}

function renderRegionBracket(region, pickedIds, ffPickIds) {
  const teams = getTeamsByRegion(region);
  const teamsBySeed = {};
  teams.forEach(t => { teamsBySeed[t.seed] = t; });

  // R64 matchups define the bracket structure — 8 matchups, each with a top/bottom
  const r64 = SEED_MATCHUPS.map(([s1, s2]) => ({
    top: teamsBySeed[s1],
    bottom: teamsBySeed[s2],
  }));

  // Build slot-based advancement: winners go into the correct positional slot
  // R64 matchup i winner → R32 slot i
  // R32 matchup i (slots 2i, 2i+1) winner → S16 slot i
  // S16 matchup i (slots 2i, 2i+1) winner → E8 slot i
  const advancedTeams = getAdvancedTeams(region);
  const r64Teams = r64.map(m => [m.top, m.bottom]); // 8 pairs

  // R32 slots: 8 slots, one per R64 matchup winner
  const r32Slots = new Array(8).fill(null);
  for (const { slot, teamId } of advancedTeams.r32) {
    r32Slots[slot] = getTeamById(teamId);
  }

  // S16 slots: 4 slots, one per R32 matchup winner
  const s16Slots = new Array(4).fill(null);
  for (const { slot, teamId } of advancedTeams.s16) {
    s16Slots[slot] = getTeamById(teamId);
  }

  // E8 slots: 2 slots, one per S16 matchup winner
  const e8Slots = new Array(2).fill(null);
  for (const { slot, teamId } of advancedTeams.e8) {
    e8Slots[slot] = getTeamById(teamId);
  }

  // Project FF picks forward through empty slots
  if (ffPickIds) {
    const regionTeamIds = new Set(teams.map(t => t.id));
    for (const ffId of ffPickIds) {
      if (!regionTeamIds.has(ffId) || isTeamEliminated(ffId)) continue;
      const ffTeam = getTeamById(ffId);
      if (!ffTeam) continue;
      // Find their R64 slot
      const r64Slot = SEED_MATCHUPS.findIndex(([s1, s2]) =>
        ffTeam.seed === s1 || ffTeam.seed === s2
      );
      if (r64Slot < 0) continue;
      // Project through: R32 → S16 → E8
      if (!r32Slots[r64Slot]) r32Slots[r64Slot] = ffTeam;
      const s16Slot = Math.floor(r64Slot / 2);
      if (!s16Slots[s16Slot]) s16Slots[s16Slot] = ffTeam;
      const e8Slot = Math.floor(s16Slot / 2);
      if (!e8Slots[e8Slot]) e8Slots[e8Slot] = ffTeam;
    }
  }

  let html = `<div class="bracket-region">
    <div class="bracket-region-title">${region} Region</div>
    <div class="bracket-grid">`;

  // Round of 64
  html += '<div class="bracket-round" data-round="Round of 64">';
  for (const matchup of r64) {
    html += renderMatchup(matchup.top, matchup.bottom, pickedIds, ffPickIds, 'R64');
  }
  html += '</div>';

  // R32: pair up R32 slots (0,1), (2,3), (4,5), (6,7)
  html += '<div class="bracket-round" data-round="Round of 32">';
  for (let i = 0; i < 4; i++) {
    html += renderMatchup(r32Slots[i * 2], r32Slots[i * 2 + 1], pickedIds, ffPickIds, 'R32');
  }
  html += '</div>';

  // S16: pair up S16 slots (0,1), (2,3)
  html += '<div class="bracket-round" data-round="Sweet 16">';
  for (let i = 0; i < 2; i++) {
    html += renderMatchup(s16Slots[i * 2], s16Slots[i * 2 + 1], pickedIds, ffPickIds, 'S16');
  }
  html += '</div>';

  // E8: pair up E8 slots (0,1)
  html += '<div class="bracket-round" data-round="Elite 8">';
  html += renderMatchup(e8Slots[0], e8Slots[1], pickedIds, ffPickIds, 'E8');
  html += '</div>';

  html += '</div></div>';
  return html;
}

function renderMatchup(team1, team2, pickedIds, ffPickIds, roundLabel) {
  return `<div class="bracket-matchup">
    ${renderBracketTeam(team1, pickedIds, ffPickIds, roundLabel)}
    ${renderBracketTeam(team2, pickedIds, ffPickIds, roundLabel)}
  </div>`;
}

function renderBracketTeam(team, pickedIds, ffPickIds, roundLabel) {
  if (!team) {
    return `<div class="bracket-team"><span class="bracket-seed">-</span><span>TBD</span></div>`;
  }

  const cls = teamClass(team.id, pickedIds, ffPickIds, roundLabel);
  const roundStatus = getTeamRoundStatus(team.id, roundLabel);
  let scoreHtml = '';
  if (typeof roundStatus === 'object' && roundStatus?.score) {
    scoreHtml = `<span class="bracket-score">${roundStatus.score.teamScore}</span>`;
  }

  return `<div class="${cls}">
    <span class="bracket-seed">${team.seed}</span>
    <span>${team.name}</span>
    ${scoreHtml}
  </div>`;
}

// Figure out which teams advanced in each round based on actual game results.
// Returns slot-based arrays so winners appear in the correct bracket position.
function getAdvancedTeams(region) {
  const allGames = getAllGames();
  const regionTeams = getTeamsByRegion(region);
  const regionTeamIds = new Set(regionTeams.map(t => t.id));

  // Build a seed→slot mapping from SEED_MATCHUPS
  // R64 matchup index i has seeds SEED_MATCHUPS[i], winner goes to R32 slot i
  const seedToR64Slot = {};
  SEED_MATCHUPS.forEach(([s1, s2], i) => {
    const t1 = regionTeams.find(t => t.seed === s1);
    const t2 = regionTeams.find(t => t.seed === s2);
    if (t1) seedToR64Slot[t1.id] = i;
    if (t2) seedToR64Slot[t2.id] = i;
  });

  const result = { r32: [], s16: [], e8: [] };

  // Track which team IDs are in which R32 slot (for computing S16 slots)
  const r32SlotByTeamId = {};
  const s16SlotByTeamId = {};

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
    if (roundLabel === 'R64') {
      // Winner of R64 matchup i → R32 slot i
      const slot = seedToR64Slot[winner];
      if (slot != null) {
        result.r32.push({ slot, teamId: winner });
        r32SlotByTeamId[winner] = slot;
      }
    } else if (roundLabel === 'R32') {
      // R32 matchup pairs slots (0,1),(2,3),(4,5),(6,7) → S16 slot = floor(r32slot/2)
      const r32Slot = r32SlotByTeamId[winner];
      if (r32Slot != null) {
        const s16Slot = Math.floor(r32Slot / 2);
        result.s16.push({ slot: s16Slot, teamId: winner });
        s16SlotByTeamId[winner] = s16Slot;
      }
    } else if (roundLabel === 'S16') {
      // S16 matchup pairs slots (0,1),(2,3) → E8 slot = floor(s16slot/2)
      const s16Slot = s16SlotByTeamId[winner];
      if (s16Slot != null) {
        const e8Slot = Math.floor(s16Slot / 2);
        result.e8.push({ slot: e8Slot, teamId: winner });
      }
    }
  }

  return result;
}

function getRoundFromGame(game) {
  const note = game.competitions?.[0]?.notes?.[0]?.headline || '';
  if (note.includes('First') || note.includes('1st')) return 'R64';
  if (note.includes('Second') || note.includes('2nd')) return 'R32';
  if (note.includes('Sweet')) return 'S16';
  if (note.includes('Elite')) return 'E8';
  const date = game.date?.slice(0, 10)?.replace(/-/g, '') || '';
  if (date <= '20260320') return 'R64';
  if (date <= '20260322') return 'R32';
  if (date <= '20260327') return 'S16';
  if (date <= '20260329') return 'E8';
  if (date <= '20260404') return 'FF';
  return 'Final';
}

// Render the center column: Semi 1, Championship, Semi 2
function renderFinalFourCenter(pickedIds, ffPickIds, ffPicks, championPick, regions) {
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

  let html = '<div class="bracket-center">';

  // Semifinal 1: East (regions[0]) vs South (regions[2])
  html += '<div class="bracket-center-round">';
  html += '<div class="bracket-center-label">Semifinal</div>';
  if (ffGames.length >= 1) {
    const comp = ffGames[0].competitions?.[0];
    const t1 = comp?.competitors?.[0]?.team;
    const t2 = comp?.competitors?.[1]?.team;
    html += renderMatchup(
      t1 ? getTeamById(parseInt(t1.id)) : null,
      t2 ? getTeamById(parseInt(t2.id)) : null,
      pickedIds, ffPickIds, 'FF'
    );
  } else {
    html += renderMatchup(
      ffPicks[regions[0]] ? getTeamById(ffPicks[regions[0]]) : null,
      ffPicks[regions[2]] ? getTeamById(ffPicks[regions[2]]) : null,
      pickedIds, ffPickIds, 'FF'
    );
  }
  html += '</div>';

  // Championship
  html += '<div class="bracket-center-round">';
  html += `<div class="bracket-center-label">Championship${champTeam ? ` <span class="bracket-region-pick">${champTeam.name}</span>` : ''}</div>`;
  if (champGame) {
    const comp = champGame.competitions?.[0];
    const t1 = comp?.competitors?.[0]?.team;
    const t2 = comp?.competitors?.[1]?.team;
    html += renderMatchup(
      t1 ? getTeamById(parseInt(t1.id)) : null,
      t2 ? getTeamById(parseInt(t2.id)) : null,
      pickedIds, ffPickIds, 'Final'
    );
  } else {
    // Show champion pick projected into championship slot
    html += renderMatchup(champTeam, null, pickedIds, ffPickIds, 'Final');
  }
  html += '</div>';

  // Semifinal 2: West (regions[1]) vs Midwest (regions[3])
  html += '<div class="bracket-center-round">';
  html += '<div class="bracket-center-label">Semifinal</div>';
  if (ffGames.length >= 2) {
    const comp = ffGames[1].competitions?.[0];
    const t1 = comp?.competitors?.[0]?.team;
    const t2 = comp?.competitors?.[1]?.team;
    html += renderMatchup(
      t1 ? getTeamById(parseInt(t1.id)) : null,
      t2 ? getTeamById(parseInt(t2.id)) : null,
      pickedIds, ffPickIds, 'FF'
    );
  } else {
    html += renderMatchup(
      ffPicks[regions[1]] ? getTeamById(ffPicks[regions[1]]) : null,
      ffPicks[regions[3]] ? getTeamById(ffPicks[regions[3]]) : null,
      pickedIds, ffPickIds, 'FF'
    );
  }
  html += '</div>';

  html += '</div>';
  return html;
}
