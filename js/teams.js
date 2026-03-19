// Team data management and lookups
let teamsData = [];

export async function loadTeams() {
  if (teamsData.length > 0) return teamsData;
  const resp = await fetch('data/teams.json');
  const data = await resp.json();
  teamsData = data.teams;
  return teamsData;
}

export function getTeams() {
  return teamsData;
}

export function getTeamById(id) {
  return teamsData.find(t => t.id === id);
}

export function getTeamByName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return teamsData.find(t =>
    t.name.toLowerCase() === lower ||
    `${t.name} ${t.mascot}`.toLowerCase() === lower
  );
}

export function getTeamsByRegion(region) {
  return teamsData.filter(t => t.region === region);
}

export function getTeamsBySeed(seed) {
  return teamsData.filter(t => t.seed === seed);
}

export function getRegions() {
  return ['East', 'West', 'South', 'Midwest'];
}

// ESPN logo URL for a team
export function teamLogoUrl(espnId) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
}

// Match an ESPN API team object to our teams list
export function matchEspnTeam(espnTeamObj) {
  if (!espnTeamObj) return null;
  const espnId = parseInt(espnTeamObj.id);
  return teamsData.find(t => t.id === espnId);
}
