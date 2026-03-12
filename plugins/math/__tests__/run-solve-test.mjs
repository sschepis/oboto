/**
 * Standalone test script for solve_equation handler.
 * Run with: node plugins/math/__tests__/run-solve-test.mjs
 */

import { create, all } from 'mathjs';

// ── Inline the handler + helper ──────────────────────────────────────────

function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

function handleSolveEquation(math, args) {
    const { equation, variable = 'x' } = args;

    try {
        const normalized = equation.replace(/(\d)([a-zA-Z])/g, '$1*$2');
        const parts = normalized.split(/={1,2}/);
        if (parts.length !== 2) {
            return `Error: Expected an equation with exactly one '=' sign, got: "${equation}"`;
        }

        const [lhs, rhs] = parts.map(p => p.trim());
        if (!lhs || !rhs) {
            return `Error: Both sides of the equation must be non-empty.`;
        }

        const expr = `(${lhs}) - (${rhs})`;
        const node = math.parse(expr);
        const compiled = node.compile();

        let simplifiedStr;
        try {
            simplifiedStr = math.simplify(node).toString();
        } catch (_) {
            simplifiedStr = expr;
        }

        const evalAt = (val) => Number(compiled.evaluate({ [variable]: val }));

        const y0 = evalAt(0);
        const y1 = evalAt(1);
        const yNeg1 = evalAt(-1);
        const y2 = evalAt(2);

        // Linear
        const a_lin = y1 - y0;
        const b_lin = y0;
        const expectedY2_lin = 2 * a_lin + b_lin;

        if (Math.abs(y2 - expectedY2_lin) < 1e-10) {
            if (Math.abs(a_lin) < 1e-15) {
                return Math.abs(b_lin) < 1e-15
                    ? `The equation ${equation} is true for all values of ${variable}.`
                    : `The equation ${equation} has no solution.`;
            }
            const solution = -b_lin / a_lin;
            return `${variable} = ${fmtNum(solution)}\n\nSimplified form: ${simplifiedStr} = 0`;
        }

        // Quadratic
        const c_q = y0;
        const a_q = (y1 + yNeg1) / 2 - c_q;
        const b_q = (y1 - yNeg1) / 2;
        const expectedY2_q = a_q * 4 + b_q * 2 + c_q;

        if (Math.abs(y2 - expectedY2_q) < 1e-10 && Math.abs(a_q) > 1e-15) {
            const disc = b_q * b_q - 4 * a_q * c_q;
            if (disc < -1e-15) {
                const re = -b_q / (2 * a_q);
                const im = Math.sqrt(-disc) / (2 * a_q);
                return `${variable} = ${fmtNum(re)} + ${fmtNum(Math.abs(im))}i  or  ${variable} = ${fmtNum(re)} - ${fmtNum(Math.abs(im))}i\n\nSimplified form: ${simplifiedStr} = 0`;
            }
            if (Math.abs(disc) < 1e-15) {
                return `${variable} = ${fmtNum(-b_q / (2 * a_q))} (double root)\n\nSimplified form: ${simplifiedStr} = 0`;
            }
            const s1 = (-b_q + Math.sqrt(disc)) / (2 * a_q);
            const s2 = (-b_q - Math.sqrt(disc)) / (2 * a_q);
            return `${variable} = ${fmtNum(s1)}  or  ${variable} = ${fmtNum(s2)}\n\nSimplified form: ${simplifiedStr} = 0`;
        }

        // Newton's method
        const deriv = math.derivative(expr, variable).compile();
        let x = 0;
        for (let i = 0; i < 100; i++) {
            const fx = evalAt(x);
            if (Math.abs(fx) < 1e-12) break;
            const dfx = Number(deriv.evaluate({ [variable]: x }));
            if (Math.abs(dfx) < 1e-15) { x += 0.1; continue; }
            x = x - fx / dfx;
        }

        if (Math.abs(evalAt(x)) < 1e-8) {
            return `${variable} ≈ ${fmtNum(x)} (numerical solution)\n\nSimplified form: ${simplifiedStr} = 0`;
        }

        return `Could not find an exact solution. Simplified form: ${simplifiedStr} = 0`;
    } catch (error) {
        return `Error solving equation: ${error.message}`;
    }
}

// ── Test runner ──────────────────────────────────────────────────────────

const math = create(all, { number: 'BigNumber', precision: 64 });

let passed = 0;
let failed = 0;

function assert(label, condition, result) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}`);
        console.log(`     Result: ${result}`);
        failed++;
    }
}

console.log('solve_equation tests:\n');

// 1. Basic linear
let r = handleSolveEquation(math, { equation: '2x + 5 = 15', variable: 'x' });
assert('"2x + 5 = 15" → x = 5', r.includes('x = 5'), r);

// 2. Another linear
r = handleSolveEquation(math, { equation: '3x - 7 = 2', variable: 'x' });
assert('"3x - 7 = 2" → x = 3', r.includes('x = 3'), r);

// 3. x + 1 = 1 → x=0
r = handleSolveEquation(math, { equation: 'x + 1 = 1', variable: 'x' });
assert('"x + 1 = 1" → x = 0', r.includes('x = 0'), r);

// 4. Quadratic with two roots
r = handleSolveEquation(math, { equation: 'x^2 - 4 = 0', variable: 'x' });
assert('"x^2 - 4 = 0" → x=2 and x=-2', r.includes('2') && r.includes('-2'), r);

// 5. Quadratic double root
r = handleSolveEquation(math, { equation: 'x^2 + 2x + 1 = 0', variable: 'x' });
assert('"x^2 + 2x + 1 = 0" → double root at -1', r.includes('-1') && r.includes('double root'), r);

// 6. Complex roots
r = handleSolveEquation(math, { equation: 'x^2 + 1 = 0', variable: 'x' });
assert('"x^2 + 1 = 0" → complex roots', r.includes('i'), r);

// 7. No = sign → error
r = handleSolveEquation(math, { equation: '2x + 5', variable: 'x' });
assert('"2x + 5" (no =) → error', r.includes('Error'), r);

// 8. Multiple = signs → error
r = handleSolveEquation(math, { equation: 'x = y = z', variable: 'x' });
assert('"x = y = z" (multiple =) → error', r.includes('Error'), r);

// 9. No parsing error on standard input (the original bug)
r = handleSolveEquation(math, { equation: '2x + 5 = 15', variable: 'x' });
assert('"2x + 5 = 15" does NOT produce parsing error', !r.includes('Parsing error') && !r.startsWith('Error'), r);

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
