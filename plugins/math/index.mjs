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

// ── Math environment setup ───────────────────────────────────────────────

/**
 * Create a configured mathjs instance with BigNumber precision and
 * common unit aliases.
 */
function createMathEnvironment() {
    const math = create(all, {
        number: 'BigNumber',
        precision: 64
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

function handleEvaluateMath(math, scope, args) {
    const { expression, scope: userScope = {} } = args;

    try {
        const result = math.evaluate(expression, { ...scope, ...userScope });

        let formattedResult;
        if (math.isMatrix(result) || Array.isArray(result)) {
            formattedResult = math.format(result, { precision: 14 });
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
    const { equation, variable } = args;

    try {
        // mathjs doesn't have a built-in algebraic solver like sympy.
        // Parse the equation to validate it, then return guidance.
        math.parse(equation);

        return "Note: Symbolic equation solving is limited in this local environment. " +
            "Please use 'evaluate_math' for derivatives, integrals, or simplification. " +
            'Example: evaluate_math(expression: \'derivative("x^2", "x")\')';
    } catch (error) {
        return `Error solving equation: ${error.message}`;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const math = createMathEnvironment();
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
        handler: (args) => handleEvaluateMath(math, scope, args)
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
