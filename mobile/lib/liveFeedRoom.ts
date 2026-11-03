import type { PrayerRoom } from '@/types';

/** Rooms that should not appear in the shared live feed (private 1:1 call types). */
export function isLiveFeedRoom(room: Pick<PrayerRoom, 'room_type'>): boolean {
  return room.room_type !== 'voice_link' && room.room_type !== 'matched_prayer_call';
}
