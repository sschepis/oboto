export const MATH_TOOLS = [
    {
        type: "function",
        function: {
            name: "evaluate_math",
            description: "Evaluate a mathematical expression using a powerful math engine (supports arithmetic, algebra, calculus, matrices, etc.).",
            parameters: {
                type: "object",
                properties: {
                    expression: {
                        type: "string",
                        description: "The mathematical expression to evaluate (e.g., 'sqrt(16)', 'det([[-1, 2], [3, 1]])', 'derivative(\"x^2\", \"x\")')"
                    },
                    scope: {
                        type: "object",
                        description: "Optional variables to include in the evaluation scope (e.g., {x: 2})"
                    }
                },
                required: ["expression"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "unit_conversion",
            description: "Convert values between different units of measurement.",
            parameters: {
                type: "object",
                properties: {
                    value: {
                        type: "number",
                        description: "The numerical value to convert"
                    },
                    from_unit: {
                        type: "string",
                        description: "The unit to convert from (e.g., 'inch', 'kg', 'degF')"
                    },
                    to_unit: {
                        type: "string",
                        description: "The unit to convert to (e.g., 'cm', 'lbs', 'degC')"
                    }
                },
                required: ["value", "from_unit", "to_unit"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "solve_equation",
            description: "Solve an algebraic equation for a variable.",
            parameters: {
                type: "object",
                properties: {
                    equation: {
                        type: "string",
                        description: "The equation to solve (e.g., '2x + 5 = 15')"
                    },
                    variable: {
                        type: "string",
                        description: "The variable to solve for (e.g., 'x')"
                    }
                },
                required: ["equation", "variable"]
            }
        }
    }
];
