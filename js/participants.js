// Participant management - pre-loaded from picks_2026.json
import { getTeamById } from './teams.js';

const SELECTED_KEY = 'mm2026_selected';

let participants = [];
let selectedId = null;

export async function loadParticipants() {
  const resp = await fetch('data/picks_2026.json');
  participants = await resp.json();

  // Restore last selected participant
  const stored = localStorage.getItem(SELECTED_KEY);
  if (stored && participants.some(p => p.id === stored)) {
    selectedId = stored;
  } else if (participants.length > 0) {
    selectedId = participants[0].id;
  }
}

export function getAllParticipants() {
  return participants;
}

export function getSelectedParticipant() {
  return participants.find(p => p.id === selectedId) || participants[0] || null;
}

export function selectParticipant(id) {
  const p = participants.find(p => p.id === id);
  if (p) {
    selectedId = id;
    try { localStorage.setItem(SELECTED_KEY, id); } catch {}
  }
}

export function getEntry() {
  const p = getSelectedParticipant();
  return p || null;
}

export function getPickedTeamIds() {
  const p = getSelectedParticipant();
  if (!p) return [];
  return p.teams.map(t => t.teamId).filter(Boolean);
}

export function hasAnyPicks() {
  const p = getSelectedParticipant();
  return p && p.teams.some(t => t.teamId != null);
}
