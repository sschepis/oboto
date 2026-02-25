/**
 * router.js — Smart input routing for poorman-alpha.
 * Enhancement E-06: Multi-signal classifier replaces naive regex heuristic.
 */

// Known nerdamer function names that should route to symbolic engine
const NERDAMER_FUNCTIONS = new Set([
  'solve', 'expand', 'factor', 'simplify', 'diff', 'integrate',
  'sum', 'product', 'limit', 'log', 'sqrt', 'abs', 'sin', 'cos',
  'tan', 'asin', 'acos', 'atan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'GCD', 'LCM', 'pfactor', 'roots', 'nthroot',
  'vecget', 'matget', 'imatrix', 'transpose', 'invert',
  'determinant', 'size', 'dot', 'cross',
]);

// Mathjs unit names (most common)
const MATHJS_UNITS = new Set([
  // Length
  'meter', 'meters', 'm', 'km', 'kilometer', 'kilometers',
  'cm', 'centimeter', 'centimeters', 'mm', 'millimeter', 'millimeters',
  'inch', 'inches', 'in', 'foot', 'feet', 'ft', 'yard', 'yards', 'yd',
  'mile', 'miles', 'mi', 'nauticalMile',
  // Mass
  'gram', 'grams', 'g', 'kg', 'kilogram', 'kilograms',
  'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces',
  'ton', 'tons', 'tonne', 'tonnes',
  // Temperature
  'celsius', 'fahrenheit', 'kelvin', 'degC', 'degF', 'K',
  // Time
  'second', 'seconds', 's', 'minute', 'minutes', 'min',
  'hour', 'hours', 'h', 'day', 'days', 'week', 'weeks',
  'month', 'months', 'year', 'years',
  // Volume
  'liter', 'liters', 'l', 'L', 'ml', 'milliliter', 'milliliters',
  'gallon', 'gallons', 'gal', 'quart', 'quarts', 'qt',
  'pint', 'pints', 'cup', 'cups', 'fluidounce',
  // Speed
  'mph', 'kph', 'knot', 'knots',
  // Energy
  'joule', 'joules', 'J', 'kJ', 'calorie', 'calories', 'cal', 'kcal',
  'watt', 'watts', 'W', 'kW', 'kilowatt', 'kilowatts',
  'horsepower', 'hp',
  // Pressure
  'pascal', 'Pa', 'kPa', 'bar', 'atm', 'psi', 'mmHg',
  // Area
  'acre', 'acres', 'hectare', 'hectares',
]);

// Single-letter symbolic variables
const SYMBOLIC_VARS = /\b[a-z]\b/;

// Unit conversion pattern (more precise than before)
const UNIT_CONVERSION_RE = /^\s*[\d.]+\s+\w+\s+to\s+\w+\s*$/i;

/**
 * Route classification result.
 * @typedef {'unit_conversion' | 'symbolic' | 'arithmetic' | 'unknown'} RouteType
 */

/**
 * Classify an expression and determine optimal routing.
 *
 * @param {string} expression - The sanitized expression
 * @returns {{ route: RouteType, confidence: number, signals: string[] }}
 */
function classifyExpression(expression) {
  const signals = [];
  let unitScore = 0;
  let symbolicScore = 0;
  let arithmeticScore = 0;

  // Signal 1: Unit conversion pattern ("5 meters to feet")
  if (UNIT_CONVERSION_RE.test(expression)) {
    unitScore += 5;
    signals.push('unit_conversion_pattern');
  }

  // Signal 2: Contains " to " (weaker signal)
  if (/\s+to\s+/i.test(expression) && !UNIT_CONVERSION_RE.test(expression)) {
    unitScore += 2;
    signals.push('contains_to');
  }

  // Signal 3: Contains known unit names
  const words = expression.toLowerCase().split(/\s+/);
  const unitWords = words.filter(w => MATHJS_UNITS.has(w));
  if (unitWords.length > 0) {
    unitScore += unitWords.length * 2;
    signals.push(`unit_words:${unitWords.join(',')}`);
  }

  // Signal 4: Contains nerdamer function calls
  for (const func of NERDAMER_FUNCTIONS) {
    const re = new RegExp(`\\b${func}\\s*\\(`, 'i');
    if (re.test(expression)) {
      symbolicScore += 5;
      signals.push(`nerdamer_func:${func}`);
    }
  }

  // Signal 5: Contains symbolic variables
  if (SYMBOLIC_VARS.test(expression)) {
    // Check it's not just a unit abbreviation
    const varMatches = expression.match(/\b[a-z]\b/g) || [];
    const nonUnitVars = varMatches.filter(v => !MATHJS_UNITS.has(v));
    if (nonUnitVars.length > 0) {
      symbolicScore += nonUnitVars.length;
      signals.push(`symbolic_vars:${nonUnitVars.join(',')}`);
    }
  }

  // Signal 6: Contains = (equation)
  if (/=/.test(expression) && !/==/.test(expression)) {
    symbolicScore += 3;
    signals.push('equation');
  }

  // Signal 7: Contains ^ (exponentiation, more common in symbolic)
  if (/\^/.test(expression)) {
    symbolicScore += 1;
    signals.push('exponentiation');
  }

  // Signal 8: Pure numeric expression (no variables, no units)
  if (/^[\d\s+\-*/().%]+$/.test(expression)) {
    arithmeticScore += 5;
    signals.push('pure_numeric');
  }

  // Determine route
  const maxScore = Math.max(unitScore, symbolicScore, arithmeticScore);
  let route = 'unknown';
  if (maxScore === 0) {
    route = 'symbolic'; // default to symbolic for unclassified
  } else if (unitScore === maxScore && unitScore > symbolicScore) {
    route = 'unit_conversion';
  } else if (symbolicScore === maxScore) {
    route = 'symbolic';
  } else if (arithmeticScore === maxScore) {
    route = 'arithmetic';
  }

  const total = unitScore + symbolicScore + arithmeticScore;
  const confidence = total > 0 ? maxScore / total : 0;

  return { route, confidence, signals };
}

export { classifyExpression, NERDAMER_FUNCTIONS, MATHJS_UNITS };
