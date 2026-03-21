// Entry card management - inline editable, localStorage auto-save
import { getTeams, getTeamById, getTeamByName, teamLogoUrl } from './teams.js';
import { fetchTeamRoster } from './espn.js';

const STORAGE_KEY = 'mm2026_entry';
const PLAYERS_KEY = 'mm2026_players';
const OPPONENTS_KEY = 'mm2026_opponents';

// Empty entry - user must fill in their own picks
const BLANK_ENTRY = {
  teams: [
    { slot: 1, teamId: null },
    { slot: 2, teamId: null },
    { slot: 3, teamId: null },
    { slot: 4, teamId: null },
    { slot: 5, teamId: null },
    { slot: 6, teamId: null },
    { slot: 7, teamId: null },
    { slot: 8, teamId: null },
    { slot: 9, teamId: null },
    { slot: 10, teamId: null },
  ],
  champion: null,
  highScorer: '',
  highScorerTeamId: null,
  highScorerPlayerId: null,
  finalFour: {
    East: null,
    West: null,
    South: null,
    Midwest: null,
  },
  tiebreaker: null,
};

let entry = null;
let viewOnly = false;
let onChangeCallbacks = [];
let activeView = { type: 'mine' };
let entryDirty = false; // true when entry has unsaved changes since last code generation
let lastSavedCode = null; // the code from the last explicit save

const bySeed = (a, b) => a.seed - b.seed;

function makeBlankEntry() {
  return {
    ...BLANK_ENTRY,
    teams: BLANK_ENTRY.teams.map(t => ({ ...t })),
    finalFour: { ...BLANK_ENTRY.finalFour },
  };
}

// Returns true if the user has picked at least one team
export function hasAnyPicks() {
  return entry && entry.teams.some(t => t.teamId != null);
}

export function loadEntry() {
  viewOnly = false;
  entryDirty = false;
  lastSavedCode = null;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      entry = JSON.parse(stored);
    } catch (e) {
      entry = makeBlankEntry();
    }
  } else {
    entry = makeBlankEntry();
  }
  return entry;
}

export function getEntry() {
  return entry;
}

export function getPickedTeamIds() {
  return entry.teams.map(t => t.teamId).filter(Boolean);
}

export function getPickedTeams() {
  return entry.teams.map(t => getTeamById(t.teamId)).filter(Boolean);
}

function saveEntry() {
  if (viewOnly) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  markDirty();
  onChangeCallbacks.forEach(cb => cb(entry));
}

// Save to localStorage without triggering re-renders (for mid-typing saves)
function saveQuiet() {
  if (viewOnly) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  markDirty();
}

function markDirty() {
  if (viewOnly) return;
  const wasDirty = entryDirty;
  entryDirty = true;
  // Re-render share section so stale state takes effect
  if (!wasDirty) renderEntryManagement();
}

export function onChange(cb) {
  onChangeCallbacks.push(cb);
}

export function updateTeamPick(slot, teamId) {
  const pick = entry.teams.find(t => t.slot === slot);
  if (pick) {
    pick.teamId = teamId;
    saveEntry();
  }
}

export function updateChampion(teamId) {
  entry.champion = teamId;
  saveEntry();
}

export function updateHighScorer(name, teamId, { quiet = false, playerId = null } = {}) {
  entry.highScorer = name;
  if (teamId !== undefined) entry.highScorerTeamId = teamId || entry.highScorerTeamId;
  if (playerId !== undefined) entry.highScorerPlayerId = playerId;
  quiet ? saveQuiet() : saveEntry();
}

export function updateFinalFour(region, teamId) {
  entry.finalFour[region] = teamId;
  saveEntry();
}

export function updateTiebreaker(value, { quiet = false } = {}) {
  entry.tiebreaker = parseInt(value) || 0;
  quiet ? saveQuiet() : saveEntry();
}

export function isViewOnly() {
  return viewOnly;
}

export function loadMyPicks() {
  viewOnly = false;
  activeView = { type: 'mine' };
  loadEntry();
  renderEntryCard();
  onChangeCallbacks.forEach(cb => cb(entry));
  window.dispatchEvent(new CustomEvent('opponents-changed'));
}

// --- Opponent CRUD ---

export function getOpponents() {
  try {
    return JSON.parse(localStorage.getItem(OPPONENTS_KEY)) || [];
  } catch { return []; }
}

