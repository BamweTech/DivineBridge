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

/**
 * Download a server-generated JPEG (same endpoints as web index.html) and open the native share sheet.
 * Falls back to plain-text share if download fails.
 */
export async function shareServerImage(
  apiPathWithQuery: string,
  localFilename: string,
  textFallback: string
): Promise<void> {
  const url = `${API_BASE_URL}${apiPathWithQuery}`;
  const baseDir = FileSystem.cacheDirectory;
  if (!baseDir) {
    await Share.share({ message: textFallback });
    return;
  }
  const dest = `${baseDir}${localFilename}`;

  try {
    const headers = await authHeaders();
    const result = await FileSystem.downloadAsync(url, dest, { headers });

    if (result.status !== 200) {
      await Share.share({ message: textFallback });
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(result.uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Share',
        UTI: 'public.jpeg',
      });
      return;
    }

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      await Share.share({
        url: result.uri,
        message: textFallback,
      });
      return;
    }

    await Share.share({ message: textFallback });
  } catch {
    await Share.share({ message: textFallback }).catch(() => null);
  }
}
