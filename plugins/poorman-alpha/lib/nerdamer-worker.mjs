import { parentPort } from 'worker_threads';
import nerdamer from 'nerdamer';
import 'nerdamer/Algebra.js';
import 'nerdamer/Calculus.js';
import 'nerdamer/Solve.js';

parentPort.on('message', ({ expression, format }) => {
  try {
    const result = nerdamer(expression);
    const response = { result: result.toString() };

    if (format === 'latex' || format === 'all') {
      try {
        response.latex = result.toTeX();
      } catch (_e) {
        response.latex = null;
      }
    }

    parentPort.postMessage(response);
  } catch (err) {
    parentPort.postMessage({ error: err.message || String(err) });
  }
});
