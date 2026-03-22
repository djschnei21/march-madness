// ESPN API client with caching
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const CACHE_KEY = 'mm2026_espn_cache';
const NEWS_CACHE_KEY = 'mm2026_news_cache';

let gameCache = loadCache();
let newsCache = null;
let scoreGeneration = 0;
let playerScoringCache = { generation: -1, data: null };
let teamGamesCache = { generation: -1, map: new Map() };
let teamResultCache = { generation: -1, map: new Map() };

export function getScoreGeneration() { return scoreGeneration; }

// Tournament dates for 2026
// R64: Mar 19-20, R32: Mar 21-22, S16: Mar 26-27, E8: Mar 28-29
// FF: Apr 4, Championship: Apr 6
const TOURNAMENT_DATES = [
  '20260319', '20260320',  // Round of 64
  '20260321', '20260322',  // Round of 32
  '20260326', '20260327',  // Sweet 16
  '20260328', '20260329',  // Elite 8
  '20260404',              // Final Four
  '20260406',              // Championship
];

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(gameCache));
  } catch (e) {
    // localStorage full - clear old entries
    console.warn('Cache full, clearing');
    gameCache = {};
    localStorage.setItem(CACHE_KEY, '{}');
  }
}

// Get today's date as YYYYMMDD
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// Get dates up to and including the next tournament date after today
function getDatesToFetch() {
  const today = todayStr();
  const pastAndToday = TOURNAMENT_DATES.filter(d => d <= today);
  const nextDate = TOURNAMENT_DATES.find(d => d > today);
  if (nextDate) pastAndToday.push(nextDate);
  return pastAndToday;
}

// Fetch scoreboard for a given date (groups=100 = NCAA tournament)
async function fetchScoreboard(date) {
  const url = `${BASE}/scoreboard?dates=${date}&groups=100&limit=100`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error(`Failed to fetch scoreboard for ${date}:`, e);
    return null;
  }
}

