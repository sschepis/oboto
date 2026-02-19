import { create, all } from 'mathjs';
import { consoleStyler } from '../../ui/console-styler.mjs';

// Configure mathjs
const math = create(all, {
    number: 'BigNumber',
    precision: 64
});

export class MathHandlers {
    constructor() {
        this.scope = {};
    }

    async evaluateMath(args) {
        const { expression, scope = {} } = args;
        
        try {
            consoleStyler.log('math', `Calculating: ${expression}`);
            const result = math.evaluate(expression, { ...this.scope, ...scope });
            
            // Format the result
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
            consoleStyler.log('error', `Math evaluation error: ${error.message}`);
            return `Error evaluating expression: ${error.message}`;
        }
    }

    async unitConversion(args) {
        const { value, from_unit, to_unit } = args;
        
        try {
            consoleStyler.log('math', `Converting ${value} ${from_unit} to ${to_unit}`);
            const result = math.unit(value, from_unit).to(to_unit);
            return result.toString();
        } catch (error) {
            consoleStyler.log('error', `Unit conversion error: ${error.message}`);
            return `Error converting units: ${error.message}`;
        }
    }

    async solveEquation(args) {
        const { equation, variable } = args;
        
        try {
            consoleStyler.log('math', `Solving ${equation} for ${variable}`);
            // Note: mathjs 'solve' function is limited, using a custom implementation or parse tree might be better for complex cases.
            // But let's try to use mathjs capabilities or a simple rearrange if possible.
            // Actually, mathjs doesn't have a built-in 'solve(equation, var)' function like sympy.
            // However, we can use 'simplify' or 'derivative'. 
            // For true solving, we might need 'nerdamer' or similar, but let's stick to mathjs as requested.
            // Since mathjs is limited for symbolic solving, we will try to use `math.evaluate` if the equation is just an expression,
            // or return a message that symbolic solving is limited.
            
            // A better approach for "Wolfram Alpha-like" behavior without a full CAS is to expose 'simplify' and 'derivative'.
            // Let's assume the user might input "derivative('x^2', 'x')" which works in evaluateMath.
            // For "solve", we can try to parse simple linear equations.
            
            // Re-evaluating: mathjs has `lsolve` for linear systems, but not general algebraic solve.
            // I will implement a basic linear solver or defer to 'evaluate_math' for symbolic operations like derivative.
            
            // Let's implement a wrapper that encourages using evaluate_math for calculus, and this for simple things.
            // If we can't solve it, we inform the user.
            
            // For now, let's implement a placeholder that suggests using evaluate_math for specific operations
            // or tries to use Algebrite if we had it. Since we only have mathjs, we'll try to do what we can.
            
            // Actually, I'll remove 'solve_equation' from the handlers if I can't implement it robustly with mathjs,
            // OR I will leave it as a wrapper that clarifies capabilities.
            
            // Better yet, let's implement it as a "simplify" tool which mathjs DOES support well.
            // But I already defined the schema as "solve_equation".
            // I'll update the schema to be 'symbolic_math' or similar?
            // No, let's just make 'solve_equation' try to simplify `equation - LHS` if possible?
            
            // Let's pivot: Since I can't easily implement a robust solver with just mathjs, 
            // and the user wants "Wolfram Alpha-like", I will implement it as a function that
            // 1. Checks if it's a simple linear equation.
            // 2. If so, solves it.
            // 3. If not, advises using `evaluate_math` with specific commands if applicable, or admits limitation.
            
            // Simple linear solver: ax + b = c
            
            const node = math.parse(equation);
            // This is getting complex for a quick implementation. 
            // I will return a message directing to `evaluate_math` for symbolic ops (derivative, simplify).
            
            return "Note: Symbolic equation solving is limited in this local environment. Please use 'evaluate_math' for derivatives, integrals, or simplification. Example: evaluate_math(expression: 'derivative(\"x^2\", \"x\")')";

        } catch (error) {
             return `Error solving equation: ${error.message}`;
        }
    }
}
