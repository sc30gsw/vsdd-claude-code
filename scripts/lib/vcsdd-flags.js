'use strict';

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

// Hook profile semantics:
// minimal  - gate enforcement OFF, session persistence ON, coherence refresh OFF, auto-commit OFF
// standard - gate enforcement ON,  session persistence ON, coherence refresh ON,  auto-commit OFF
// strict   - gate enforcement ON,  session persistence ON, coherence refresh ON,  auto-commit ON

const HOOK_PROFILE_MAP = {
  'vcsdd-gate-check':      ['standard', 'strict'],
  'vcsdd-session-start':   ['minimal', 'standard', 'strict'],
  'vcsdd-session-persist':  ['minimal', 'standard', 'strict'],
  'vcsdd-pre-compact':     ['standard', 'strict'],
  'vcsdd-coherence-refresh': ['standard', 'strict'],
  'vcsdd-auto-commit':     ['strict'],
};

function getProfile() {
  const raw = String(process.env.VCSDD_HOOK_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHooks() {
  const raw = String(process.env.VCSDD_DISABLED_HOOKS || '');
  if (!raw.trim()) return new Set();
  return new Set(raw.split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
}

function isHookEnabled(hookName, options = {}) {
  const id = String(hookName || '').trim().toLowerCase();
  if (!id) return true;

  // Check explicit disable list
  if (getDisabledHooks().has(id)) return false;

  const profile = getProfile();

  // Check profile-based hook map
  const allowedProfiles = HOOK_PROFILE_MAP[id];
  if (allowedProfiles) {
    return allowedProfiles.includes(profile);
  }

  // If hook not in map, use custom profiles from options
  const customProfiles = parseProfiles(options.profiles);
  return customProfiles.includes(profile);
}

function parseProfiles(raw, fallback = ['standard', 'strict']) {
  if (!raw) return [...fallback];
  if (Array.isArray(raw)) {
    const parsed = raw.map(v => String(v).trim().toLowerCase()).filter(v => VALID_PROFILES.has(v));
    return parsed.length > 0 ? parsed : [...fallback];
  }
  const parsed = String(raw).split(',').map(v => v.trim().toLowerCase()).filter(v => VALID_PROFILES.has(v));
  return parsed.length > 0 ? parsed : [...fallback];
}

module.exports = {
  VALID_PROFILES,
  HOOK_PROFILE_MAP,
  getProfile,
  getDisabledHooks,
  isHookEnabled,
  parseProfiles,
};
