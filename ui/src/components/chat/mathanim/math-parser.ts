/**
 * Safe math expression parser — no eval().
 * 
 * Supports: +, -, *, /, ^, unary minus
 * Functions: sin, cos, tan, asin, acos, atan, sqrt, abs, log, ln, exp, floor, ceil
 * Constants: pi, e
 * Variables: x, t (supplied at evaluation time)
 * Implicit multiplication: 2x → 2*x, 2(x) → 2*(x)
 */

type Vars = Record<string, number>;

// ── Tokenizer ────────────────────────────────────────────────────────────

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';

interface Token {
  type: TokenType;
  value: string;
}

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sqrt', 'abs', 'log', 'ln', 'exp', 'floor', 'ceil',
]);

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '');

  while (i < s.length) {
    const c = s[i];

    // Number (including decimals)
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) {
        num += s[i++];
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifier (function name, variable, constant)
    if (/[a-zA-Z_]/.test(c)) {
      let id = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        id += s[i++];
      }
      tokens.push({ type: 'ident', value: id });
      continue;
    }

    // Operators
    if ('+-*/^'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    // Parentheses
    if (c === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }

    // Skip unknown
    i++;
  }

  // Insert implicit multiplication tokens:
  // number followed by ident/lparen, ident followed by lparen (if not a function),
  // rparen followed by ident/number/lparen
  const result: Token[] = [];
  for (let j = 0; j < tokens.length; j++) {
    result.push(tokens[j]);
    if (j + 1 < tokens.length) {
      const cur = tokens[j];
      const next = tokens[j + 1];
      const needsMul =
        (cur.type === 'number' && (next.type === 'ident' || next.type === 'lparen')) ||
        (cur.type === 'rparen' && (next.type === 'number' || next.type === 'ident' || next.type === 'lparen')) ||
        (cur.type === 'ident' && !FUNCTIONS.has(cur.value) && next.type === 'lparen') ||
        (cur.type === 'ident' && !FUNCTIONS.has(cur.value) && next.type === 'number');
      if (needsMul) {
        result.push({ type: 'op', value: '*' });
      }
    }
  }

  return result;
}

// ── Recursive descent parser ─────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos: number;
  private vars: Vars;

  constructor(tokens: Token[], vars: Vars) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const t = this.consume();
    if (!t || t.type !== type) {
      throw new Error(`Expected ${type}, got ${t ? t.type : 'EOF'}`);
    }
    return t;
  }

  // Grammar:
  // expr     → term (('+' | '-') term)*
  // term     → power (('*' | '/') power)*
  // power    → unary ('^' power)?    (right-associative)
  // unary    → '-' unary | primary
  // primary  → number | variable | constant | function '(' expr (',' expr)* ')' | '(' expr ')'

  parse(): number {
    const result = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.pos].value}`);
    }
    return result;
  }

  private expr(): number {
    let left = this.term();
    while (this.peek()?.type === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.consume().value;
      const right = this.term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.power();
    while (this.peek()?.type === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.consume().value;
      const right = this.power();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    if (this.peek()?.type === 'op' && this.peek()!.value === '^') {
      this.consume();
      const exp = this.power(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  private unary(): number {
    if (this.peek()?.type === 'op' && this.peek()!.value === '-') {
      this.consume();
      return -this.unary();
    }
    if (this.peek()?.type === 'op' && this.peek()!.value === '+') {
      this.consume();
      return this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');

    // Number
    if (t.type === 'number') {
      this.consume();
      return parseFloat(t.value);
    }

    // Parenthesized expression
    if (t.type === 'lparen') {
      this.consume();
      const val = this.expr();
      this.expect('rparen');
      return val;
    }

    // Identifier: function, variable, or constant
    if (t.type === 'ident') {
      this.consume();
      const name = t.value;

      // Function call
      if (FUNCTIONS.has(name) && this.peek()?.type === 'lparen') {
        this.consume(); // '('
        const args: number[] = [this.expr()];
        while (this.peek()?.type === 'comma') {
          this.consume();
          args.push(this.expr());
        }
        this.expect('rparen');
        return this.callFunction(name, args);
      }

      // Constant
      if (name in CONSTANTS) return CONSTANTS[name];

      // Variable
      if (name in this.vars) return this.vars[name];

      throw new Error(`Unknown identifier: ${name}`);
    }

    throw new Error(`Unexpected token: ${t.value}`);
  }

  private callFunction(name: string, args: number[]): number {
    const a = args[0];
    switch (name) {
      case 'sin': return Math.sin(a);
      case 'cos': return Math.cos(a);
      case 'tan': return Math.tan(a);
      case 'asin': return Math.asin(a);
      case 'acos': return Math.acos(a);
      case 'atan': return Math.atan(a);
      case 'sqrt': return Math.sqrt(a);
      case 'abs': return Math.abs(a);
      case 'log': return Math.log10(a);
      case 'ln': return Math.log(a);
      case 'exp': return Math.exp(a);
      case 'floor': return Math.floor(a);
      case 'ceil': return Math.ceil(a);
      default: throw new Error(`Unknown function: ${name}`);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Parse and evaluate a math expression string with given variable values.
 * Safe — no eval(). Returns NaN for invalid expressions.
 */
export function evaluateExpression(expr: string, vars: Vars = {}): number {
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return 0;
    const parser = new Parser(tokens, vars);
    return parser.parse();
  } catch {
    return NaN;
  }
}

/**
 * Create a compiled function from an expression string.
 * Returns a function that takes variable values and returns the result.
 */
export function compileExpression(expr: string): (vars: Vars) => number {
  // Pre-tokenize once.  Parser only reads tokens via an index and never
  // mutates the array, so we can reuse it directly instead of copying.
  const rawTokens = tokenize(expr);
  return (vars: Vars) => {
    try {
      const parser = new Parser(rawTokens, vars);
      return parser.parse();
    } catch {
      return NaN;
    }
  };
}
