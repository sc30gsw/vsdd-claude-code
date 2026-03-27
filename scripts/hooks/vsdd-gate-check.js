'use strict';

const path = require('path');
const { run } = require('./run-with-flags');
const { getActiveFeature, readState } = require('../lib/vsdd-state');

// Phase-to-allowed-paths mapping
// Each entry: { phases: string[], pattern: RegExp | (filePath: string) => boolean }
const WRITE_RESTRICTIONS = [
  {
    // Source code: blocked until phase 2b
    name: 'source files',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return (
        norm.includes('/src/') ||
        norm.includes('/lib/') ||
        norm.includes('/app/') ||
        norm.includes('/core/') ||
        (norm.match(/\.(ts|js|py|rs|go|java|cpp|c|rb|swift|kt)$/) &&
         !norm.includes('test') &&
         !norm.includes('spec') &&
         !norm.includes('.vsdd/') &&
         !norm.includes('scripts/'))
      );
    },
  },
  {
    // Test files: blocked in phases init, 1a, 1b
    name: 'test files',
    blockedInPhases: new Set(['init', '1a', '1b']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/').toLowerCase();
      return (
        norm.includes('/tests/') ||
        norm.includes('/test/') ||
        norm.includes('__tests__') ||
        norm.includes('.test.') ||
        norm.includes('.spec.') ||
        norm.match(/_test\.(ts|js|py|rs|go)$/) !== null
      );
    },
  },
  {
    // Spec files: only writable in spec phases and phase 4 feedback
    name: 'spec files (outside spec phases)',
    blockedInPhases: new Set(['2a', '2b', '2c', '3', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vsdd/') && norm.includes('/specs/');
    },
  },
  {
    // Verification artifacts: only writable in phase 5
    name: 'verification artifacts',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '2c', '3', '4', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vsdd/') && norm.includes('/verification/');
    },
  },
];

// Paths always allowed regardless of phase
function isAlwaysAllowed(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  return (
    norm.includes('/.vsdd/') && (
      norm.includes('/state.json') ||
      norm.includes('/index.json') ||
      norm.includes('/history.jsonl') ||
      norm.includes('/active-feature.txt') ||
      norm.includes('/evidence/') ||
      norm.includes('/reviews/') ||
      norm.includes('/contracts/') ||
      norm.includes('/escalations/')
    )
  );
}

function stripQuotes(s) {
  const t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Best-effort paths a Bash one-liner might write to (redirects, tee, sed -i).
 * @param {string} command
 * @returns {string[]}
 */
function extractWriteTargetsFromBash(command) {
  const out = new Set();
  const cmd = String(command || '').replace(/\\/g, '/');
  if (!cmd.trim()) return [];

  let m;
  const redir = /(?:^|[\s;|])(?:\d?>>?)\s*([^\s;&|'"<>]+|["'][^"']+["'])/g;
  while ((m = redir.exec(cmd)) !== null) {
    const p = stripQuotes(m[1]);
    if (p && p !== '/dev/null' && !p.startsWith('&')) out.add(p);
  }
  const teeRe = /\btee(?:\s+-a)?\s+([^\s;&|]+|["'][^"']+["'])/g;
  while ((m = teeRe.exec(cmd)) !== null) {
    out.add(stripQuotes(m[1]));
  }
  if (/\bsed\s+-i\b/.test(cmd) || /\bperl\s+-pi?\s+-e\b/.test(cmd)) {
    const parts = cmd.split(/\s+/);
    for (const part of parts) {
      const t = stripQuotes(part);
      if (t.startsWith('-') || t.length < 2) continue;
      if ((t.includes('/') || t.startsWith('.')) && !t.includes('*') && !t.includes('?')) {
        out.add(t);
      }
    }
  }
  return [...out];
}

function checkRestrictionsForPath(filePath, currentPhase, activeFeature) {
  if (!filePath) return null;
  if (isAlwaysAllowed(filePath)) return null;

  for (const restriction of WRITE_RESTRICTIONS) {
    if (restriction.blockedInPhases.has(currentPhase) && restriction.matches(filePath)) {
      return (
        `[VSDD Gate] Cannot write ${restriction.name} during phase ${currentPhase}.\n` +
        `File: ${filePath}\n` +
        `Feature: ${activeFeature} | Phase: ${currentPhase}\n` +
        `Run /vsdd-status to see required phase progression.`
      );
    }
  }
  return null;
}

run('vsdd-gate-check', async (payload) => {
  const toolName = payload.tool_name || payload.toolName || '';
  const toolInput = payload.tool_input || payload.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';

  let activeFeature;
  let currentPhase;

  try {
    activeFeature = getActiveFeature();
    if (!activeFeature) {
      return { blocked: false };
    }
    const state = readState(activeFeature);
    currentPhase = state.currentPhase;
  } catch (_e) {
    return { blocked: false };
  }

  // Write / Edit / MultiEdit
  if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    if (!filePath) {
      return { blocked: false };
    }
    if (isAlwaysAllowed(filePath)) {
      return { blocked: false };
    }
    const msg = checkRestrictionsForPath(filePath, currentPhase, activeFeature);
    if (msg) return { blocked: true, message: msg };
    return { blocked: false };
  }

  // Bash: heuristic — block shell redirects into disallowed paths for this phase
  if (toolName === 'Bash') {
    const command =
      toolInput.command ||
      toolInput.bash_command ||
      toolInput.shell_command ||
      toolInput.cmd ||
      '';
    const targets = extractWriteTargetsFromBash(command);
    if (targets.length === 0) {
      return { blocked: false };
    }
    for (const raw of targets) {
      const resolved = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
      const norm = resolved.replace(/\\/g, '/');
      const msg = checkRestrictionsForPath(norm, currentPhase, activeFeature);
      if (msg) {
        return {
          blocked: true,
          message:
            msg +
            `\n(Bash heuristic; command referenced path: ${raw})\n` +
            `If this is a false positive, adjust the command or use VSDD_HOOK_PROFILE=minimal.`,
        };
      }
    }
    return { blocked: false };
  }

  return { blocked: false };
});
