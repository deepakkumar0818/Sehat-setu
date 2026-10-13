function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic (never Math.random) "review count" for a doctor, so server and client render the same number and it's stable across page loads. */
export function demoReviewCount(doctorId: string): number {
  return 40 + (hashString(doctorId) % 220); // 40–259 demo reviews
}

/** Deterministic "lifetime consultations" figure for a doctor's public profile/card. */
export function demoConsultationCount(doctorId: string): number {
  return 180 + (hashString(`consultations:${doctorId}`) % 2400); // 180–2579
}
