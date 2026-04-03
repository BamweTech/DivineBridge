import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXEL_RATIO = PixelRatio.get();

/**
 * For Firebase Storage URLs, appends size hints that can be used by a
 * Cloud Function or CDN image resizer (e.g., Firebase Extensions Resize Images).
 *
 * If the image URL contains a resizable path like `profile_photos/`, returns
 * a thumbUrl targeting the device's screen density.
 */
export function getOptimizedImageUrl(
  url: string | undefined | null,
  targetWidthDp: number = SCREEN_WIDTH,
): string | undefined {
  if (!url) return undefined;

  // Firebase Storage URLs with resize extension
  // The Resize Images extension writes thumbnails like: thumb_200x200_originalName
  const targetWidthPx = Math.round(targetWidthDp * PIXEL_RATIO);

  // Pick the nearest thumbnail size bucket
  const buckets = [100, 200, 400, 800, 1200];
  const bestBucket = buckets.find((b) => b >= targetWidthPx) ?? buckets[buckets.length - 1];

  // If the URL points to Firebase Storage and follows the resize convention
  if (url.includes('firebasestorage.app') || url.includes('firebasestorage.googleapis.com')) {
    // Try the _thumb variant — if the resize extension is installed
    const thumbUrl = url.replace(
      /(%2F|\/)(profile_photos|group_chat_uploads)(%2F|\/)/,
      `$1$2$3thumb_${bestBucket}x${bestBucket}_`,
    );
    // Return original as fallback via the Image component's `source` array
    return thumbUrl !== url ? thumbUrl : url;
  }

  return url;
}

/**
 * Generates a tiny blur-hash placeholder color from the first few chars
 * of a URL. Used as a background while the real image loads.
 */
export function placeholderColor(url: string | undefined): string {
  if (!url) return '#e8e2d8';
  let hash = 0;
  for (let i = 0; i < Math.min(url.length, 20); i++) {
    hash = url.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 15%, 85%)`;
}
