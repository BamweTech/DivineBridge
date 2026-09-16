import { Share, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export const VERSE_EXPLAINER_SECTIONS = [
  'verse',
  'context',
  'meaning',
  'application',
] as const;

export type VerseExplainerSection = (typeof VERSE_EXPLAINER_SECTIONS)[number];

export const VERSE_EXPLAINER_LABELS: Record<VerseExplainerSection, string> = {
  verse: 'Verse',
  context: 'Context',
  meaning: 'Meaning',
  application: 'Application',
};

/**
 * Download a server-generated JPEG into the cache directory.
 * Returns a local `file://` URI, or `null` if the download failed.
 */
export async function downloadServerImage(
  apiPathWithQuery: string,
  localFilename: string
): Promise<string | null> {
  const url = `${API_BASE_URL}${apiPathWithQuery}`;
  const baseDir = FileSystem.cacheDirectory;
  if (!baseDir) return null;
  const dest = `${baseDir}${localFilename}`;

  try {
    const headers = await authHeaders();
    const result = await FileSystem.downloadAsync(url, dest, { headers });
    if (result.status !== 200) return null;
    return result.uri;
  } catch {
    return null;
  }
}

export async function shareLocalImage(uri: string, textFallback: string): Promise<void> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Share',
        UTI: 'public.jpeg',
      });
      return;
    }
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      await Share.share({ url: uri, message: textFallback });
      return;
    }
    await Share.share({ message: textFallback });
  } catch {
    await Share.share({ message: textFallback }).catch(() => null);
  }
}

/**
 * Download a server-generated JPEG (same endpoints as web index.html) and open the native share sheet.
 * Falls back to plain-text share if download fails.
 */
export async function shareServerImage(
  apiPathWithQuery: string,
  localFilename: string,
  textFallback: string
): Promise<void> {
  const uri = await downloadServerImage(apiPathWithQuery, localFilename);
  if (!uri) {
    await Share.share({ message: textFallback }).catch(() => null);
    return;
  }
  await shareLocalImage(uri, textFallback);
}

export function verseExplainerImagePath(date: string, section: VerseExplainerSection): string {
  return `/api/today-verse/explainer-image/${section}?client_date=${encodeURIComponent(date)}`;
}
