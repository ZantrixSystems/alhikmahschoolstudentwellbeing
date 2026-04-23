export class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const OPERATORS = ["=isnull=", "=in=", "=out=", "==", "!=", ">=", "<=", ">", "<"];

function tokenizeFilter(input) {
  const tokens = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (["(", ")", ";", ","].includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    const operator = OPERATORS.find((candidate) => input.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: "operator", value: operator });
      index += operator.length;
      continue;
    }

    let value = "";
    while (index < input.length) {
      const nextOperator = OPERATORS.find((candidate) => input.startsWith(candidate, index));
      if (/\s/.test(input[index]) || ["(", ")", ";", ","].includes(input[index]) || nextOperator) {
        break;
      }
      value += input[index];
      index += 1;
    }

    if (!value) {
      throw new AppError(`Invalid filter token near "${input.slice(index, index + 12)}"`);
    }

    tokens.push({ type: "literal", value });
  }

  return tokens;
}

export function parseFilter(input) {
  if (!input) return null;

  const tokens = tokenizeFilter(input);
  let cursor = 0;

  const peek = () => tokens[cursor];
  const consume = (expectedType) => {
    const token = tokens[cursor];
    if (!token || token.type !== expectedType) {
      throw new AppError(`Expected ${expectedType} in filter expression`);
    }
    cursor += 1;
    return token;
  };

  const parseValueToken = () => {
    const token = peek();
    if (!token) {
      throw new AppError("Unexpected end of filter expression");
    }

    if (token.type === "literal") {
      cursor += 1;
      return token.value;
    }

    if (token.type === "(") {
      consume("(");
      const values = [];
      while (peek() && peek().type !== ")") {
        values.push(parseValueToken());
        if (peek() && peek().type === ",") consume(",");
      }
      consume(")");
      return values;
    }

    throw new AppError("Invalid filter value");
  };

  const parseComparison = () => {
    if (peek() && peek().type === "(") {
      consume("(");
      const nested = parseOr();
      consume(")");
      return nested;
    }

    const field = consume("literal").value;
    const operator = consume("operator").value;
    const value = parseValueToken();
    return { type: "comparison", field, operator, value };
  };

  const parseAnd = () => {
    let left = parseComparison();
    while (peek() && peek().type === ";") {
      consume(";");
      left = { type: "and", children: [left, parseComparison()] };
    }
    return left;
  };

  const parseOr = () => {
    let left = parseAnd();
    while (peek() && peek().type === ",") {
      consume(",");
      left = { type: "or", children: [left, parseAnd()] };
    }
    return left;
  };

  const ast = parseOr();
  if (cursor !== tokens.length) {
    throw new AppError("Unexpected trailing filter content");
  }

  return ast;
}

function normaliseValue(value) {
  if (Array.isArray(value)) return value.map(normaliseValue);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export function pushSqlParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

export function buildFieldRule(columnSql, options = {}) {
  const {
    allowOperators = ["==", "!=", ">=", "<=", ">", "<", "=in=", "=out=", "=isnull="],
    transform = (value) => value,
  } = options;

  return (operator, rawValue, params) => {
    if (!allowOperators.includes(operator)) {
      throw new AppError(`Operator "${operator}" is not supported for this field`);
    }

    const value = transform(rawValue);
    if (operator === "=isnull=") {
      const expectNull = value === true || value === "true";
      return { sql: `${columnSql} IS ${expectNull ? "" : "NOT "}NULL` };
    }

    if (operator === "=in=" || operator === "=out=") {
      const values = Array.isArray(value) ? value : [value];
      if (!values.length) throw new AppError("IN filters require at least one value");
      const placeholders = values.map((entry) => pushSqlParam(params, entry)).join(", ");
      return {
        sql: `${columnSql} ${operator === "=in=" ? "IN" : "NOT IN"} (${placeholders})`,
      };
    }

    const placeholder = pushSqlParam(params, value);
    const operatorMap = {
      "==": "=",
      "!=": "<>",
      ">=": ">=",
      "<=": "<=",
      ">": ">",
      "<": "<",
    };
    return {
      sql: `${columnSql} ${operatorMap[operator]} ${placeholder}`,
    };
  };
}

export function compileFilter(ast, fieldMap, params) {
  if (!ast) return { sql: "TRUE" };

  if (ast.type === "and" || ast.type === "or") {
    const compiledChildren = ast.children.map((child) => compileFilter(child, fieldMap, params));
    const joiner = ast.type === "and" ? " AND " : " OR ";
    return { sql: `(${compiledChildren.map((entry) => entry.sql).join(joiner)})` };
  }

  const rule = fieldMap[ast.field];
  if (!rule) throw new AppError(`Field "${ast.field}" is not filterable`);
  return rule(ast.operator, normaliseValue(ast.value), params);
}
