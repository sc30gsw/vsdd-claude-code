'use strict';

const { isHookEnabled } = require('../lib/vcsdd-flags');

/**
 * Flag-gated hook runner. Reads stdin from Claude Code hook payload,
 * checks if hook should run based on VCSDD_HOOK_PROFILE, then delegates.
 *
 * @param {string} hookName - The hook identifier (e.g., 'vcsdd-gate-check')
 * @param {Function} handler - async (payload: object) => { blocked?: boolean, message?: string }
 */
async function run(hookName, handler) {
  // Read stdin (Claude Code sends hook payload as JSON)
  let payload = {};
  try {
    const raw = require('fs').readFileSync('/dev/stdin', 'utf8');
    if (raw.trim()) {
      payload = JSON.parse(raw);
    }
  } catch (_e) {
    // No stdin or invalid JSON - continue with empty payload
  }

  // Check if this hook is enabled for the current profile
  if (!isHookEnabled(hookName)) {
    process.exit(0);
  }

  try {
    const result = await handler(payload);
    if (result && result.blocked) {
      // Exit code 2 = block the tool call in Claude Code
      if (result.message) {
        process.stderr.write(result.message + '\n');
      }
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[vcsdd-${hookName}] Error: ${err.message}\n`);
    // Don't block on hook errors - fail open
    process.exit(0);
  }
}

module.exports = { run };
