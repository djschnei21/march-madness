// Read-only participant entry card display
import { getTeamById, teamLogoUrl } from './teams.js';
import { getEntry } from './participants.js';

export function renderEntryCard() {
  const entry = getEntry();
  if (!entry) return;

  renderTeamPicks(entry);
  renderBonusPicks(entry);
  renderFinalFourPicks(entry);
  renderTiebreaker(entry);
}

function renderTeamPicks(entry) {
  const container = document.getElementById('entry-teams');
  if (!container) return;

  let html = `<table>
    <thead><tr><th>#</th><th>Team</th><th>Seed</th><th>Pts/Win</th><th></th></tr></thead>
    <tbody>`;

  entry.teams.forEach(pick => {
    const team = getTeamById(pick.teamId);
    html += `<tr>
      <td>${pick.slot}</td>
      <td>${team ? team.name : '<span class="muted">Unknown</span>'}</td>
      <td>${team ? team.seed : '-'}</td>
      <td>${team ? team.seed + 4 : '-'}</td>
      <td>${team ? `<img src="${teamLogoUrl(team.id)}" class="team-logo" alt="${team.name}" onerror="this.style.display='none'">` : ''}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderBonusPicks(entry) {
  const container = document.getElementById('entry-bonus');
  if (!container) return;

  const champTeam = getTeamById(entry.champion);
  const hsTeam = getTeamById(entry.highScorerTeamId);

  container.innerHTML = `
    <div class="entry-field">
      <label>Champion</label>
      <div class="entry-readonly">${champTeam ? `(${champTeam.seed}) ${champTeam.name}` : 'None'}</div>
    </div>
    <div class="entry-field">
      <label>Tournament High Scorer</label>
      <div class="entry-readonly">${entry.highScorer || 'None'}${hsTeam ? ` (${hsTeam.name})` : ''}</div>
    </div>
  `;
}

function renderFinalFourPicks(entry) {
  const container = document.getElementById('entry-ff');
  if (!container) return;

  const regions = ['East', 'West', 'South', 'Midwest'];
  container.innerHTML = regions.map(region => {
    const team = getTeamById(entry.finalFour[region]);
    return `<div class="entry-field">
      <label>${region} Region Champion</label>
      <div class="entry-readonly">${team ? `(${team.seed}) ${team.name}` : 'None'}</div>
    </div>`;
  }).join('');
}

function renderTiebreaker(entry) {
  const container = document.getElementById('entry-tiebreaker');
  if (!container) return;

  container.innerHTML = `
    <div class="entry-field">
      <label>Combined points in championship game</label>
      <div class="entry-readonly">${entry.tiebreaker || 'Not set'}</div>
    </div>
  `;
}
