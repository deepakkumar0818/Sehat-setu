import { create } from "zustand";

interface UiStoreState {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  activeBranchId: string | null;
  setActiveBranchId: (branchId: string | null) => void;
  pendingAiQuestion: string | null;
  setPendingAiQuestion: (question: string | null) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  activeBranchId: null,
  setActiveBranchId: (branchId) => set({ activeBranchId: branchId }),
  pendingAiQuestion: null,
  setPendingAiQuestion: (question) => set({ pendingAiQuestion: question }),
}));
