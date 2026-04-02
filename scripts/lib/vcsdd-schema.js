'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_FILE_MAP = {
  state: 'vcsdd-state.schema.json',
  index: 'vcsdd-index.schema.json',
  contract: 'vcsdd-contract.schema.json',
  grading: 'vcsdd-grading.schema.json',
  finding: 'vcsdd-finding.schema.json',
  bead: 'vcsdd-bead.schema.json',
  coherence: 'vcsdd-coherence.schema.json',
};

const schemaCache = new Map();
const CANONICAL_GRADING_DIMENSIONS = [
  'spec_fidelity',
  'edge_case_coverage',
  'implementation_correctness',
  'structural_integrity',
  'verification_readiness',
];
const FINDING_CATEGORY_DIMENSIONS = {
  spec_ambiguity: 'spec_fidelity',
  spec_gap: 'spec_fidelity',
  requirement_mismatch: 'spec_fidelity',
  missing_edge_case: 'edge_case_coverage',
  test_coverage: 'edge_case_coverage',
  test_quality: 'edge_case_coverage',
  implementation_bug: 'implementation_correctness',
  error_handling: 'implementation_correctness',
  security_surface: 'implementation_correctness',
  code_structure: 'structural_integrity',
  naming: 'structural_integrity',
  duplication: 'structural_integrity',
  proof_gap: 'verification_readiness',
  invariant_violation: 'verification_readiness',
  purity_boundary: 'verification_readiness',
  verification_tool_mismatch: 'verification_readiness',
};

function getSchemaPath(name) {
  const fileName = SCHEMA_FILE_MAP[name];
  if (!fileName) {
    throw new Error(`Unknown VCSDD schema: ${name}`);
  }
  return path.join(__dirname, '..', '..', 'schemas', fileName);
}

function loadSchema(name) {
  if (!schemaCache.has(name)) {
    const schemaPath = getSchemaPath(name);
    schemaCache.set(name, JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
  }
  return schemaCache.get(name);
}

function validateDocument(name, value) {
  const schema = loadSchema(name);
  const errors = [];
  validateAgainstSchema(schema, value, '$', schema, errors);
  validateSemanticRules(name, value, errors);
  return { valid: errors.length === 0, errors };
}

function assertValidDocument(name, value, contextLabel) {
  const result = validateDocument(name, value);
  if (!result.valid) {
    const label = contextLabel || `${name} document`;
    throw new Error(`Invalid ${label}: ${result.errors.join('; ')}`);
  }
}

function validateAgainstSchema(schema, value, valuePath, rootSchema, errors) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  if (schema.$ref) {
    validateAgainstSchema(resolveRef(schema.$ref, rootSchema), value, valuePath, rootSchema, errors);
    return;
  }

  if (schema.anyOf) {
    const anyPasses = schema.anyOf.some((candidate) => {
      const candidateErrors = [];
      validateAgainstSchema(candidate, value, valuePath, rootSchema, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!anyPasses) {
      errors.push(`${valuePath} does not satisfy any allowed schema`);
    }
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${valuePath} must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${valuePath} must be one of: ${schema.enum.join(', ')}`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matchesType = allowedTypes.some((typeName) => isTypeMatch(typeName, value));
    if (!matchesType) {
      errors.push(`${valuePath} must be of type ${allowedTypes.join(' | ')}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${valuePath} must have length >= ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${valuePath} must have length <= ${schema.maxLength}`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${valuePath} must match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${valuePath} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${valuePath} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${valuePath} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${valuePath} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${valuePath} must not contain duplicate items`);
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateAgainstSchema(schema.items, item, `${valuePath}[${index}]`, rootSchema, errors);
      });
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    const required = schema.required || [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
        errors.push(`${valuePath}.${key} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
        validateAgainstSchema(childSchema, value[key], `${valuePath}.${key}`, rootSchema, errors);
      }
    }

    const additional = schema.additionalProperties;
    if (additional === false) {
      for (const key of Object.keys(value)) {
        if (value[key] !== undefined && !Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${valuePath}.${key} is not allowed`);
        }
      }
    } else if (additional && typeof additional === 'object') {
      for (const key of Object.keys(value)) {
        if (value[key] !== undefined && !Object.prototype.hasOwnProperty.call(properties, key)) {
          validateAgainstSchema(additional, value[key], `${valuePath}.${key}`, rootSchema, errors);
        }
      }
    }
  }
}

