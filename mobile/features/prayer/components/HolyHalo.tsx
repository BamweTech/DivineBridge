import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, Path } from 'react-native-svg';

type BushShape = 'full' | 'tall';
type FlameShape = 'wide' | 'tall';

export type HaloConcept = {
  id: 'ember' | 'dawn' | 'wilderness' | 'midnight';
  washTop: string;
  washBottom: string;
  glow: string;
  ring: string;
  ringStyle: 'dashed' | 'solid';
  ringWidth: number;
  innerRing?: string;
  disc: string;
  discBorder: string;
  ground: string;
  bush: string;
  bushShade: string;
  bushShape: BushShape;
  flame: string;
  flameMid: string;
  flameCore: string;
  flameShape: FlameShape;
  sparks?: string;
  spinMs: number;
  pulseMs: number;
  flameUpMs: number;
  flameDownMs: number;
  lift: boolean;
};

const BUSH: Record<BushShape, { leaf: string; shade: string }> = {
  full: {
    leaf: 'M84 128 C78 104 62 96 58 78 C54 62 66 52 74 58 C70 44 80 34 90 42 C96 30 112 34 112 50 C124 46 134 60 126 74 C138 82 132 102 116 104 C112 118 96 124 84 128 Z',
    shade: 'M84 120 C80 100 70 94 68 82 C74 88 78 96 84 100 C90 92 96 86 100 78 C102 94 96 104 84 120 Z',
  },
  tall: {
    leaf: 'M84 130 C74 106 56 98 50 76 C44 54 62 42 76 54 C68 32 86 18 100 38 C110 22 130 32 124 54 C140 48 150 68 136 84 C146 96 136 116 116 114 C110 126 96 130 84 130 Z',
    shade: 'M84 122 C76 102 66 94 64 80 C72 88 80 98 86 102 C96 88 106 78 112 68 C114 90 104 110 84 122 Z',
  },
};

const FLAME: Record<FlameShape, { outer: string; mid: string; core: string }> = {
  wide: {
    outer: 'M60 82 C42 66 28 58 34 36 C40 48 48 46 50 32 C56 48 52 58 60 50 C68 36 78 28 74 14 C88 30 96 28 92 46 C104 40 112 52 100 66 C92 78 74 84 60 82 Z',
    mid: 'M60 78 C50 64 44 58 48 44 C54 54 58 52 60 42 C66 54 70 50 72 40 C80 52 86 48 82 62 C74 74 66 78 60 78 Z',
    core: 'M60 74 C56 64 54 60 58 52 C62 60 66 58 68 50 C72 60 70 66 60 74 Z',
  },
  tall: {
    outer: 'M60 86 C46 68 32 56 38 30 C46 44 54 40 56 22 C64 40 60 52 68 44 C74 26 88 14 82 2 C98 22 110 20 104 42 C118 34 122 52 106 68 C96 82 74 88 60 86 Z',
    mid: 'M60 80 C52 66 46 58 50 42 C56 52 60 50 62 38 C68 50 74 46 76 34 C84 48 90 44 86 60 C78 74 68 80 60 80 Z',
    core: 'M60 74 C56 62 54 56 58 46 C62 56 66 54 68 44 C74 56 72 66 60 74 Z',
  },
};

/** Same burning bush. Color, ring, and motion change between looks. */
export const HALO_CONCEPTS: HaloConcept[] = [
  {
    id: 'ember',
    washTop: 'rgba(201,146,48,0.16)',
    washBottom: 'rgba(176,90,80,0.10)',
    glow: 'rgba(201,146,48,0.18)',
    ring: 'rgba(176,125,32,0.55)',
    ringStyle: 'dashed',
    ringWidth: 1.5,
    disc: '#2a2118',
    discBorder: 'rgba(232,196,122,0.85)',
    ground: 'rgba(90,62,28,0.55)',
    bush: '#3d4a32',
    bushShade: '#243024',
    bushShape: 'full',
    flame: '#e8a23a',
    flameMid: '#f3d27a',
    flameCore: '#fff6d8',
    flameShape: 'wide',
    spinMs: 22000,
    pulseMs: 2800,
    flameUpMs: 680,
    flameDownMs: 520,
    lift: false,
  },
  {
    id: 'dawn',
    washTop: 'rgba(196,122,96,0.16)',
    washBottom: 'rgba(212,164,116,0.14)',
    glow: 'rgba(176,90,80,0.20)',
    ring: 'rgba(176,90,80,0.45)',
    ringStyle: 'solid',
    ringWidth: 2,
    innerRing: 'rgba(255,228,206,0.7)',
    disc: '#3a2420',
    discBorder: 'rgba(244,196,168,0.9)',
    ground: 'rgba(120,72,52,0.5)',
    bush: '#5c4636',
    bushShade: '#3a2a22',
    bushShape: 'tall',
    flame: '#e07a62',
    flameMid: '#f6c7a1',
    flameCore: '#fff4ea',
    flameShape: 'tall',
    spinMs: 28000,
    pulseMs: 3600,
    flameUpMs: 900,
    flameDownMs: 700,
    lift: true,
  },
  {
    id: 'wilderness',
    washTop: 'rgba(74,124,94,0.14)',
    washBottom: 'rgba(184,156,92,0.12)',
    glow: 'rgba(74,124,94,0.18)',
    ring: 'rgba(74,124,94,0.55)',
    ringStyle: 'dashed',
    ringWidth: 1.5,
    disc: '#1e2a22',
    discBorder: 'rgba(214,196,140,0.8)',
    ground: 'rgba(46,62,40,0.6)',
    bush: '#2f4a38',
    bushShade: '#1a2c22',
    bushShape: 'full',
    flame: '#f0d48a',
    flameMid: '#fff1c4',
    flameCore: '#ffffff',
    flameShape: 'wide',
    sparks: '#fff6d0',
    spinMs: 16000,
    pulseMs: 2200,
    flameUpMs: 480,
    flameDownMs: 360,
    lift: false,
  },
  {
    id: 'midnight',
    washTop: 'rgba(90,70,140,0.12)',
    washBottom: 'rgba(201,146,48,0.10)',
    glow: 'rgba(232,196,122,0.16)',
    ring: 'rgba(232,196,122,0.7)',
    ringStyle: 'solid',
    ringWidth: 1.5,
    innerRing: 'rgba(232,196,122,0.28)',
    disc: '#16141c',
    discBorder: 'rgba(255,236,196,0.75)',
    ground: 'rgba(40,36,48,0.7)',
    bush: '#3a4038',
    bushShade: '#22261f',
    bushShape: 'tall',
    flame: '#ffe9a8',
    flameMid: '#fff8e4',
    flameCore: '#ffffff',
    flameShape: 'tall',
    sparks: '#fff6d8',
    spinMs: 12000,
    pulseMs: 4000,
    flameUpMs: 400,
    flameDownMs: 300,
    lift: true,
  },
];

