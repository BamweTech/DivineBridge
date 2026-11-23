import { View } from 'react-native';

/**
 * Floating tab-bar surface. A rounded glass capsule with a light cream wash
 * so the screen stays visible through it, plus a hairline and a top highlight.
 * The shadow lives on the outer view so the clipped fill does not cut it off.
 */

export const FLOATING_TAB_RADIUS = 32;

export function GlassTabBar() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: FLOATING_TAB_RADIUS,
        backgroundColor: 'transparent',
        boxShadow: '0 10px 24px rgba(44,36,23,0.16)',
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: FLOATING_TAB_RADIUS,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.72)',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(255,253,247,0.16)',
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 12, right: 12, height: 1,
            backgroundColor: 'rgba(255,255,255,0.85)',
          }}
        />
      </View>
    </View>
  );
}

export default GlassTabBar;
