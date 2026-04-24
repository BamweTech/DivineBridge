import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { THEME_COLORS } from '@/lib/constants';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected !== false) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>You're offline — showing cached content</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: THEME_COLORS.text2,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontFamily: 'InterTight_500Medium',
    fontSize: 13,
  },
});
