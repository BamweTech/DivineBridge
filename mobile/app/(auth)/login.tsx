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
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import DivineBridgeLogo from '@/components/ui/DivineBridgeLogo';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { login, resetPassword, isLoading } = useAuthStore();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  function validate(): boolean {
    const e: typeof errors = {};
    if (!email.includes('@')) e.email = 'Enter a valid email';
    if (password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: any) {
      Alert.alert('Login failed', err.message);
    }
  }

  async function handleForgotPassword() {
    if (!email.includes('@')) {
      Alert.alert('Enter your email first', 'Type your email address above, then tap Forgot Password.');
      return;
    }
    try {
      await resetPassword(email.trim().toLowerCase());
      Alert.alert('Check your inbox', 'A password reset link has been sent to your email.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Warm radial glow at top */}
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
          paddingTop: insets.top + 48,
          paddingHorizontal: 28,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo + headline */}
        <Animated.View entering={FadeInDown.delay(0).duration(600)} style={{ alignItems: 'center', marginBottom: 48 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: THEME_COLORS.goldDim,
            borderWidth: 1, borderColor: THEME_COLORS.goldBorder,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 20,
          }}>
            <DivineBridgeLogo size={46} color={THEME_COLORS.gold} />
          </View>
          <Text
            style={{
              color: THEME_COLORS.text,
              fontSize: 30,
              fontFamily: 'PlusJakartaSans_700Bold',
              textAlign: 'center',
              letterSpacing: -0.5,
              marginBottom: 8,
            }}
          >
            Divine Bridge
          </Text>
          <Text
            style={{
              color: THEME_COLORS.text2,
              fontSize: 15,
              fontFamily: 'Geist_400Regular',
              textAlign: 'center',
            }}
          >
            Welcome back
          </Text>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInDown.delay(150).duration(600)}>
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
            placeholder="••••••••"
            isPassword
            autoComplete="current-password"
            error={errors.password}
          />

          <Pressable
            onPress={handleForgotPassword}
            style={{ alignSelf: 'flex-end', marginBottom: 24, marginTop: -8 }}
          >
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 13 }}>
              Forgot password?
            </Text>
          </Pressable>

          <Button label="Sign In" onPress={handleLogin} isLoading={isLoading} fullWidth size="lg" />
        </Animated.View>

        {/* Footer */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(600)}
          style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 32 }}
        >
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14 }}>
            Don't have an account?{' '}
          </Text>
          <Link href="/(auth)/signup" asChild>
            <Pressable>
              <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                Sign up
              </Text>
            </Pressable>
          </Link>
        </Animated.View>

        {/* Scripture quote */}
        <Animated.View entering={FadeInDown.delay(400).duration(600)} style={{ marginTop: 48, alignItems: 'center' }}>
          <View style={{ height: 1, width: 48, backgroundColor: THEME_COLORS.border, marginBottom: 16 }} />
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, fontStyle: 'italic', textAlign: 'center', lineHeight: 20 }}>
            "Where two or three gather in my name,{'\n'}I am there among them."
          </Text>
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11, marginTop: 6, letterSpacing: 0.5 }}>
            MATTHEW 18:20
          </Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
