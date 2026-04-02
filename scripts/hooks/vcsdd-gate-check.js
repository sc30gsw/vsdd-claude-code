'use strict';

const path = require('path');
const { run } = require('./run-with-flags');
const { getActiveFeature, readState } = require('../lib/vcsdd-state');
const SOURCE_FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|cpp|c|cc|cxx|h|hpp|hh|hxx|rb|swift|kt)$/i;

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
        (SOURCE_FILE_EXTENSION_RE.test(norm) &&
         !norm.includes('test') &&
         !norm.includes('spec') &&
         !norm.includes('.vcsdd/') &&
         !norm.includes('scripts/'))
      );
    },
  },
  {
    // Test files: blocked until phase 2a
    name: 'test files',
    blockedInPhases: new Set(['init', '1a', '1b', '1c']),
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
    blockedInPhases: new Set(['init', '2a', '2b', '2c', '3', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vcsdd/') && norm.includes('/specs/');
    },
  },
  {
    // Verification artifacts: only writable in phase 5
    name: 'verification artifacts',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '2c', '3', '4', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vcsdd/') && norm.includes('/verification/');
    },
  },
  {
    // Red-phase evidence: only writable during phase 2a
    name: 'red phase evidence',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2b', '2c', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vcsdd/') && /\/evidence\/sprint-\d+-red-phase\.log$/i.test(norm);
    },
  },
  {
    // Green-phase evidence: only writable during implementation/refactor
    name: 'green phase evidence',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vcsdd/') && /\/evidence\/sprint-\d+-green-phase\.log$/i.test(norm);
    },
  },
  {
    // Coverage evidence: allowed only in implementation/verification phases
    name: 'coverage evidence',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '3', '4', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('.vcsdd/') && /\/evidence\/sprint-\d+-coverage\.json$/i.test(norm);
    },
  },
  {
    // Pipeline state must flow through the state library, not direct edits
    name: 'VCSDD control files',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '2c', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return (
        norm.includes('/.vcsdd/') && (
          norm.endsWith('/index.json') ||
          norm.endsWith('/history.jsonl') ||
          norm.endsWith('/active-feature.txt') ||
          norm.endsWith('/state.json')
        )
      );
    },
  },
  {
    // Spec review manifests/verdicts are only writable during phase 1c
    name: 'spec review artifacts',
    blockedInPhases: new Set(['init', '1a', '1b', '2a', '2b', '2c', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('/.vcsdd/') && norm.includes('/reviews/spec/');
    },
  },
  {
    // Contract review manifests/verdicts are only writable during phase 2c
    name: 'contract review artifacts',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('/.vcsdd/') && norm.includes('/reviews/contracts/');
    },
  },
  {
    // Sprint review manifests/verdicts are only writable during phase 3
    name: 'sprint review artifacts',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '2c', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('/.vcsdd/') && /\/reviews\/sprint-\d+\//i.test(norm);
    },
  },
  {
    // The approved sprint contract is part of the gate and should not change mid-review
    name: 'approved sprint contracts',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '3', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('/.vcsdd/') && /\/contracts\/sprint-\d+\.md$/i.test(norm);
    },
  },
  {
    // Escalations are audit records and should only be created via the orchestration library
    name: 'escalation records',
    blockedInPhases: new Set(['init', '1a', '1b', '1c', '2a', '2b', '2c', '3', '4', '5', '6', 'complete']),
    matches: (filePath) => {
      const norm = filePath.replace(/\\/g, '/');
      return norm.includes('/.vcsdd/') && norm.includes('/escalations/');
    },
  },
];

function stripQuotes(s) {
  const t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function splitCommandSegments(command) {
  return String(command || '')
    .split(/(?:&&|\|\||[;|\n])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeSegment(segment) {
  return String(segment || '').match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
}

function isReadOnlySegment(segment) {
  const tokens = tokenizeSegment(segment).map(stripQuotes);
  if (tokens.length === 0) return true;

  const command = tokens[0];
  const readOnlyCommands = new Set([
    'cat', 'grep', 'rg', 'ag', 'sed', 'awk', 'head', 'tail', 'less', 'more',
    'wc', 'ls', 'find', 'stat', 'file', 'diff', 'cmp', 'comm', 'sort',
    'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink',
    'pwd', 'echo', 'printf', 'which', 'type', 'env',
  ]);

  if (readOnlyCommands.has(command)) {
    return !(command === 'sed' && tokens.includes('-i'));
  }

  if (command === 'git') {
    const subcommand = tokens[1] || '';
    return new Set([
      'status', 'diff', 'show', 'log', 'grep', 'rev-parse', 'ls-files',
      'blame', 'branch', 'remote', 'tag',
    ]).has(subcommand);
  }

  return false;
}

function looksLikePathToken(token) {
  const value = stripQuotes(token).replace(/[),:]+$/, '');
  if (!value || value.startsWith('-') || value === '.' || value === '..') {
    return false;
  }

  return (
    value.includes('/') ||
    value.startsWith('.') ||
    /^(src|lib|app|core|test|tests|__tests__|specs|verification|\.vcsdd)(\/|$)/.test(value) ||
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|cpp|c|cc|cxx|h|hpp|hh|hxx|rb|swift|kt|json|md|log)$/i.test(value)
  );
}

function extractPathTokensFromSegment(segment) {
  const out = new Set();
  for (const token of tokenizeSegment(segment)) {
    const value = stripQuotes(token).replace(/[),:]+$/, '');
    if (looksLikePathToken(value) && !value.includes('*') && !value.includes('?')) {
      out.add(value);
    }
  }
  return [...out];
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

  for (const segment of splitCommandSegments(cmd)) {
    if (isReadOnlySegment(segment)) continue;
    for (const token of extractPathTokensFromSegment(segment)) {
      out.add(token);
    }
  }

  return [...out];
}

function checkRestrictionsForPath(filePath, currentPhase, activeFeature) {
  if (!filePath) return null;

  for (const restriction of WRITE_RESTRICTIONS) {
    if (restriction.blockedInPhases.has(currentPhase) && restriction.matches(filePath)) {
      return (
        `[VCSDD Gate] Cannot write ${restriction.name} during phase ${currentPhase}.\n` +
        `File: ${filePath}\n` +
        `Feature: ${activeFeature} | Phase: ${currentPhase}\n` +
        `Run /vcsdd-status to see required phase progression.`
      );
    }
  }
  return null;
}

run('vcsdd-gate-check', async (payload) => {
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
            `If this is a false positive, adjust the command or use VCSDD_HOOK_PROFILE=minimal.`,
        };
      }
    }
    return { blocked: false };
  }

  return { blocked: false };
});
