export function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}_${Date.now().toString(36)}`;
}

export function now() {
  return Date.now();
}

export function generatePrimeSignature() {
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];
  const count = 3 + Math.floor(Math.random() * 3);
  const sig = [];
  for (let i = 0; i < count; i++) {
    sig.push(primes[Math.floor(Math.random() * primes.length)]);
  }
  return sig;
}

export function generatePrimeFactors(text) {
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
  const hash = text.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xFFFF, 0);
  const factors = [];
  let remaining = hash || 1;
  for (const p of primes) {
    while (remaining % p === 0) {
      factors.push(p);
      remaining = Math.floor(remaining / p);
    }
    if (remaining <= 1) break;
  }
  if (factors.length === 0) factors.push(2);
  return factors;
}

export function computeEntropy(fragments) {
  if (fragments.length === 0) return 0;
  const total = fragments.reduce((s, f) => s + f.significance, 0) || 1;
  let entropy = 0;
  for (const f of fragments) {
    const p = f.significance / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function computeChecksum(fragments) {
  const data = fragments.map(f => f.id + f.content).join('|');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash.toString(16);
}
