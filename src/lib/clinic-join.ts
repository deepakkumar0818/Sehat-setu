// A clinic's own patient link (/join/<CODE>): patients who register through it
// join that clinic and book with its doctors only. The code is the clinic code
// the super admin chose when creating the clinic (2–10 letters or digits).

const CLINIC_CODE = /^[A-Z0-9]{2,10}$/;

/** The clinic code in a link or form, upper-cased, or null when it can't be one. */
export function normalizeClinicCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CLINIC_CODE.test(code) ? code : null;
}

export const joinClinicPath = (code: string) => `/join/${encodeURIComponent(code)}`;

export const registerForClinicPath = (code: string) => `/register?clinic=${encodeURIComponent(code)}`;
