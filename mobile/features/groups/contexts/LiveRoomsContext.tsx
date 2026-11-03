import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { isLiveFeedRoom } from '@/lib/liveFeedRoom';
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
    // Keep the room_type inequality in the query so Firestore security rules can
    // prove matched_prayer_call docs are never returned to non-participants.
    // IMPORTANT: Firestore excludes documents that omit `room_type` from !=
    // filters. Backend create/join/cleanup paths must always set room_type on
    // standard prayer / group live rooms (see DEFAULT_ROOM_TYPE).
    const q = query(
      collection(db, COLLECTIONS.PRAYER_ROOMS),
      where('is_active', '==', true),
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
          .filter(isLiveFeedRoom);
        data.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        setRooms(data);
        setIsLoading(false);
      },
      (error) => {
        console.error('LiveRooms listener failed', error);
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
