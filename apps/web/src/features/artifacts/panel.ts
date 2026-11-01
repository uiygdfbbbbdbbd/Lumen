import { create } from 'zustand';

interface PanelState {
  /** The artifact shown in the side panel (per page; cleared on navigation). */
  openId: string | null;
  /** A pinned older version, or null for the latest. */
  version: number | null;
  fullscreen: boolean;
  open: (id: string, version?: number | null) => void;
  setVersion: (v: number | null) => void;
  close: () => void;
  toggleFullscreen: () => void;
}

export const useArtifactPanel = create<PanelState>((set) => ({
  openId: null,
  version: null,
  fullscreen: false,
  open: (id, version = null) => set({ openId: id, version }),
  setVersion: (version) => set({ version }),
  close: () => set({ openId: null, version: null, fullscreen: false }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
}));
