import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { THEME_COLORS } from '@/lib/constants';
import DivineBridgeLogo from '@/components/ui/DivineBridgeLogo';

export default function SignupScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { signup, isLoading } = useAuthStore();
  const insets = useSafeAreaInsets();

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (displayName.trim().length < 2) e.displayName = 'Enter your full name';
    if (!email.includes('@')) e.email = 'Enter a valid email';
    if (password.length < 8) e.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSignup() {
    if (!validate()) return;
    try {
      await signup(email.trim().toLowerCase(), password, displayName.trim());
    } catch (err: any) {
      Alert.alert('Sign up failed', err.message);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={{
          position: 'absolute',
          top: -80,
          left: '50%',
          marginLeft: -150,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: THEME_COLORS.goldDim,
        }}
        pointerEvents="none"
      />

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 32,
          paddingHorizontal: 28,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.delay(0).duration(600)} style={{ alignItems: 'center', marginBottom: 36 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: THEME_COLORS.goldDim,
            borderWidth: 1, borderColor: THEME_COLORS.goldBorder,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <DivineBridgeLogo size={46} color={THEME_COLORS.gold} />
          </View>
          <Text
            style={{
              color: THEME_COLORS.text,
              fontSize: 26,
              fontFamily: 'PlusJakartaSans_700Bold',
              textAlign: 'center',
              letterSpacing: -0.5,
              marginBottom: 8,
            }}
          >
            Join Divine Bridge
          </Text>
          <Text
            style={{
              color: THEME_COLORS.text2,
              fontSize: 14,
              fontFamily: 'Geist_400Regular',
              textAlign: 'center',
            }}
          >
            Connect, pray, and grow together
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(600)}>
          <Input
            label="Full Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            error={errors.displayName}
          />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Min. 8 characters"
            isPassword
            autoComplete="new-password"
            error={errors.password}
          />
          <Input
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repeat password"
            isPassword
            error={errors.confirmPassword}
          />

          <Button
            label="Create Account"
            onPress={handleSignup}
            isLoading={isLoading}
            fullWidth
            size="lg"
            style={{ marginTop: 8 }}
          />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(300).duration(600)}
          style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 28 }}
        >
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14 }}>
            Already have an account?{' '}
          </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                Sign in
              </Text>
            </Pressable>
          </Link>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
