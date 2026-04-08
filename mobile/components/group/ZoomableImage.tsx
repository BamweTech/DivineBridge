import { useCallback, useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type Props = {
  uri: string;
  width: number;
  height: number;
  /** When true, parent should disable horizontal paging (e.g. FlatList scroll). */
  onZoomActiveChange?: (active: boolean) => void;
};

export function ZoomableImage({ uri, width, height, onZoomActiveChange }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const notifyZoom = useCallback(
    (active: boolean) => {
      onZoomActiveChange?.(active);
    },
    [onZoomActiveChange],
  );

  useEffect(() => {
    scale.value = MIN_SCALE;
    savedScale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    onZoomActiveChange?.(false);
  }, [uri, onZoomActiveChange]);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      runOnJS(notifyZoom)(true);
    })
    .onUpdate((e) => {
      const next = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
      scale.value = next;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < MIN_SCALE) {
        scale.value = withTiming(MIN_SCALE);
        savedScale.value = MIN_SCALE;
      }
      if (scale.value <= MIN_SCALE + 0.02) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      }
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((e, state) => {
      if (scale.value > MIN_SCALE + 0.02) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE + 0.02) return;
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      translateX.value = clamp(
        savedTranslateX.value + e.translationX,
        -maxX,
        maxX,
      );
      translateY.value = clamp(
        savedTranslateY.value + e.translationY,
        -maxY,
        maxY,
      );
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (scale.value > MIN_SCALE + 0.05) {
        scale.value = withTiming(MIN_SCALE);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = MIN_SCALE;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(notifyZoom)(false);
      } else {
        const target = 2.2;
        scale.value = withTiming(target);
        savedScale.value = target;
        runOnJS(notifyZoom)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan);
  const root = Gesture.Exclusive(doubleTap, composed);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={root}>
      <Animated.View
        style={[
          {
            width,
            height,
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
          },
          style,
        ]}
      >
        <Image
          source={{ uri }}
          style={{ width, height }}
          contentFit="contain"
          accessibilityLabel="Full-size image"
        />
      </Animated.View>
    </GestureDetector>
  );
}
