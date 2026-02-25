#!/usr/bin/env python3
"""
solver.py — Enhanced SymPy expression evaluator for poorman-alpha.

Supports two modes:
  1. One-shot:    python3 solver.py "expression" [--latex] [--all] [--steps]
  2. Persistent:  python3 solver.py --persistent
                  (reads JSON-line requests from stdin, writes JSON-line responses to stdout)

Enhancements:
  E-01: Uses restricted eval with allowlisted namespace (safer than raw eval)
  E-04: Persistent mode for process reuse
  E-07: LaTeX output format
  E-08: Step-by-step solution mode
  E-10: Plot generation (base64 PNG)
"""

import sys
import json
import io
import base64
import traceback


def create_namespace():
    """Create the allowlisted namespace for expression evaluation."""
    try:
        from sympy import (
            symbols, solve, simplify, expand, factor, diff, integrate,
            limit, series, summation, product as sym_product, sqrt, log, ln, exp,
            sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh,
            asinh, acosh, atanh,
            pi, E as euler_e, I, oo, zoo, nan as sym_nan,
            Rational, Matrix, Eq, Function, Piecewise,
            Symbol, Derivative, Integral, Sum, Product,
            Abs, ceiling, floor, sign, Mod,
            gcd, lcm, factorial, binomial, fibonacci,
            apart, together, cancel, collect, trigsimp, powsimp,
            ratsimp, radsimp, nsimplify,
            latex, pprint, pretty, N,
            dsolve, rsolve, solveset, linsolve, nonlinsolve,
            Interval, FiniteSet, Union, Intersection,
            ConditionSet, ImageSet,
            conjugate, re, im, arg,
            Poly, roots, degree,
            eye, zeros, ones, diag,
            det, trace,
            KroneckerDelta, LeviCivita,
            besselj, bessely, hankel1, hankel2,
            gamma as gamma_func, beta as beta_func, zeta,
            assoc_legendre, legendre, chebyshevt, chebyshevu,
            hermite, laguerre,
        )
        from sympy.parsing.sympy_parser import (
            parse_expr, standard_transformations, 
            implicit_multiplication_application,
            convert_xor
        )

        # Define commonly used symbols
        x, y, z, t, n, k, a, b, c, r, s, u, v, w = symbols('x y z t n k a b c r s u v w')
        f, g, h = Function('f'), Function('g'), Function('h')

        ns = {
            # Symbols
            'x': x, 'y': y, 'z': z, 't': t, 'n': n, 'k': k,
            'a': a, 'b': b, 'c': c, 'r': r, 's': s, 'u': u, 'v': v, 'w': w,
            'f': f, 'g': g, 'h': h,
            # Functions
            'solve': solve, 'simplify': simplify, 'expand': expand,
            'factor': factor, 'diff': diff, 'integrate': integrate,
            'limit': limit, 'series': series, 'summation': summation,
            'product': sym_product, 'sqrt': sqrt, 'log': log, 'ln': ln, 'exp': exp,
            'sin': sin, 'cos': cos, 'tan': tan,
            'asin': asin, 'acos': acos, 'atan': atan, 'atan2': atan2,
            'sinh': sinh, 'cosh': cosh, 'tanh': tanh,
            'asinh': asinh, 'acosh': acosh, 'atanh': atanh,
            'pi': pi, 'E': euler_e, 'I': I, 'oo': oo, 'zoo': zoo, 'nan': sym_nan,
            'Rational': Rational, 'Matrix': Matrix, 'Eq': Eq, 'Function': Function,
            'Piecewise': Piecewise,
            'Symbol': Symbol, 'symbols': symbols,
            'Derivative': Derivative, 'Integral': Integral,
            'Sum': Sum, 'Product': Product,
            'Abs': Abs, 'ceiling': ceiling, 'floor': floor, 'sign': sign, 'Mod': Mod,
            'gcd': gcd, 'lcm': lcm, 'factorial': factorial,
            'binomial': binomial, 'fibonacci': fibonacci,
            'apart': apart, 'together': together, 'cancel': cancel,
            'collect': collect, 'trigsimp': trigsimp, 'powsimp': powsimp,
            'ratsimp': ratsimp, 'radsimp': radsimp, 'nsimplify': nsimplify,
            'latex': latex, 'pprint': pprint, 'pretty': pretty, 'N': N,
            'dsolve': dsolve, 'rsolve': rsolve,
            'solveset': solveset, 'linsolve': linsolve, 'nonlinsolve': nonlinsolve,
            'Interval': Interval, 'FiniteSet': FiniteSet,
            'Union': Union, 'Intersection': Intersection,
            'conjugate': conjugate, 're': re, 'im': im, 'arg': arg,
            'Poly': Poly, 'roots': roots, 'degree': degree,
            'eye': eye, 'zeros': zeros, 'ones': ones, 'diag': diag,
            'det': det, 'trace': trace,
            'gamma': gamma_func, 'beta': beta_func, 'zeta': zeta,
            # Parsing
            'parse_expr': parse_expr,
        }
        return ns, parse_expr, (standard_transformations + (implicit_multiplication_application, convert_xor))
    except ImportError:
        return None, None, None