export function saveOpponent(name) {
  const opponents = getOpponents();
  opponents.push({
    id: 'opp_' + Date.now(),
    name,
    entry: structuredClone(entry),
    savedAt: Date.now(),
  });
  localStorage.setItem(OPPONENTS_KEY, JSON.stringify(opponents));
}

export function deleteOpponent(id) {
  const opponents = getOpponents().filter(o => o.id !== id);
  localStorage.setItem(OPPONENTS_KEY, JSON.stringify(opponents));
}

export function switchToMyEntry() {
  activeView = { type: 'mine' };
  viewOnly = false;
  loadEntry();
  renderEntryCard();
  onChangeCallbacks.forEach(cb => cb(entry));
  window.dispatchEvent(new CustomEvent('opponents-changed'));
}

export function switchToOpponent(id) {
  const opp = getOpponents().find(o => o.id === id);
  if (!opp) return;
  entry = structuredClone(opp.entry);
  viewOnly = true;
  activeView = { type: 'opponent', id };
  renderEntryCard();
  onChangeCallbacks.forEach(cb => cb(entry));
  window.dispatchEvent(new CustomEvent('opponents-changed'));
}

export function getActiveView() {
  return activeView;
}

export function getActiveViewName() {
  if (activeView.type === 'opponent') {
    const opp = getOpponents().find(o => o.id === activeView.id);
    return opp ? opp.name + "'s Entry" : 'Opponent';
  }
  return 'My Entry';
}

// --- Entry completeness ---

export function isEntryComplete() {
  if (!entry) return false;
  if (entry.teams.some(t => t.teamId == null)) return false;
  if (!entry.champion) return false;
  if (!entry.highScorer?.trim()) return false;
  if (!entry.highScorerTeamId) return false;
  if (['East','West','South','Midwest'].some(r => !entry.finalFour[r])) return false;
  if (!entry.tiebreaker || entry.tiebreaker <= 0) return false;
  return true;
}

export function getMissingFields() {
  const missing = [];
  if (!entry) return ['No entry loaded'];
  const empty = entry.teams.filter(t => t.teamId == null).length;
  if (empty > 0) missing.push(`${empty} team slot(s)`);
  if (!entry.champion) missing.push('Champion');
  if (!entry.highScorer?.trim()) missing.push('High Scorer name');
  if (!entry.highScorerTeamId) missing.push("High Scorer's team");
  ['East','West','South','Midwest'].forEach(r => { if (!entry.finalFour[r]) missing.push(`${r} FF`); });
  if (!entry.tiebreaker || entry.tiebreaker <= 0) missing.push('Tiebreaker');
  return missing;
}

// --- Entry code system ---

export function getEntryCode() {
  return btoa(JSON.stringify(entry));
}

export function importOpponentFromCode(code, name) {
  const parsed = JSON.parse(atob(code.trim()));
  if (!parsed.teams || !Array.isArray(parsed.teams) || parsed.teams.length !== 10) {
    throw new Error('Invalid entry code');
  }
  const opponents = getOpponents();
  const trimmed = name.trim();
  const existing = opponents.find(o => o.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.entry = parsed;
    existing.savedAt = Date.now();
  } else {
    opponents.push({
      id: 'opp_' + Date.now(),
      name: trimmed,
      entry: parsed,
      savedAt: Date.now(),
    });
  }
  localStorage.setItem(OPPONENTS_KEY, JSON.stringify(opponents));
}

// --- Clipboard helper (works on file://) ---

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// Render the entry card UI
export function renderEntryCard() {
  renderViewOnlyBanner();
  renderTeamPicks();
  renderBonusPicks();
  renderFinalFourPicks();
  renderTiebreaker();
  renderSaveButton();
  renderEntryManagement();

  if (viewOnly) {
    const container = document.getElementById('entry');
    container.querySelectorAll('input, select').forEach(el => {
      el.disabled = true;
    });
  }
}