function resolveRef(ref, rootSchema) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported schema ref: ${ref}`);
  }

  let current = rootSchema;
  for (const segment of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Unable to resolve schema ref: ${ref}`);
    }
    current = current[segment];
  }
  return current;
}

function isTypeMatch(typeName, value) {
  switch (typeName) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateSemanticRules(name, value, errors) {
  switch (name) {
    case 'grading':
      validateGradingSemantics(value, errors);
      break;
    case 'finding':
      validateFindingSemantics(value, errors);
      break;
    case 'contract':
      validateContractSemantics(value, errors);
      break;
    default:
      break;
  }
}

function validateGradingSemantics(value, errors) {
  if (!value || !Array.isArray(value.dimensions)) {
    return;
  }

  const names = value.dimensions.map((dimension) => dimension && dimension.name).filter(Boolean);
  const uniqueNames = new Set(names);

  if (uniqueNames.size !== names.length) {
    errors.push('$.dimensions must not repeat dimension names');
  }

  const missing = CANONICAL_GRADING_DIMENSIONS.filter((dimension) => !uniqueNames.has(dimension));
  if (missing.length > 0) {
    errors.push(`$.dimensions must include all canonical dimensions: missing ${missing.join(', ')}`);
  }

  const hasFail = value.dimensions.some((dimension) => dimension && dimension.verdict === 'FAIL');
  const expectedOverallVerdict = hasFail ? 'FAIL' : 'PASS';
  if (value.overallVerdict && value.overallVerdict !== expectedOverallVerdict) {
    errors.push(`$.overallVerdict must equal ${expectedOverallVerdict} based on per-dimension verdicts`);
  }

  value.dimensions.forEach((dimension, index) => {
    if (!dimension || typeof dimension !== 'object') {
      return;
    }

    const findings = Array.isArray(dimension.findings) ? dimension.findings : [];
    const evidence = Array.isArray(dimension.evidence) ? dimension.evidence : [];
    const prefix = `$.dimensions[${index}]`;

    if (dimension.verdict === 'PASS' && evidence.length === 0) {
      errors.push(`${prefix}.evidence must include at least one concrete citation for PASS verdicts`);
    }

    if (dimension.verdict === 'PASS' && findings.length > 0) {
      errors.push(`${prefix}.findings must be empty when verdict is PASS`);
    }

    if (dimension.verdict === 'FAIL' && findings.length === 0) {
      errors.push(`${prefix}.findings must include at least one finding when verdict is FAIL`);
    }
  });

  const reviewContext = value.reviewContext;
  if (reviewContext && reviewContext.reviewType === 'contract') {
    if (!reviewContext.contractPath) {
      errors.push('$.reviewContext.contractPath is required when reviewType is contract');
    }
    if (!reviewContext.contractDigest) {
      errors.push('$.reviewContext.contractDigest is required when reviewType is contract');
    }
  }
}

function validateFindingSemantics(value, errors) {
  if (value && value.category && value.dimension) {
    const expectedDimension = FINDING_CATEGORY_DIMENSIONS[value.category];
    if (expectedDimension && value.dimension !== expectedDimension) {
      errors.push(`$.category ${value.category} must use dimension ${expectedDimension}`);
    }
  }

  const evidence = value && value.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return;
  }

  const lineRange = evidence.lineRange;
  if (typeof lineRange !== 'string') {
    return;
  }

  const match = lineRange.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return;
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  if (start < 1 || end < start) {
    errors.push('$.evidence.lineRange must be a positive 1-based range with start <= end');
  }
}

function validateContractSemantics(value, errors) {
  if (!value || !Array.isArray(value.criteria)) {
    return;
  }

  const ids = value.criteria.map((criterion) => criterion && criterion.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    errors.push('$.criteria must not repeat criterion ids');
  }
}

module.exports = {
  SCHEMA_FILE_MAP,
  CANONICAL_GRADING_DIMENSIONS,
  FINDING_CATEGORY_DIMENSIONS,
  loadSchema,
  validateDocument,
  assertValidDocument,
};
