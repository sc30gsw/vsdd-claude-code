'use strict';

const fs = require('fs');
const path = require('path');

const { run } = require('./run-with-flags');
const { getActiveFeature, getFeaturePath, appendHistory } = require('../lib/vcsdd-state');
const {
  scanSpecFrontmatterDetailed,
  rebuildFromFrontmatter,
  validateCoherence,
} = require('../lib/vcsdd-coherence');

function resolveToolName(payload) {
  return payload.tool_name || payload.toolName || '';
}

function resolveEditedPath(payload) {
  const toolInput = payload.tool_input || payload.toolInput || {};
  return toolInput.file_path || toolInput.filePath || '';
}

function canonicalPath(filePath) {
  if (!filePath) return '';
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch (_err) {
    return resolved;
  }
}

function isMarkdownSpecForFeature(filePath, featurePath) {
  if (!filePath) return false;
  const resolved = canonicalPath(filePath);
  const specsRoot = canonicalPath(path.join(featurePath, 'specs'));
  const relative = path.relative(specsRoot, resolved);

  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    resolved.endsWith('.md')
  );
}

run('vcsdd-coherence-refresh', async (payload) => {
  const toolName = resolveToolName(payload);
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    return { blocked: false };
  }

  try {
    const activeFeature = getActiveFeature();
    if (!activeFeature) {
      return { blocked: false };
    }

    const featurePath = getFeaturePath(activeFeature);
    const editedPath = resolveEditedPath(payload);
    if (!isMarkdownSpecForFeature(editedPath, featurePath)) {
      return { blocked: false };
    }

    const coherencePath = path.join(featurePath, 'coherence.json');
    const scanResult = scanSpecFrontmatterDetailed(featurePath);
    const frontmatterEntries = scanResult.entries;

    // Keep CoDD opt-in: skip pure spec edits unless the feature already has
    // coherence metadata or an existing coherence graph to refresh.
    if (frontmatterEntries.length === 0 && scanResult.errors.length === 0 && !fs.existsSync(coherencePath)) {
      return { blocked: false };
    }

    if (scanResult.errors.length > 0) {
      const message = scanResult.errors.join('; ');
      appendHistory({
        event: 'coherence_refresh_warning',
        featureName: activeFeature,
        reason: message,
      });
      process.stderr.write(`[vcsdd-coherence-refresh] ${activeFeature}: ${message}\n`);
      return { blocked: false };
    }

    const ceg = rebuildFromFrontmatter(activeFeature);
    const validation = validateCoherence(ceg);

    if (!validation.ok) {
      appendHistory({
        event: 'coherence_refresh_warning',
        featureName: activeFeature,
        reason: validation.reason,
      });
      process.stderr.write(
        `[vcsdd-coherence-refresh] ${activeFeature}: ${validation.reason}\n`
      );
    }
  } catch (err) {
    try {
      const activeFeature = getActiveFeature();
      if (activeFeature) {
        appendHistory({
          event: 'coherence_refresh_error',
          featureName: activeFeature,
          error: err.message,
        });
      }
    } catch (_innerErr) {
      // Best-effort audit logging only.
    }
    process.stderr.write(`[vcsdd-coherence-refresh] ${err.message}\n`);
  }

  return { blocked: false };
});
