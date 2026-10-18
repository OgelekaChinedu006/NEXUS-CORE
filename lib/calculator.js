import { CommandError } from './helpers.js';

const FUNCTIONS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = input.slice(index).match(/^(?:\d+\.?\d*|\.\d+)/);
      if (!match) throw new CommandError('Malformed number in the equation.');
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(char)) {
      const match = input.slice(index).match(/^[a-zA-Z]+/);
      const word = match[0].toLowerCase();
      if (word in FUNCTIONS) tokens.push({ type: 'function', value: word });
      else if (word in CONSTANTS) tokens.push({ type: 'number', value: CONSTANTS[word] });
      else throw new CommandError(`Unknown symbol "${word}" in the equation.`);
      index += match[0].length;
      continue;
    }
    if ('+-*/%^()'.includes(char)) {
      tokens.push({ type: char });
      index += 1;
      continue;
    }
    throw new CommandError(`Illegal character "${char}" in the equation.`);
  }
  return tokens;
}

export function evaluateEquation(expression) {
  const source = String(expression ?? '').trim();
  if (!source) throw new CommandError('Provide an equation to sever.');
  if (source.length > 200) throw new CommandError('The equation is too long.');
  const tokens = tokenize(source);
  if (!tokens.length) throw new CommandError('Provide an equation to sever.');
  let position = 0;

  const peek = () => tokens[position];
  const consume = (type) => {
    if (peek()?.type !== type) throw new CommandError('The equation is malformed.');
    return tokens[position++];
  };

  function parseExpression() {
    let value = parseTerm();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = tokens[position++].type;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parsePower();
    while (['*', '/', '%'].includes(peek()?.type)) {
      const operator = tokens[position++].type;
      const right = parsePower();
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new CommandError('Division by zero is not a curse the domain permits.');
      }
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  function parsePower() {
    const base = parseUnary();
    if (peek()?.type === '^') {
      position += 1;
      const exponent = parsePower();
      if (Math.abs(exponent) > 1000) throw new CommandError('That exponent is too volatile.');
      return base ** exponent;
    }
    return base;
  }

  function parseUnary() {
    if (peek()?.type === '+') {
      position += 1;
      return parseUnary();
    }
    if (peek()?.type === '-') {
      position += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new CommandError('The equation ends too soon.');
    if (token.type === 'number') {
      position += 1;
      return token.value;
    }
    if (token.type === 'function') {
      position += 1;
      consume('(');
      const argument = parseExpression();
      consume(')');
      return FUNCTIONS[token.value](argument);
    }
    if (token.type === '(') {
      position += 1;
      const value = parseExpression();
      consume(')');
      return value;
    }
    throw new CommandError('The equation is malformed.');
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new CommandError('The equation has trailing junk.');
  if (!Number.isFinite(result)) throw new CommandError('The result collapsed into infinity.');
  if (Math.abs(result) > 1e15) throw new CommandError('The result exceeds the domain’s measurable power.');

  return Number.parseFloat(result.toPrecision(12));
}
