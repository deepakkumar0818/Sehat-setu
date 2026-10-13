// Deterministic pseudo-random generator so demo data is stable within a
// session but can be reseeded on demand ("Reset demo data").

export function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private random: () => number;

  constructor(seed: number) {
    this.random = mulberry32(seed);
  }

  next(): number {
    return this.random();
  }

  int(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  float(min: number, max: number, decimals = 1): number {
    const value = this.random() * (max - min) + min;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  bool(probabilityTrue = 0.5): boolean {
    return this.random() < probabilityTrue;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  pickMany<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const result: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = this.int(0, pool.length - 1);
      result.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return result;
  }

  weighted<T>(entries: [T, number][]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.random() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** Random date offset from `base` by [minDays, maxDays] (negative = past). */
  dateOffset(base: Date, minDays: number, maxDays: number): Date {
    const days = this.int(minDays, maxDays);
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  }
}

export function padId(prefix: string, n: number, width = 5): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}