def evaluate_expression(expression, ns, parse_expr_fn, transformations):
    """Evaluate expression in the restricted namespace."""
    # Try parse_expr first (safer), fall back to eval in restricted namespace
    try:
        result = parse_expr(expression, local_dict=ns, transformations=transformations)
        # Force evaluation of callable results
        if hasattr(result, 'doit'):
            result = result.doit()
        return result
    except Exception:
        # Fall back to eval with restricted namespace
        result = eval(expression, {"__builtins__": {}}, ns)
        return result


def get_latex_output(result):
    """Get LaTeX representation of a result."""
    try:
        from sympy import latex as latex_fn
        return latex_fn(result)
    except Exception:
        return None


def get_steps(expression, ns, parse_expr_fn, transformations):
    """Attempt to generate step-by-step solution (E-08)."""
    steps = []
    try:
        from sympy import symbols, solve, diff, integrate, expand, factor, simplify

        # Detect operation type and generate steps
        expr_lower = expression.lower().strip()
        
        if expr_lower.startswith('solve('):
            steps.append(f"Step 1: Parse equation from: {expression}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Apply algebraic solving techniques")
            steps.append(f"Step 3: Solutions: {result}")

        elif expr_lower.startswith('integrate('):
            steps.append(f"Step 1: Identify the integrand from: {expression}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Apply integration rules")
            steps.append(f"Step 3: Result: {result}")

        elif expr_lower.startswith('diff('):
            steps.append(f"Step 1: Identify function to differentiate from: {expression}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Apply differentiation rules")
            steps.append(f"Step 3: Derivative: {result}")

        elif expr_lower.startswith('expand('):
            inner = expression[7:-1] if expression.endswith(')') else expression[7:]
            steps.append(f"Step 1: Parse expression: {inner}")
            original = evaluate_expression(inner, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Original form: {original}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 3: Expanded form: {result}")

        elif expr_lower.startswith('factor('):
            inner = expression[7:-1] if expression.endswith(')') else expression[7:]
            steps.append(f"Step 1: Parse expression: {inner}")
            original = evaluate_expression(inner, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Original form: {original}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 3: Factored form: {result}")

        elif expr_lower.startswith('simplify('):
            inner = expression[9:-1] if expression.endswith(')') else expression[9:]
            steps.append(f"Step 1: Parse expression: {inner}")
            original = evaluate_expression(inner, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Original form: {original}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 3: Simplified form: {result}")

        else:
            steps.append(f"Step 1: Evaluate expression: {expression}")
            result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
            steps.append(f"Step 2: Result: {result}")

    except Exception as e:
        steps.append(f"Error generating steps: {e}")

    return steps


def generate_plot(expression, ns, parse_expr_fn, transformations):
    """Generate a plot as base64 PNG (E-10)."""
    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt
        import numpy as np
        from sympy import lambdify, symbols

        x = symbols('x')
        
        # Parse the expression
        expr = evaluate_expression(expression, ns, parse_expr_fn, transformations)
        
        # Create numeric function
        f_numeric = lambdify(x, expr, modules=['numpy'])
        
        # Generate plot
        x_vals = np.linspace(-10, 10, 500)
        try:
            y_vals = f_numeric(x_vals)
        except Exception:
            x_vals = np.linspace(-5, 5, 500)
            y_vals = f_numeric(x_vals)

        fig, ax = plt.subplots(figsize=(8, 6))
        ax.plot(x_vals, y_vals, 'b-', linewidth=2)
        ax.set_xlabel('x')
        ax.set_ylabel('f(x)')
        ax.set_title(f'Plot of {expression}')
        ax.grid(True, alpha=0.3)
        ax.axhline(y=0, color='k', linewidth=0.5)
        ax.axvline(x=0, color='k', linewidth=0.5)
        
        # Limit y-axis to reasonable range
        y_finite = y_vals[np.isfinite(y_vals)]
        if len(y_finite) > 0:
            y_min, y_max = np.percentile(y_finite, [2, 98])
            margin = (y_max - y_min) * 0.1 or 1
            ax.set_ylim(y_min - margin, y_max + margin)

        # Save to base64
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        plt.close(fig)
        buf.seek(0)
        return 'data:image/png;base64,' + base64.b64encode(buf.read()).decode('utf-8')

    except ImportError:
        return None  # matplotlib not available
    except Exception as e:
        return None


def process_request(expression, output_format='text', want_steps=False, want_plot=False):
    """Process a single computation request."""
    ns, parse_expr_fn, transformations = create_namespace()
    if ns is None:
        return {'error': 'sympy is not installed. Run: pip3 install sympy'}

    try:
        result = evaluate_expression(expression, ns, parse_expr_fn, transformations)
        response = {'result': str(result)}

        # E-07: LaTeX output
        if output_format in ('latex', 'all'):
            response['latex'] = get_latex_output(result)

        # E-08: Step-by-step
        if want_steps:
            response['steps'] = get_steps(expression, ns, parse_expr_fn, transformations)

        # E-10: Plot
        if want_plot:
            plot_data = generate_plot(expression, ns, parse_expr_fn, transformations)
            if plot_data:
                response['plot'] = plot_data

        return response

    except Exception as e:
        return {'error': str(e)}


def run_oneshot():
    """One-shot mode: process a single expression from argv."""
    if len(sys.argv) < 2:
        print("Error: No expression provided.", file=sys.stderr)
        sys.exit(1)

    expression = sys.argv[1].strip()
    if not expression:
        print("Error: Empty expression.", file=sys.stderr)
        sys.exit(1)

    # Parse flags
    output_format = 'text'
    want_steps = False
    want_plot = False
    if '--latex' in sys.argv:
        output_format = 'latex'
    if '--all' in sys.argv:
        output_format = 'all'
    if '--steps' in sys.argv:
        want_steps = True
    if '--plot' in sys.argv:
        want_plot = True

    response = process_request(expression, output_format, want_steps, want_plot)

    if 'error' in response:
        print(f"Error: {response['error']}", file=sys.stderr)
        sys.exit(1)

    # If we have extra data (latex, steps, plot), output as JSON
    if any(k in response for k in ('latex', 'steps', 'plot')):
        print(json.dumps(response))
    else:
        print(response['result'])


def run_persistent():
    """Persistent mode (E-04): read JSON requests from stdin, write JSON responses to stdout."""
    # Signal readiness
    print(json.dumps({'status': 'ready'}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Handle exit command
        if request.get('command') == 'exit':
            break

        req_id = request.get('id', 0)
        expression = request.get('expression', '')
        output_format = request.get('format', 'text')
        want_steps = request.get('steps', False)
        want_plot = request.get('plot', False)

        if not expression:
            print(json.dumps({'id': req_id, 'error': 'Empty expression'}), flush=True)
            continue

        response = process_request(expression, output_format, want_steps, want_plot)
        response['id'] = req_id
        print(json.dumps(response), flush=True)


def main():
    if '--persistent' in sys.argv:
        run_persistent()
    else:
        run_oneshot()


if __name__ == '__main__':
    main()
