/**
 * Oboto Math Plugin
 *
 * Provides mathematical evaluation, unit conversion, and equation solving
 * via the mathjs library.
 * Extracted from src/execution/handlers/math-handlers.mjs and
 * src/tools/definitions/math-tools.mjs.
 *
 * @module @oboto/plugin-math
 */

import { create, all } from 'mathjs';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    precision: 64,
    displayPrecision: 14,
    angleUnit: 'rad',
};

const SETTINGS_SCHEMA = [
    {
        key: 'precision',
        label: 'BigNumber Precision',
        type: 'number',
        description: 'Internal BigNumber precision (number of significant digits).',
        default: 64,
        min: 1,
        max: 256,
    },
    {
        key: 'displayPrecision',
        label: 'Display Precision',
        type: 'number',
        description: 'Number of significant digits shown in formatted results.',
        default: 14,
        min: 1,
        max: 50,
    },
    {
        key: 'angleUnit',
        label: 'Angle Unit',
        type: 'select',
        description: 'Default angle unit for trigonometric functions.',
        default: 'rad',
        options: [
            { value: 'rad', label: 'Radians' },
            { value: 'deg', label: 'Degrees' },
        ],
    },
];

// ── Math environment setup ───────────────────────────────────────────────

/**
 * Create a configured mathjs instance with BigNumber precision and
 * common unit aliases.
 */
function createMathEnvironment(settings = {}) {
    const math = create(all, {
        number: 'BigNumber',
        precision: settings.precision || 64,
    });

    return math;
}

/**
 * Map common unit abbreviations to mathjs-compatible names.
 * mathjs uses SI-style names (e.g. "degC" not "C" for Celsius).
 */
const UNIT_ALIASES = {
    // Temperature
    'C':          'degC',
    'c':          'degC',
    'celsius':    'degC',
    'Celsius':    'degC',
    'F':          'degF',
    'f':          'degF',
    'fahrenheit': 'degF',
    'Fahrenheit': 'degF',
    // Length
    'miles':      'mile',
    'yards':      'yard',
    'feet':       'foot',
    'inches':     'inch',
    'meters':     'meter',
    'metres':     'meter',
    'kilometers': 'km',
    'kilometres': 'km',
    'centimeters':'cm',
    'centimetres':'cm',
    'millimeters':'mm',
    'millimetres':'mm',
    // Mass
    'pounds':     'lbs',
    'ounces':     'oz',
    'kilograms':  'kg',
    'grams':      'g',
    // Volume
    'liters':     'liter',
    'litres':     'liter',
    'gallons':    'gallon',
};

/**
 * Normalize a unit string by resolving common aliases to
 * the canonical name that mathjs recognises.
 */
function normalizeUnit(unit) {
    const trimmed = unit.trim();
    return UNIT_ALIASES[trimmed] ?? trimmed;
}

// ── Tool Handlers ────────────────────────────────────────────────────────

function handleEvaluateMath(math, scope, args, settings = {}) {
    const { expression, scope: userScope = {} } = args;
    const displayPrecision = settings.displayPrecision || 14;

    try {
        const result = math.evaluate(expression, { ...scope, ...userScope });

        let formattedResult;
        if (math.isMatrix(result) || Array.isArray(result)) {
            formattedResult = math.format(result, { precision: displayPrecision });
        } else if (typeof result === 'object' && result.toString) {
            formattedResult = result.toString();
        } else {
            formattedResult = String(result);
        }

        return formattedResult;
    } catch (error) {
        return `Error evaluating expression: ${error.message}`;
    }
}

function handleUnitConversion(math, args) {
    const { value, from_unit, to_unit } = args;
    const srcUnit = normalizeUnit(from_unit);
    const dstUnit = normalizeUnit(to_unit);

    try {
        const result = math.unit(value, srcUnit).to(dstUnit);
        return result.toString();
    } catch (error) {
        return `Error converting units: ${error.message}`;
    }
}

function handleSolveEquation(math, args) {
    const { equation, variable = 'x' } = args;

    try {
        // Normalize implicit multiplication (e.g., "2x" → "2*x", "3xy" → "3*x*y")
        const normalized = equation.replace(/(\d)([a-zA-Z])/g, '$1*$2');

        // Split on '=' (or '==') to get LHS and RHS
        const parts = normalized.split(/={1,2}/);
        if (parts.length !== 2) {
            return `Error: Expected an equation with exactly one '=' sign, got: "${equation}"`;
        }

        const [lhs, rhs] = parts.map(p => p.trim());
        if (!lhs || !rhs) {
            return `Error: Both sides of the equation must be non-empty.`;
        }

        // Form the expression f(var) = lhs - rhs = 0
        const expr = `(${lhs}) - (${rhs})`;

        const node = math.parse(expr);
        const compiled = node.compile();

        let simplifiedStr;
        try {
            simplifiedStr = math.simplify(node).toString();
        } catch (_) {
            simplifiedStr = expr;
        }

        // Evaluate f at a few points to classify the equation
        const evalAt = (val) => Number(compiled.evaluate({ [variable]: val }));

        const y0 = evalAt(0);
        const y1 = evalAt(1);
        const yNeg1 = evalAt(-1);
        const y2 = evalAt(2);

        // --- Linear: f(x) = a*x + b ---
        const a_lin = y1 - y0;          // slope
        const b_lin = y0;               // intercept
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

        // --- Quadratic: f(x) = a*x² + b*x + c ---
        // From f(0)=c, f(1)=a+b+c, f(-1)=a-b+c
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

        // --- Higher-order: Newton's method ---
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

/** Format a number: integers stay as-is, floats trimmed of trailing zeros. */
function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const { pluginSettings } = await registerSettingsHandlers(
        api, 'math', DEFAULT_SETTINGS, SETTINGS_SCHEMA
    );

    const math = createMathEnvironment(pluginSettings);
    const scope = {};

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'evaluate_math',
        description: 'Evaluate a mathematical expression using a powerful math engine (supports arithmetic, algebra, calculus, matrices, etc.).',
        parameters: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: 'The mathematical expression to evaluate (e.g., \'sqrt(16)\', \'det([[-1, 2], [3, 1]])\', \'derivative("x^2", "x")\')'
                },
                scope: {
                    type: 'object',
                    description: 'Optional variables to include in the evaluation scope (e.g., {x: 2})'
                }
            },
            required: ['expression']
        },
        handler: (args) => handleEvaluateMath(math, scope, args, pluginSettings)
    });

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'unit_conversion',
        description: 'Convert values between different units of measurement.',
        parameters: {
            type: 'object',
            properties: {
                value: {
                    type: 'number',
                    description: 'The numerical value to convert'
                },
                from_unit: {
                    type: 'string',
                    description: "The unit to convert from (e.g., 'inch', 'kg', 'degF')"
                },
                to_unit: {
                    type: 'string',
                    description: "The unit to convert to (e.g., 'cm', 'lbs', 'degC')"
                }
            },
            required: ['value', 'from_unit', 'to_unit']
        },
        handler: (args) => handleUnitConversion(math, args)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'solve_equation',
        description: 'Solve an algebraic equation for a variable.',
        parameters: {
            type: 'object',
            properties: {
                equation: {
                    type: 'string',
                    description: "The equation to solve (e.g., '2x + 5 = 15')"
                },
                variable: {
                    type: 'string',
                    description: "The variable to solve for (e.g., 'x')"
                }
            },
            required: ['equation', 'variable']
        },
        handler: (args) => handleSolveEquation(math, args)
    });
}

export async function deactivate(_api) {
    // Cleanup handled automatically by PluginAPI._cleanup()
}
