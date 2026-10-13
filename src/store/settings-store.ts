import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface ClinicSettings {
  clinicName: string;
  supportEmail: string;
  defaultSlotMinutes: number;
  allowOnlineBooking: boolean;
  allowWalkIns: boolean;
  taxRatePercent: number;
  onlinePaymentsEnabled: boolean;
  prescriptionAiSafetyReview: boolean;
  requireDoctorSignature: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  aiFeaturesEnabled: boolean;
  aiAutoSummaries: boolean;
  twoFactorRequired: boolean;
  sessionTimeoutMinutes: number;
}

interface SettingsStoreState extends ClinicSettings {
  updateSettings: (patch: Partial<ClinicSettings>) => void;
}

const defaults: ClinicSettings = {
  clinicName: "Sehat Setu",
  supportEmail: "support@sehatsetu.demo",
  defaultSlotMinutes: 30,
  allowOnlineBooking: true,
  allowWalkIns: true,
  taxRatePercent: 5,
  onlinePaymentsEnabled: true,
  prescriptionAiSafetyReview: true,
  requireDoctorSignature: true,
  emailNotifications: true,
  smsNotifications: false,
  aiFeaturesEnabled: true,
  aiAutoSummaries: false,
  twoFactorRequired: false,
  sessionTimeoutMinutes: 30,
};

const safeStorage = createJSONStorage<ClinicSettings>(() => ({
  getItem: (name) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  setItem: (name, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(name);
  },
}));

export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set) => ({
      ...defaults,
      updateSettings: (patch) => set(patch),
    }),
    { name: "sehat-setu-settings", storage: safeStorage }
  )
);
