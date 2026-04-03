import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DevotionalPlan } from '@/types';

const KEY_PREFIX = '@divinebridge:devotional_plans:';

export async function readDevotionalCache(uid: string): Promise<DevotionalPlan[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${KEY_PREFIX}${uid}`);
    if (!raw) return null;
    return JSON.parse(raw) as DevotionalPlan[];
  } catch {
    return null;
  }
}

export async function writeDevotionalCache(uid: string, plans: DevotionalPlan[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${KEY_PREFIX}${uid}`, JSON.stringify(plans));
  } catch {
    /* best-effort */
  }
}