/** Stable look for this account, so two people rarely share the same halo. */
export function haloConceptForUser(uid: string | undefined): HaloConcept {
  const seed = uid && uid.length > 0 ? uid : 'guest';
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return HALO_CONCEPTS[hash % HALO_CONCEPTS.length];
}

function Spark({ x, y, color, delay }: { x: number; y: number; color: string; delay: number }) {
  const opacity = useSharedValue(0.15);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.12, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );
  }, [delay, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function HolyHalo({ concept }: { concept: HaloConcept }) {
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0);
  const flame = useSharedValue(0.65);
  const bush = BUSH[concept.bushShape];
  const flamePaths = FLAME[concept.flameShape];
  const lift = concept.lift;

  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: concept.spinMs, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(
      withTiming(1, { duration: concept.pulseMs, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    flame.value = withRepeat(
      withSequence(
        withTiming(1, { duration: concept.flameUpMs, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.45, { duration: concept.flameDownMs, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [concept, flame, pulse, spin]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }, { scale: 1 + pulse.value * 0.04 }],
    opacity: 0.55 + pulse.value * 0.35,
  }));
  const innerRingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-spin.value}deg` }],
    opacity: 0.4 + pulse.value * 0.35,
  }));
  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.08 }],
    opacity: 0.35 + pulse.value * 0.35,
  }));
  const flameStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + flame.value * 0.45,
    transform: [
      { translateY: lift ? (1 - flame.value) * 8 : 0 },
      { scale: 0.92 + flame.value * 0.12 },
    ],
  }));

  return (
    <View style={{ width: 280, height: 280, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 250,
            height: 250,
            borderRadius: 125,
            backgroundColor: concept.glow,
          },
          glowStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 228,
            height: 228,
            borderRadius: 114,
            borderWidth: concept.ringWidth,
            borderColor: concept.ring,
            borderStyle: concept.ringStyle,
          },
          ringStyle,
        ]}
      />
      {concept.innerRing ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 206,
              height: 206,
              borderRadius: 103,
              borderWidth: 1,
              borderColor: concept.innerRing,
              borderStyle: 'dashed',
            },
            innerRingStyle,
          ]}
        />
      ) : null}
      <View
        style={{
          width: 188,
          height: 188,
          borderRadius: 94,
          borderWidth: 8,
          borderColor: concept.discBorder,
          backgroundColor: concept.disc,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Svg width={168} height={168} viewBox="0 0 168 168">
          <Ellipse cx="84" cy="132" rx="46" ry="10" fill={concept.ground} />
          <Path d={bush.leaf} fill={concept.bush} />
          <Path d={bush.shade} fill={concept.bushShade} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', top: concept.flameShape === 'tall' ? 16 : 28 }, flameStyle]}>
          <Svg width={120} height={concept.flameShape === 'tall' ? 100 : 90} viewBox={concept.flameShape === 'tall' ? '0 0 120 100' : '0 0 120 90'}>
            <Path d={flamePaths.outer} fill={concept.flame} />
            <Path d={flamePaths.mid} fill={concept.flameMid} />
            <Path d={flamePaths.core} fill={concept.flameCore} />
          </Svg>
        </Animated.View>
        {concept.sparks ? (
          <>
            <Spark x={48} y={36} color={concept.sparks} delay={0} />
            <Spark x={128} y={42} color={concept.sparks} delay={240} />
            <Spark x={78} y={22} color={concept.sparks} delay={480} />
          </>
        ) : null}
      </View>
    </View>
  );
}
