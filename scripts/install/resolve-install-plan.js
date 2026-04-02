#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROFILES_PATH = path.join(REPO_ROOT, 'manifests', 'install-profiles.json');
const MODULES_PATH = path.join(REPO_ROOT, 'manifests', 'install-modules.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveInstallPlan(profile, language, extraModuleIds = []) {
  const profilesManifest = loadJson(PROFILES_PATH);
  const modulesManifest = loadJson(MODULES_PATH);
  const profileConfig = profilesManifest.profiles[profile];
  if (!profileConfig) {
    throw new Error(`Unknown install profile: ${profile}`);
  }

  const moduleMap = new Map(
    (modulesManifest.modules || []).map((entry) => [entry.id, entry])
  );

  const requestedModules = [...profileConfig.modules];
  if (language) {
    const languageConfig = profilesManifest.languageProfiles[language];
    if (!languageConfig) {
      throw new Error(`Unknown language profile: ${language}`);
    }
    requestedModules.push(...languageConfig.modules);
  }
  if (extraModuleIds.length > 0) {
    requestedModules.push(...extraModuleIds);
  }

  const resolvedModules = [];
  const visited = new Set();
  const visiting = new Set();

  for (const moduleId of requestedModules) {
    visitModule(moduleId, moduleMap, visited, visiting, resolvedModules);
  }

  const uniquePaths = [];
  const seenPaths = new Set();
  for (const moduleId of resolvedModules) {
    const moduleEntry = moduleMap.get(moduleId);
    for (const relPath of moduleEntry.paths || []) {
      if (!seenPaths.has(relPath)) {
        seenPaths.add(relPath);
        uniquePaths.push(relPath);
      }
    }
  }

  return {
    profile,
    language: language || null,
    hookProfile: profileConfig.hookProfile || 'standard',
    modules: resolvedModules,
    paths: uniquePaths,
  };
}

function visitModule(moduleId, moduleMap, visited, visiting, output) {
  if (visited.has(moduleId)) {
    return;
  }
  if (visiting.has(moduleId)) {
    throw new Error(`Cyclic module dependency detected at ${moduleId}`);
  }

  const moduleEntry = moduleMap.get(moduleId);
  if (!moduleEntry) {
    throw new Error(`Unknown install module: ${moduleId}`);
  }

  visiting.add(moduleId);
  for (const dependency of moduleEntry.dependencies || []) {
    visitModule(dependency, moduleMap, visited, visiting, output);
  }
  visiting.delete(moduleId);
  visited.add(moduleId);
  output.push(moduleId);
}

function parseArgs(argv) {
  const options = {
    profile: 'standard',
    language: '',
    modules: '',
    format: 'json',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--profile':
        options.profile = argv[i + 1];
        i += 1;
        break;
      case '--language':
        options.language = argv[i + 1];
        i += 1;
        break;
      case '--modules':
        options.modules = argv[i + 1];
        i += 1;
        break;
      case '--format':
        options.format = argv[i + 1];
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const extraModuleIds = (options.modules || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const plan = resolveInstallPlan(
      options.profile,
      options.language || null,
      extraModuleIds,
    );

    if (options.format === 'paths') {
      process.stdout.write(plan.paths.join('\n') + '\n');
    } else {
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  resolveInstallPlan,
};
