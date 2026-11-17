import { create } from 'zustand';

type PrayerTimerState = {
  startedAt: number | null;
  start: () => void;
  stop: () => void;
};

/** In-memory quiet-time timer. Leaving the screen does not clear a running session. */
export const usePrayerTimer = create<PrayerTimerState>((set) => ({
  startedAt: null,
  start: () => set({ startedAt: Date.now() }),
  stop: () => set({ startedAt: null }),
}));
