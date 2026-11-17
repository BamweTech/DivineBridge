import { Redirect } from 'expo-router';

/** Home is no longer a tab. Verse lives on Devotional; prayer tools live on Pray. */
export default function HomeScreen() {
  return <Redirect href={'/(tabs)/pray' as never} />;
}