function renderViewOnlyBanner() {
  let banner = document.getElementById('view-only-banner');
  if (!viewOnly) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'view-only-banner';
    const entrySection = document.getElementById('entry');
    entrySection.prepend(banner);
  }
  banner.className = 'card view-only-banner';

  if (activeView.type === 'opponent') {
    const opp = getOpponents().find(o => o.id === activeView.id);
    const name = opp ? opp.name : 'Opponent';
    banner.innerHTML = `
      <p>Viewing ${name}'s entry</p>
      <div class="banner-actions">
        <button class="btn" id="load-my-picks">Load My Picks</button>
        <button class="btn btn-danger" id="delete-opponent">Delete</button>
      </div>
    `;
    banner.querySelector('#delete-opponent').addEventListener('click', () => {
      deleteOpponent(activeView.id);
      switchToMyEntry();
    });
  }

  const loadBtn = banner.querySelector('#load-my-picks');
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      loadMyPicks();
    });
  }
}

function renderTeamPicks() {
  const container = document.getElementById('entry-teams');
  const allTeams = getTeams();

  let html = `<table>
    <thead><tr><th>#</th><th>Team</th><th>Seed</th><th>Pts/Win</th><th></th></tr></thead>
    <tbody>`;

  // Collect all picked team IDs to filter dropdowns
  const pickedIds = new Set(entry.teams.map(t => t.teamId).filter(Boolean));

  entry.teams.forEach(pick => {
    const team = getTeamById(pick.teamId);
    html += `<tr>
      <td>${pick.slot}</td>
      <td>
        <div class="search-dropdown" data-slot="${pick.slot}">
          <input type="text" value="${team ? team.name : 'Select team...'}"
                 placeholder="Search teams..." autocomplete="off"
                 data-slot="${pick.slot}">
          <div class="dropdown-list">
            ${allTeams.slice().sort(bySeed)
              .filter(t => t.id === pick.teamId || !pickedIds.has(t.id))
              .map(t => `
              <div class="dropdown-item ${t.id === pick.teamId ? 'selected' : ''}"
                   data-team-id="${t.id}">
                (${t.seed}) ${t.name} - ${t.region}
              </div>
            `).join('')}
          </div>
        </div>
      </td>
      <td>${team ? team.seed : '-'}</td>
      <td>${team ? team.seed + 4 : '-'}</td>
      <td>${team ? `<img src="${teamLogoUrl(team.id)}" class="team-logo" alt="${team.name}" onerror="this.style.display='none'">` : ''}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;

  // Wire up search dropdowns
  container.querySelectorAll('.search-dropdown').forEach(dd => {
    const input = dd.querySelector('input');
    const list = dd.querySelector('.dropdown-list');
    const slot = parseInt(dd.dataset.slot);

    input.addEventListener('focus', () => {
      dd.classList.add('open');
      input.select();
    });

    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      dd.querySelectorAll('.dropdown-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;
      const teamId = parseInt(item.dataset.teamId);
      const team = getTeamById(teamId);
      input.value = team.name;
      dd.classList.remove('open');
      updateTeamPick(slot, teamId);
      renderEntryCard();
    });

    document.addEventListener('click', (e) => {
      if (!dd.contains(e.target)) dd.classList.remove('open');
    });
  });
}

// Cached rosters keyed by teamId — populated on demand from ESPN
let rosterCache = {};

function renderBonusPicks() {
  const container = document.getElementById('entry-bonus');
  const pickedTeams = getPickedTeams();
  const allTeams = getTeams();

  const roster = entry.highScorerTeamId ? (rosterCache[entry.highScorerTeamId] || null) : null;

  container.innerHTML = `
    <div class="entry-field">
      <label>Champion</label>
      <select class="team-select" id="champion-select">
        <option value="">Select champion...</option>
        ${pickedTeams.slice().sort(bySeed).map(t => `
          <option value="${t.id}" ${t.id === entry.champion ? 'selected' : ''}>
            (${t.seed}) ${t.name}
          </option>
        `).join('')}
      </select>
    </div>
    <div class="entry-field">
      <label>High Scorer's Team</label>
      <select class="team-select" id="highscorer-team">
        <option value="">Select team...</option>
        ${allTeams.slice().sort(bySeed).map(t => `
          <option value="${t.id}" ${t.id === entry.highScorerTeamId ? 'selected' : ''}>
            (${t.seed}) ${t.name}
          </option>
        `).join('')}
      </select>
    </div>
    <div class="entry-field">
      <label>Tournament High Scorer</label>
      ${!entry.highScorerTeamId ? `
        <select class="team-select" disabled>
          <option>Select a team first...</option>
        </select>
      ` : roster === null ? `
        <select class="team-select" disabled>
          <option>Loading roster...</option>
        </select>
      ` : `
        <select class="team-select" id="highscorer-player-select">
          <option value="">Select player...</option>
          ${roster.map(p => `
            <option value="${p.playerId}" ${String(p.playerId) === String(entry.highScorerPlayerId) ? 'selected' : ''}>
              ${p.name}${p.position ? ' (' + p.position + ')' : ''}
            </option>
          `).join('')}
          <option value="__custom__" ${entry.highScorer && !roster.some(p => String(p.playerId) === String(entry.highScorerPlayerId)) ? 'selected' : ''}>Other (type name)...</option>
        </select>
        ${entry.highScorer && !roster.some(p => String(p.playerId) === String(entry.highScorerPlayerId)) ? `
          <input type="text" class="entry-input" id="highscorer-name-custom"
                 value="${entry.highScorer || ''}" placeholder="Type player name..."
                 style="margin-top:6px">
        ` : ''}
      `}
    </div>
  `;

  // Champion
  document.getElementById('champion-select').addEventListener('change', (e) => {
    updateChampion(parseInt(e.target.value) || null);
  });

  // Team change → fetch roster, then re-render
  document.getElementById('highscorer-team').addEventListener('change', (e) => {
    const teamId = parseInt(e.target.value) || null;
    if (teamId !== entry.highScorerTeamId) {
      updateHighScorer('', teamId, { playerId: null });
    }
    if (teamId && !rosterCache[teamId]) {
      // Show loading state immediately
      renderBonusPicks();
      fetchTeamRoster(teamId).then(players => {
        rosterCache[teamId] = players;
        renderBonusPicks();
      });
    } else {
      renderBonusPicks();
    }
  });

  // If team is selected but roster not yet loaded, kick off fetch
  if (entry.highScorerTeamId && roster === null) {
    fetchTeamRoster(entry.highScorerTeamId).then(players => {
      rosterCache[entry.highScorerTeamId] = players;
      renderBonusPicks();
    });
  }

  // Player select dropdown
  const playerSelect = document.getElementById('highscorer-player-select');
  if (playerSelect) {
    playerSelect.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        updateHighScorer('', undefined, { quiet: true, playerId: null });
        renderBonusPicks();
      } else {
        const pid = e.target.value;
        const roster = rosterCache[entry.highScorerTeamId] || [];
        const player = roster.find(p => String(p.playerId) === pid);
        updateHighScorer(player?.name || '', undefined, { playerId: pid });
      }
    });
  }

  // Custom name input (shown when "Other" is selected)
  const customInput = document.getElementById('highscorer-name-custom');
  if (customInput) {
    customInput.addEventListener('input', (e) => {
      updateHighScorer(e.target.value, undefined, { quiet: true });
    });
    customInput.addEventListener('blur', (e) => {
      updateHighScorer(e.target.value.trim(), undefined);
    });
    customInput.focus();
  }
}

export function savePlayerCache(players) {
  try {
    // Store just name + team info for autocomplete
    const slim = players.slice(0, 200).map(p => ({
      name: p.name,
      teamId: p.teamId,
      teamName: p.teamName,
    }));
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(slim));
  } catch { /* ignore */ }
}

function renderFinalFourPicks() {
  const container = document.getElementById('entry-ff');
  const allTeams = getTeams();
  const regions = ['East', 'West', 'South', 'Midwest'];

  container.innerHTML = regions.map(region => `
    <div class="entry-field">
      <label>${region} Region Champion</label>
      <select class="team-select" data-region="${region}">
        <option value="">Select team...</option>
        ${allTeams.filter(t => t.region === region).sort(bySeed).map(t => `
          <option value="${t.id}" ${t.id === entry.finalFour[region] ? 'selected' : ''}>
            (${t.seed}) ${t.name}
          </option>
        `).join('')}
      </select>
    </div>
  `).join('');

  container.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      updateFinalFour(sel.dataset.region, parseInt(e.target.value) || null);
    });
  });
}

function renderTiebreaker() {
  const container = document.getElementById('entry-tiebreaker');
  container.innerHTML = `
    <div class="entry-field">
      <label>Combined points in championship game</label>
      <input type="number" class="entry-input" id="tiebreaker-input"
             value="${entry.tiebreaker || ''}" placeholder="Total points">
    </div>
  `;

  const input = document.getElementById('tiebreaker-input');
  input.addEventListener('input', (e) => {
    updateTiebreaker(e.target.value, { quiet: true });
  });
  input.addEventListener('blur', (e) => {
    updateTiebreaker(e.target.value);
  });
}

function renderSaveButton() {
  const container = document.getElementById('entry-save');
  if (!container) return;
  const card = container.closest('.card');
  if (viewOnly) {
    container.innerHTML = '';
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  const complete = isEntryComplete();
  const missing = complete ? [] : getMissingFields();

  container.innerHTML = `
    <div class="save-button-row">
      <button class="btn btn-save-entry" id="save-entry-btn">Save Entry</button>
      <button class="btn btn-clear-entry" id="clear-entry-btn">Clear</button>
    </div>
    ${!complete ? `<ul class="missing-fields" style="margin-top:8px">${missing.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
    <div id="save-feedback"></div>
  `;

  document.getElementById('save-entry-btn').addEventListener('click', () => {
    // Save and generate fresh code
    entryDirty = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    onChangeCallbacks.forEach(cb => cb(entry));

    const feedback = document.getElementById('save-feedback');
    feedback.innerHTML = '<p class="success-text">Entry saved!</p>';
    setTimeout(() => { feedback.innerHTML = ''; }, 2000);

    // Re-render share with animation
    renderEntryManagement({ animate: true });
    renderSaveButton();
  });

  document.getElementById('clear-entry-btn').addEventListener('click', () => {
    if (!confirm('Clear your entire entry and start over?')) return;
    entry = makeBlankEntry();
    entryDirty = false;
    lastSavedCode = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    onChangeCallbacks.forEach(cb => cb(entry));
    renderEntryCard();
  });
}

function renderEntryManagement({ animate = false } = {}) {
  const container = document.getElementById('entry-management');
  const opponents = getOpponents();
  let html = '';

  // --- How it works blurb ---
  html += `
    <div class="entry-mgmt-howto">
      <strong>How sharing works</strong>
      <p>Save your entry to get a share code. Send it to friends so they can import your picks, and paste theirs here to track everyone's progress. Use the <em>entry selector</em> in the header to switch between entries, and check the <em>Leaderboard</em> tab to see how everyone stacks up.</p>
    </div>
  `;

  // --- My Entry card (hidden in viewOnly) ---
  if (!viewOnly) {
    const complete = isEntryComplete();
    const statusClass = complete ? 'status-alive' : 'status-playing';
    const statusLabel = complete ? 'Complete' : 'Incomplete';

    let codeHtml;
    if (complete) {
      const code = getEntryCode();
      const isStale = entryDirty;
      lastSavedCode = isStale ? lastSavedCode : code;

      if (animate) {
        codeHtml = `
          <p class="muted" style="margin-bottom:8px">Your entry code:</p>
          <textarea class="share-code code-generating" readonly rows="3" id="entry-code-output"></textarea>
          <button class="btn" id="copy-code" disabled>Copy Code</button>
        `;
      } else if (isStale) {
        codeHtml = `
          <p class="muted" style="margin-bottom:8px">Your entry code:</p>
          <div class="share-code stale" id="entry-code-output">${lastSavedCode ? '••••••••' : ''}</div>
          <p class="stale-text" id="share-stale-msg">Entry has changed — save to generate a new code</p>
          <button class="btn btn-disabled" id="copy-code" disabled title="Save your entry first to get a fresh code">Copy Code</button>
        `;
      } else {
        codeHtml = `
          <p class="muted" style="margin-bottom:8px">Your entry code:</p>
          <textarea class="share-code" readonly rows="3" id="entry-code-output">${code}</textarea>
          <button class="btn" id="copy-code">Copy Code</button>
        `;
      }
    } else {
      lastSavedCode = null;
      const missing = getMissingFields();
      codeHtml = `
        <p class="muted" style="margin-bottom:8px">Complete your entry to generate a code</p>
        <ul class="missing-fields">
          ${missing.map(f => `<li>${f}</li>`).join('')}
        </ul>
      `;
    }

    html += `
      <div class="entry-mgmt-card entry-mgmt-mine">
        <div class="entry-mgmt-header">
          <span class="entry-mgmt-name">My Entry</span>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        ${codeHtml}
      </div>
    `;
  }

  // --- Opponent cards (always shown) ---
  for (const opp of opponents) {
    const savedDate = new Date(opp.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    html += `
      <div class="entry-mgmt-card entry-mgmt-opponent" data-id="${opp.id}">
        <div class="entry-mgmt-header">
          <div>
            <span class="entry-mgmt-name">${opp.name}</span>
            <span class="entry-mgmt-meta">Saved ${savedDate}</span>
          </div>
          <div class="entry-mgmt-actions">
            <button class="btn opponent-copy" data-id="${opp.id}">Copy Code</button>
            <button class="btn opponent-view" data-id="${opp.id}">View</button>
            <button class="btn-danger opponent-delete" data-id="${opp.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  // --- Import form (hidden in viewOnly) ---
  if (!viewOnly) {
    html += `
      <div class="entry-mgmt-import">
        <p class="muted" style="margin-bottom:8px">Import Entry</p>
        <div class="entry-field">
          <label>Opponent Name</label>
          <input type="text" class="entry-input" id="opponent-name-input" placeholder="Name">
        </div>
        <div class="entry-field">
          <label>Entry Code</label>
          <textarea class="share-code" id="opponent-code-input" rows="3" placeholder="Paste entry code here..."></textarea>
        </div>
        <button class="btn" id="add-opponent-btn">Import</button>
        <div id="import-feedback"></div>
      </div>
    `;
  }

  container.innerHTML = html;

  // --- Wire up: animate code generation ---
  if (animate && !viewOnly && isEntryComplete()) {
    const codeEl = document.getElementById('entry-code-output');
    const copyBtn = document.getElementById('copy-code');
    const code = getEntryCode();
    const chars = code.split('');
    let i = 0;
    const interval = setInterval(() => {
      const chunk = Math.min(i + 8, chars.length);
      codeEl.value = code.slice(0, chunk);
      i = chunk;
      if (i >= chars.length) {
        clearInterval(interval);
        codeEl.classList.remove('code-generating');
        codeEl.classList.add('code-fresh');
        if (copyBtn) copyBtn.disabled = false;
        lastSavedCode = code;
        setTimeout(() => codeEl.classList.remove('code-fresh'), 1500);
      }
    }, 15);
  }

  // --- Wire up: copy code button ---
  const copyBtn = document.getElementById('copy-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyToClipboard(document.getElementById('entry-code-output').value);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Code'; }, 2000);
    });
  }

  // --- Wire up: opponent Copy Code buttons ---
  container.querySelectorAll('.opponent-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const opp = opponents.find(o => o.id === btn.dataset.id);
      if (!opp) return;
      copyToClipboard(btoa(JSON.stringify(opp.entry)));
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Code'; }, 2000);
    });
  });

  // --- Wire up: opponent View buttons ---
  container.querySelectorAll('.opponent-view').forEach(btn => {
    btn.addEventListener('click', () => {
      switchToOpponent(btn.dataset.id);
      renderEntryCard();
      window.dispatchEvent(new CustomEvent('opponents-changed'));
    });
  });

  // --- Wire up: opponent Delete buttons ---
  container.querySelectorAll('.opponent-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteOpponent(btn.dataset.id);
      window.dispatchEvent(new CustomEvent('opponents-changed'));
      renderEntryManagement();
    });
  });

  // --- Wire up: import form ---
  const addBtn = document.getElementById('add-opponent-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('opponent-name-input');
      const codeInput = document.getElementById('opponent-code-input');
      const feedback = document.getElementById('import-feedback');
      const name = nameInput.value.trim();
      const code = codeInput.value.trim();

      if (!name) {
        feedback.innerHTML = '<p class="error-text">Enter an opponent name</p>';
        return;
      }
      if (!code) {
        feedback.innerHTML = '<p class="error-text">Paste an entry code</p>';
        return;
      }

      try {
        importOpponentFromCode(code, name);
        feedback.innerHTML = `<p class="success-text">Added ${name}!</p>`;
        nameInput.value = '';
        codeInput.value = '';
        window.dispatchEvent(new CustomEvent('opponents-changed'));
        renderEntryManagement();
      } catch (e) {
        feedback.innerHTML = '<p class="error-text">Invalid entry code</p>';
      }
    });
  }
}
