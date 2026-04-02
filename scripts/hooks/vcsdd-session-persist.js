'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, readIndex, writeIndex, appendHistory, getVcsddRoot } = require('../lib/vcsdd-state');
const fs = require('fs');

run('vcsdd-session-persist', async (_payload) => {
  const vcsddRoot = getVcsddRoot();
  if (!fs.existsSync(vcsddRoot)) {
    return { blocked: false };
  }

  try {
    const index = readIndex();
    const activeFeature = index.activeFeature;

    if (!activeFeature) {
      return { blocked: false };
    }

    const state = readState(activeFeature);

    // Update denormalized index cache
    if (index.features[activeFeature]) {
      index.features[activeFeature].currentPhase = state.currentPhase;
      index.features[activeFeature].updatedAt = new Date().toISOString();
      if (Object.prototype.hasOwnProperty.call(state, 'language')) {
        index.features[activeFeature].language = state.language == null ? null : state.language;
      }
      writeIndex(index);
    }

    // Append checkpoint to history
    appendHistory({
      event: 'state_checkpoint',
      featureName: activeFeature,
      trigger: 'session-end',
      currentPhase: state.currentPhase,
      sprintCount: state.sprintCount,
    });
  } catch (err) {
    process.stderr.write(`[vcsdd-session-persist] Warning: ${err.message}\n`);
  }

  return { blocked: false };
});
