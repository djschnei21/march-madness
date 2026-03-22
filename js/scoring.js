// Scoring engine: (seed+4)*wins, bonuses, Part II
import { getTeamById } from './teams.js';
import { getEntry, getPickedTeamIds } from './participants.js';
import { getAllGames, getGamesForTeam, getTeamResult, getScoreGeneration } from './espn.js';

const ROUNDS = ['R64', 'R32', 'S16', 'E8', 'FF', 'Final'];
const ROUND_ORDER = { 'R64': 0, 'R32': 1, 'S16': 2, 'E8': 3, 'FF': 4, 'Final': 5 };

let scoringCache = { generation: -1, map: new Map() };

function entryCacheKey(entry, opts) {
  const teams = entry.teams.map(t => t.teamId || 0).join(',');
  const bonus = `${entry.champion || 0}|${entry.highScorer || ''}|${entry.highScorerTeamId || 0}`;
  const ff = Object.values(entry.finalFour || {}).join(',');
  const o = `${opts.playerLeader || ''}|${opts.tournamentComplete ? 1 : 0}`;
  return `${teams}|${bonus}|${ff}|${o}`;
}

export function calculateScoring(entryOverride = null, { playerLeader = null, tournamentComplete = false } = {}) {
  const entry = entryOverride || getEntry();
  if (!entry) return null;

  const opts = { playerLeader, tournamentComplete };
  const gen = getScoreGeneration();
  if (scoringCache.generation !== gen) {
    scoringCache = { generation: gen, map: new Map() };
  }
  const key = entryCacheKey(entry, opts);
  if (scoringCache.map.has(key)) return scoringCache.map.get(key);

  const teamResults = [];
  let partITotal = 0;
  let maxPossible = 0;

  // Calculate each team's score
  for (const pick of entry.teams) {
    const team = getTeamById(pick.teamId);
    if (!team) continue;

    const games = getGamesForTeam(pick.teamId);
    const ptsPerWin = team.seed + 4;

    let wins = 0;
    let status = 'alive';
    let currentRound = null;
    let liveGame = null;
    const roundResults = {};

    for (const game of games) {
      const result = getTeamResult(game, pick.teamId);
      if (!result) continue;

      if (result.completed && result.won) {
        wins++;
        roundResults[result.roundLabel] = 'won';
      } else if (result.completed && result.lost) {
        status = 'eliminated';
        roundResults[result.roundLabel] = 'lost';
      } else if (result.live) {
        status = 'playing';
        liveGame = result;
        roundResults[result.roundLabel] = 'playing';
      } else if (result.scheduled) {
        currentRound = result.roundLabel;
      }
    }

    const points = wins * ptsPerWin;
    partITotal += points;

    // Max possible: current points + remaining possible wins * ptsPerWin
    const maxWins = status === 'eliminated' ? wins : 6; // max 6 wins to championship
    const maxPoints = maxWins * ptsPerWin;
    maxPossible += maxPoints;

    teamResults.push({
      team,
      pick,
      ptsPerWin,
      wins,
      points,
      maxPoints,
      status,
      liveGame,
      roundResults,
      currentRound,
      games,
    });
  }

  // Check champion bonus
  const championResult = checkChampionBonus(entry);
  if (championResult.earned) partITotal += 10;
  if (championResult.possible) maxPossible += 10;

  // Check high scorer bonus
  const highScorerResult = checkHighScorerBonus(entry, playerLeader, tournamentComplete);
  if (highScorerResult.earned) partITotal += 10;
  if (highScorerResult.possible) maxPossible += 10;

  // Part II: Final Four
  const finalFourResult = checkFinalFour(entry);

  const result = {
    teamResults,
    partITotal,
    maxPossible,
    championResult,
    highScorerResult,
    finalFourResult,
  };
  scoringCache.map.set(key, result);
  return result;
}