// Fetch game summary (for player stats)
async function fetchGameSummary(eventId) {
  const cacheKey = `summary_${eventId}`;
  if (gameCache[cacheKey]) return gameCache[cacheKey];

  const url = `${BASE}/summary?event=${eventId}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Cache completed game summaries permanently
    if (isGameFinal(data)) {
      gameCache[cacheKey] = data;
      saveCache();
    }
    return data;
  } catch (e) {
    console.error(`Failed to fetch summary for ${eventId}:`, e);
    return null;
  }
}

// Fetch news
async function fetchNewsRaw() {
  const url = `${BASE}/news?limit=25`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('Failed to fetch news:', e);
    return null;
  }
}

function isGameFinal(gameOrSummary) {
  // Works for both scoreboard event and summary response
  const status = gameOrSummary?.header?.competitions?.[0]?.status?.type?.completed
    || gameOrSummary?.status?.type?.completed;
  return !!status;
}

// ---- Public API ----

// All games from all tournament dates, with caching
let allGames = [];
let liveGames = [];
let lastFetchTime = 0;

export async function refreshScores() {
  const dates = getDatesToFetch();
  const today = todayStr();
  const newGames = [];
  const newLive = [];

  for (const date of dates) {
    const cacheKey = `scoreboard_${date}`;

    // Only re-fetch today's games and future; cached completed days stay cached
    if (date < today && gameCache[cacheKey]) {
      const cached = gameCache[cacheKey];
      if (cached.events) newGames.push(...cached.events);
      continue;
    }

    const data = await fetchScoreboard(date);
    if (!data || !data.events) continue;

    newGames.push(...data.events);

    // Cache days where all games are complete
    const allComplete = data.events.every(e => e.status?.type?.completed);
    if (allComplete && date < today) {
      gameCache[cacheKey] = data;
    }

    // Track live games
    data.events.forEach(e => {
      if (e.status?.type?.state === 'in') {
        newLive.push(e);
      }
    });
  }

  allGames = newGames;
  liveGames = newLive;
  lastFetchTime = Date.now();
  scoreGeneration++;
  saveCache();

  return { allGames, liveGames };
}

export function getAllGames() { return allGames; }
export function getLiveGames() { return liveGames; }
export function getLastFetchTime() { return lastFetchTime; }
export function isAnyGameLive() { return liveGames.length > 0; }

// Get games for a specific team (by ESPN ID), cached per generation
export function getGamesForTeam(teamId) {
  if (teamGamesCache.generation !== scoreGeneration) {
    teamGamesCache = { generation: scoreGeneration, map: new Map() };
  }
  if (teamGamesCache.map.has(teamId)) return teamGamesCache.map.get(teamId);

  const games = allGames.filter(game => {
    const competitors = game.competitions?.[0]?.competitors || [];
    return competitors.some(c => parseInt(c.team?.id) === teamId);
  });
  teamGamesCache.map.set(teamId, games);
  return games;
}

// Get team result from a game event, cached per generation
export function getTeamResult(game, teamId) {
  if (teamResultCache.generation !== scoreGeneration) {
    teamResultCache = { generation: scoreGeneration, map: new Map() };
  }
  const cacheKey = `${game.id}_${teamId}`;
  if (teamResultCache.map.has(cacheKey)) return teamResultCache.map.get(cacheKey);

  const comp = game.competitions?.[0];
  if (!comp) return null;

  const competitor = comp.competitors.find(c => parseInt(c.team?.id) === teamId);
  const opponent = comp.competitors.find(c => parseInt(c.team?.id) !== teamId);
  if (!competitor) return null;

  const status = game.status?.type;
  const result = {
    game,
    teamScore: parseInt(competitor.score) || 0,
    opponentScore: parseInt(opponent?.score) || 0,
    opponentId: parseInt(opponent?.team?.id),
    opponentName: opponent?.team?.displayName || opponent?.team?.shortDisplayName || '?',
    won: competitor.winner === true,
    lost: competitor.winner === false && status?.completed,
    completed: !!status?.completed,
    live: status?.state === 'in',
    scheduled: status?.state === 'pre',
    statusText: status?.shortDetail || status?.detail || '',
    period: game.status?.period || 0,
    clock: game.status?.displayClock || '',
    broadcast: comp.broadcasts?.[0]?.names?.[0] || '',
    startTime: game.date,
    roundLabel: getRoundLabel(game),
    eventId: game.id,
  };
  teamResultCache.map.set(cacheKey, result);
  return result;
}

function getRoundLabel(game) {
  // Try to determine round from game notes or date
  // Check specific rounds before "Championship" since ESPN notes often include
  // "NCAA Championship" in all rounds (e.g. "NCAA Championship - First Round")
  const note = game.competitions?.[0]?.notes?.[0]?.headline || '';
  if (note.includes('First') || note.includes('1st')) return 'R64';
  if (note.includes('Second') || note.includes('2nd')) return 'R32';
  if (note.includes('Sweet')) return 'S16';
  if (note.includes('Elite')) return 'E8';
  if (note.includes('Semifinal') || note.includes('Final Four')) return 'FF';
  if (note.includes('Championship')) return 'Final';
  // Fallback by date
  const date = game.date?.slice(0, 10)?.replace(/-/g, '') || '';
  if (date <= '20260320') return 'R64';
  if (date <= '20260322') return 'R32';
  if (date <= '20260327') return 'S16';
  if (date <= '20260329') return 'E8';
  if (date <= '20260404') return 'FF';
  return 'Final';
}

// Fetch player scoring leaders across all completed games, cached per generation
export async function fetchPlayerScoring() {
  if (playerScoringCache.generation === scoreGeneration && playerScoringCache.data) {
    return playerScoringCache.data;
  }

  const completedGames = allGames.filter(g => g.status?.type?.completed);
  const playerMap = {};

  // Limit to a reasonable batch
  const gamesToFetch = completedGames.slice(0, 50);

  for (const game of gamesToFetch) {
    const summary = await fetchGameSummary(game.id);
    if (!summary?.boxscore?.players) continue;

    for (const teamPlayers of summary.boxscore.players) {
      const teamId = parseInt(teamPlayers.team?.id);
      const teamName = teamPlayers.team?.displayName || '?';

      for (const statGroup of (teamPlayers.statistics || [])) {
        if (statGroup.name !== 'scoring') {
          // Look for points in any stat group
          const ptsIdx = statGroup.labels?.indexOf('PTS');
          if (ptsIdx === -1) continue;

          for (const athlete of (statGroup.athletes || [])) {
            const name = athlete.athlete?.displayName;
            const playerId = athlete.athlete?.id;
            if (!name || !playerId) continue;

            const pts = parseInt(athlete.stats?.[ptsIdx]) || 0;
            if (!playerMap[playerId]) {
              playerMap[playerId] = { name, playerId, teamId, teamName, games: 0, totalPoints: 0 };
            }
            playerMap[playerId].games++;
            playerMap[playerId].totalPoints += pts;
          }
        }
      }
    }
  }

  const result = Object.values(playerMap)
    .sort((a, b) => b.totalPoints - a.totalPoints);
  playerScoringCache = { generation: scoreGeneration, data: result };
  return result;
}

// Fetch team roster (cached permanently per team)
export async function fetchTeamRoster(teamId) {
  const cacheKey = `roster_${teamId}`;
  if (gameCache[cacheKey]) return gameCache[cacheKey];

  const url = `${BASE}/teams/${teamId}/roster`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const athletes = (data.athletes || []).map(a => ({
      name: a.displayName || a.fullName,
      playerId: a.id,
      position: a.position?.abbreviation || '',
    }));
    gameCache[cacheKey] = athletes;
    saveCache();
    return athletes;
  } catch (e) {
    console.error(`Failed to fetch roster for team ${teamId}:`, e);
    return [];
  }
}

// Fetch news with caching (5 min)
export async function fetchNews() {
  if (newsCache && Date.now() - newsCache.time < 300000) {
    return newsCache.data;
  }
  const data = await fetchNewsRaw();
  if (data) {
    newsCache = { data, time: Date.now() };
  }
  return data;
}
