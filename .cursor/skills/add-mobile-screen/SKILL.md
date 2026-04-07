---
name: add-mobile-screen
description: >-
  Add a new screen to the Divine Bridge Expo mobile app following file-based
  routing conventions. Use when creating new mobile screens or views.
---

# Add a New Mobile Screen

## Step 1: Create the screen file

Add a new `.tsx` file in `mobile/app/` following expo-router conventions:

- **Tab screen**: `mobile/app/(tabs)/feature.tsx`
- **Auth screen**: `mobile/app/(auth)/feature.tsx`
- **Standalone screen**: `mobile/app/feature.tsx`
- **Dynamic route**: `mobile/app/feature/[id].tsx`

Basic screen template:

```tsx
import { View, Text, ScrollView } from 'react-native';

export default function FeatureScreen() {
  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-4 py-6">
        <Text className="text-2xl font-bold text-gray-900">Feature</Text>
      </View>
    </ScrollView>
  );
}
```

## Step 2: Register in layout (if needed)

If the screen needs custom header options or is a new tab, update the nearest `_layout.tsx`:

For a Stack screen in root layout (`mobile/app/_layout.tsx`):

```tsx
<Stack.Screen
  name="feature"
  options={{ headerShown: false }}
/>
```

For a new tab (`mobile/app/(tabs)/_layout.tsx`):

```tsx
<Tabs.Screen
  name="feature"
  options={{
    title: 'Feature',
    tabBarIcon: ({ color, size }) => (
      <Icon name="star" size={size} color={color} />
    ),
  }}
/>
```

## Step 3: Add API integration

Add the endpoint to `mobile/services/api.ts`:

```typescript
export const featureApi = {
  get: (id: string) =>
    request<{ success: boolean; data: Feature }>(`/api/feature/${id}`),
};
```

## Step 4: Create a data hook

Add `mobile/hooks/useFeature.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { featureApi } from '@/services/api';

export function useFeature(id: string) {
  return useQuery({
    queryKey: ['feature', id],
    queryFn: () => featureApi.get(id),
    enabled: !!id,
  });
}
```

## Step 5: Style with NativeWind

- Use `className` prop with Tailwind utilities.
- Theme colors from `THEME_COLORS` in `mobile/lib/constants.ts`.
- Icons via `mobile/components/ui/Icon.tsx`.
- Fonts: Plus Jakarta Sans for body, Geist for UI elements.

## Step 6: Add navigation

Link to the new screen from existing screens:

```tsx
import { useRouter } from 'expo-router';

const router = useRouter();
router.push('/feature');
// or for dynamic routes:
router.push(`/feature/${id}`);
```

## Step 7: Add Zustand store (if local state needed)

Create `mobile/stores/featureStore.ts`:

```typescript
import { create } from 'zustand';

interface FeatureState {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

export const useFeatureStore = create<FeatureState>((set) => ({
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),
}));
```