function checkChampionBonus(entry) {
  // Find the championship game by checking the picked team's games for a 'Final' round
  // Don't use raw ESPN notes here — they include "Championship" in all rounds
  // (e.g. "NCAA Championship - First Round"), which causes false positives.
  const champTeam = getTeamById(entry.champion);
  if (!champTeam) return { pick: null, status: 'pending', earned: false, possible: false };

  const games = getGamesForTeam(entry.champion);
  const champGame = games.find(g => {
    const r = getTeamResult(g, entry.champion);
    return r?.roundLabel === 'Final';
  });

  if (!champGame) {
    // Championship game not yet reached — check if team is still alive
    const eliminated = games.some(g => {
      const r = getTeamResult(g, entry.champion);
      return r?.completed && r?.lost;
    });

    return {
      pick: champTeam,
      status: eliminated ? 'eliminated' : 'alive',
      earned: false,
      possible: !eliminated,
    };
  }

  // Championship game exists
  const result = getTeamResult(champGame, entry.champion);
  if (!result) return { pick: getTeamById(entry.champion), status: 'not_in_game', earned: false, possible: false };

  if (result.completed && result.won) {
    return { pick: getTeamById(entry.champion), status: 'correct', earned: true, possible: true };
  } else if (result.completed) {
    return { pick: getTeamById(entry.champion), status: 'incorrect', earned: false, possible: false };
  } else if (result.live) {
    return { pick: getTeamById(entry.champion), status: 'playing', earned: false, possible: true, liveGame: result };
  }

  return { pick: getTeamById(entry.champion), status: 'pending', earned: false, possible: true };
}

function checkHighScorerBonus(entry, playerLeader, tournamentComplete) {
  const pick = entry.highScorer;
  const teamId = entry.highScorerTeamId;

  if (!pick) return { pick: null, teamId, status: 'pending', earned: false, possible: false };

  // Only determine the winner once the tournament is fully complete
  if (!tournamentComplete) {
    return { pick, teamId, status: 'pending', earned: false, possible: true };
  }

  if (!playerLeader) {
    return { pick, teamId, status: 'pending', earned: false, possible: true };
  }

  const match = pick.trim().toLowerCase() === playerLeader.trim().toLowerCase();
  return {
    pick,
    teamId,
    status: match ? 'correct' : 'incorrect',
    earned: match,
    possible: match,
  };
}

function checkFinalFour(entry) {
  const regions = ['East', 'West', 'South', 'Midwest'];
  const results = {};
  let allCorrect = true;
  let allDetermined = true;
  let anyEliminated = false;

  for (const region of regions) {
    const pickId = entry.finalFour[region];
    const team = getTeamById(pickId);
    if (!team) {
      results[region] = { pick: null, status: 'empty', correct: false };
      allCorrect = false;
      anyEliminated = true; // sweep impossible without all 4 picks
      continue;
    }

    // Check if team made the Final Four (won their regional final / Elite 8)
    const games = getGamesForTeam(pickId);
    const eliminated = games.some(g => {
      const r = getTeamResult(g, pickId);
      return r?.completed && r?.lost;
    });

    // Check if they won the regional (E8 game)
    const e8Game = games.find(g => {
      const r = getTeamResult(g, pickId);
      return r?.roundLabel === 'E8';
    });

    if (e8Game) {
      const e8Result = getTeamResult(e8Game, pickId);
      if (e8Result.completed && e8Result.won) {
        results[region] = { pick: team, status: 'correct', correct: true };
      } else if (e8Result.completed) {
        results[region] = { pick: team, status: 'incorrect', correct: false };
        allCorrect = false;
        anyEliminated = true;
      } else {
        results[region] = { pick: team, status: 'playing', correct: false };
        allDetermined = false;
      }
    } else if (eliminated) {
      results[region] = { pick: team, status: 'eliminated', correct: false };
      allCorrect = false;
      anyEliminated = true;
    } else {
      results[region] = { pick: team, status: 'alive', correct: false };
      allDetermined = false;
    }
  }

  return {
    results,
    allCorrect: allCorrect && allDetermined,
    possible: !anyEliminated,
    sweepWin: allCorrect && allDetermined,
  };
}
