const { AppError } = require('./http');

const OPERATORS = ['=isnull=', '=in=', '=out=', '==', '!=', '>=', '<=', '>', '<'];

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (['(', ')', ';', ','].includes(char)) {
      tokens.push({ type: char, value: char });
      i += 1;
      continue;
    }

    const operator = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (operator) {
      tokens.push({ type: 'operator', value: operator });
      i += operator.length;
      continue;
    }

    let value = '';
    while (i < input.length) {
      const nextOperator = OPERATORS.find((candidate) => input.startsWith(candidate, i));
      if (/\s/.test(input[i]) || ['(', ')', ';', ','].includes(input[i]) || nextOperator) {
        break;
      }
      value += input[i];
      i += 1;
    }

    if (!value) {
      throw new AppError(400, `Invalid filter token near "${input.slice(i, i + 12)}"`);
    }

    tokens.push({ type: 'literal', value });
  }

  return tokens;
}

function parseFilter(input) {
  if (!input) {
    return null;
  }

  const tokens = tokenize(input);
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume(expectedType) {
    const token = tokens[index];
    if (!token || token.type !== expectedType) {
      throw new AppError(400, `Expected ${expectedType} in filter expression`);
    }
    index += 1;
    return token;
  }

  function parseValueToken() {
    const token = peek();
    if (!token) {
      throw new AppError(400, 'Unexpected end of filter expression');
    }

    if (token.type === 'literal') {
      index += 1;
      return token.value;
    }

    if (token.type === '(') {
      consume('(');
      const values = [];
      while (peek() && peek().type !== ')') {
        values.push(parseValueToken());
        if (peek() && peek().type === ',') {
          consume(',');
        }
      }
      consume(')');
      return values;
    }

    throw new AppError(400, 'Invalid filter value');
  }

  function parseComparison() {
    if (peek() && peek().type === '(') {
      consume('(');
      const node = parseOr();
      consume(')');
      return node;
    }

    const field = consume('literal').value;
    const operator = consume('operator').value;
    const value = parseValueToken();
    return { type: 'comparison', field, operator, value };
  }

  function parseAnd() {
    let left = parseComparison();
    while (peek() && peek().type === ';') {
      consume(';');
      left = { type: 'and', children: [left, parseComparison()] };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === ',') {
      consume(',');
      left = { type: 'or', children: [left, parseAnd()] };
    }
    return left;
  }

  const ast = parseOr();
  if (index !== tokens.length) {
    throw new AppError(400, 'Unexpected trailing filter content');
  }
  return ast;
}

function normaliseValue(value) {
  if (Array.isArray(value)) {
    return value.map(normaliseValue);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (!Number.isNaN(Number(value)) && value !== '') return Number(value);
  return value;
}

function compileFilter(ast, fieldMap, params) {
  if (!ast) {
    return { sql: 'TRUE' };
  }

  if (ast.type === 'and' || ast.type === 'or') {
    const compiled = ast.children.map((child) => compileFilter(child, fieldMap, params));
    const joiner = ast.type === 'and' ? ' AND ' : ' OR ';
    return { sql: `(${compiled.map((entry) => entry.sql).join(joiner)})` };
  }

  const rule = fieldMap[ast.field];
  if (!rule) {
    throw new AppError(400, `Field "${ast.field}" is not filterable`);
  }

  const normalisedValue = normaliseValue(ast.value);
  return rule(ast.operator, normalisedValue, params);
}

function pushParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function buildFieldRule(columnSql, options = {}) {
  const {
    type = 'text',
    allowOperators = ['==', '!=', '>=', '<=', '>', '<', '=in=', '=out=', '=isnull='],
    transform = (value) => value,
  } = options;

  return (operator, rawValue, params) => {
    if (!allowOperators.includes(operator)) {
      throw new AppError(400, `Operator "${operator}" is not supported for this field`);
    }

    const value = transform(rawValue);

    if (operator === '=isnull=') {
      const expectNull = value === true || value === 'true';
      return { sql: `${columnSql} IS ${expectNull ? '' : 'NOT '}NULL` };
    }

    if (operator === '=in=' || operator === '=out=') {
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) {
        throw new AppError(400, 'IN filters require at least one value');
      }
      const placeholders = values.map((entry) => pushParam(params, entry)).join(', ');
      return {
        sql: `${columnSql} ${operator === '=in=' ? 'IN' : 'NOT IN'} (${placeholders})`,
      };
    }

    const placeholder = pushParam(params, value);
    const operatorMap = {
      '==': '=',
      '!=': '<>',
      '>=': '>=',
      '<=': '<=',
      '>': '>',
      '<': '<',
    };

    return {
      sql: `${columnSql} ${operatorMap[operator]} ${placeholder}${type === 'date' ? '::date' : ''}`,
    };
  };
}

module.exports = {
  parseFilter,
  compileFilter,
  buildFieldRule,
  pushParam,
};
