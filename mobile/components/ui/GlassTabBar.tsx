import { View, Platform } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Tab-bar background. Lives behind the icons and labels so the tab bar
 * itself ends up looking like an iOS ultra-glass surface — the spec's
 * "`saturate(200%) blur(40px)`" equivalent.
 *
 * Designed to slot into expo-router's `Tabs.tabBarBackground` option:
 *   `tabBarBackground: () => <GlassTabBar />`
 *
 * The component fills its parent (the tab bar). We do not apply a border
 * here — the tab bar's `tabBarStyle.borderTopColor` continues to draw the
 * 1px hairline so the bar reads as separated from content.
 */

const ANDROID_BLUR_METHOD = Platform.OS === 'android' && (Platform.Version as number) >= 31
  ? 'dimezisBlurView'
  : 'none';

export function GlassTabBar() {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <BlurView
        intensity={95}
        tint="light"
        experimentalBlurMethod={ANDROID_BLUR_METHOD}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* Thin cream tint over the blur — just enough to keep icons legible
          on top of scrolling content without smothering the blur. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(250,246,239,0.28)',
        }}
      />
    </View>
  );
}

export default GlassTabBar;
