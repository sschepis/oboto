export class HolographicProjection {
  project(text, gridSize = 16) {
    const intensity = new Array(gridSize * gridSize).fill(0);
    const phase = new Array(gridSize * gridSize).fill(0);

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const gridIdx = (code * 7 + i * 13) % (gridSize * gridSize);
      intensity[gridIdx] += code / 255;
      phase[gridIdx] = (phase[gridIdx] + (code * Math.PI / 128)) % (2 * Math.PI);
    }

    const maxI = Math.max(...intensity, 1);
    for (let i = 0; i < intensity.length; i++) {
      intensity[i] /= maxI;
    }

    return { gridSize, field: { intensity, phase } };
  }

  reconstruct(pattern) {
    const { gridSize, field } = pattern;
    const amplitudes = [];
    const phases = [];

    for (let i = 0; i < gridSize * gridSize; i++) {
      amplitudes.push(field.intensity[i] || 0);
      phases.push(field.phase[i] || 0);
    }

    return { amplitudes, phases };
  }

  similarity(fragment1, fragment2) {
    const p1 = this.project(fragment1, 8);
    const p2 = this.project(fragment2, 8);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    const correlationPattern = [];

    for (let i = 0; i < p1.field.intensity.length; i++) {
      const v1 = p1.field.intensity[i];
      const v2 = p2.field.intensity[i];
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
      correlationPattern.push(v1 * v2);
    }

    const sim = norm1 > 0 && norm2 > 0 ? dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2)) : 0;

    return { similarity: sim, correlationPattern };
  }
}
