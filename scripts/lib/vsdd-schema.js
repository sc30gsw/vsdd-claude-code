'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_FILE_MAP = {
  state: 'vsdd-state.schema.json',
  index: 'vsdd-index.schema.json',
  contract: 'vsdd-contract.schema.json',
  grading: 'vsdd-grading.schema.json',
  finding: 'vsdd-finding.schema.json',
  bead: 'vsdd-bead.schema.json',
};

const schemaCache = new Map();

function getSchemaPath(name) {
  const fileName = SCHEMA_FILE_MAP[name];
  if (!fileName) {
    throw new Error(`Unknown VSDD schema: ${name}`);
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

module.exports = {
  SCHEMA_FILE_MAP,
  loadSchema,
  validateDocument,
  assertValidDocument,
};
