import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import type { PrayerRoom } from '@/types';

interface LiveRoomsState {
  rooms: PrayerRoom[];
  isLoading: boolean;
}

const LiveRoomsContext = createContext<LiveRoomsState>({ rooms: [], isLoading: true });

export function LiveRoomsProvider({ children }: { children: React.ReactNode }) {
  const [rooms, setRooms] = useState<PrayerRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.PRAYER_ROOMS),
      where('is_active', '==', true),
      // Keep participant-scoped private prayer calls out of this public feed.
      where('room_type', '!=', 'matched_prayer_call'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: PrayerRoom[] = snap.docs
          .map((d) => ({
            ...d.data(),
            room_id: d.id,
          }) as PrayerRoom)
          .filter((r) => r.room_type !== 'voice_link' && r.room_type !== 'matched_prayer_call');
        data.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        setRooms(data);
        setIsLoading(false);
      },
      () => {
        setRooms([]);
        setIsLoading(false);
      },
    );
    return unsub;
  }, []);

  const value = useMemo(() => ({ rooms, isLoading }), [rooms, isLoading]);

  return (
    <LiveRoomsContext.Provider value={value}>
      {children}
    </LiveRoomsContext.Provider>
  );
}

export function useLiveRoomsContext() {
  return useContext(LiveRoomsContext);
}
