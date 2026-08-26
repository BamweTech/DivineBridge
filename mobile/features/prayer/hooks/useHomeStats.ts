import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import type { DevotionalPlan } from '@/types';

/**
 * Latest devotional plan streak from Firestore (same source as the Devotional tab).
 */
export function useDevotionalStreak() {
  const { user } = useAuthStore();
  const [streak, setStreak] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setStreak(0);
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, COLLECTIONS.DEVOTIONAL_PLANS),
      where('uid', '==', user.uid),
      limit(10)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setStreak(0);
          setIsLoading(false);
          return;
        }
        const plans = snap.docs
          .map((d) => ({ plan_id: d.id, ...d.data() } as DevotionalPlan))
          .sort((a, b) => {
            const ta =
              typeof a.created_at === 'number'
                ? a.created_at
                : (a.created_at as { toMillis?: () => number })?.toMillis?.() ?? 0;
            const tb =
              typeof b.created_at === 'number'
                ? b.created_at
                : (b.created_at as { toMillis?: () => number })?.toMillis?.() ?? 0;
            return tb - ta;
          });
        setStreak(plans[0]?.streak ?? 0);
        setIsLoading(false);
      },
      () => {
        setStreak(0);
        setIsLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  return { devotionalStreak: streak, isLoading };
}
