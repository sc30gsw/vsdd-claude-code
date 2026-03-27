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

run('vsdd-gate-check', async (payload) => {
  const toolName = payload.tool_name || payload.toolName || '';
  const toolInput = payload.tool_input || payload.toolInput || {};
  const filePath = toolInput.file_path || toolInput.filePath || '';

  // Only check write operations
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    return { blocked: false };
  }

  if (!filePath) {
    return { blocked: false };
  }

  // Always allow .vsdd state/audit files
  if (isAlwaysAllowed(filePath)) {
    return { blocked: false };
  }

  // Get active feature and current phase
  let activeFeature;
  let currentPhase;

  try {
    activeFeature = getActiveFeature();
    if (!activeFeature) {
      // No active VSDD feature - allow all writes
      return { blocked: false };
    }
    const state = readState(activeFeature);
    currentPhase = state.currentPhase;
  } catch (_e) {
    // Can't read state - fail open
    return { blocked: false };
  }

  // Check each restriction
  for (const restriction of WRITE_RESTRICTIONS) {
    if (restriction.blockedInPhases.has(currentPhase) && restriction.matches(filePath)) {
      return {
        blocked: true,
        message:
          `[VSDD Gate] Cannot write ${restriction.name} during phase ${currentPhase}.\n` +
          `File: ${filePath}\n` +
          `Feature: ${activeFeature} | Phase: ${currentPhase}\n` +
          `Run /vsdd-status to see required phase progression.`,
      };
    }
  }

  return { blocked: false };
});
