import { useState } from 'react';
import { TextInput, View, Text, Pressable, TextInputProps } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
}

export function Input({ label, error, isPassword, style, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={{ marginBottom: 16 }}>
      {label && (
        <Text
          style={{
            color: THEME_COLORS.text2,
            fontFamily: 'InterTight_500Medium',
            fontSize: 13,
            marginBottom: 6,
          }}
        >
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: THEME_COLORS.bg2,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: error
            ? THEME_COLORS.rose
            : focused
            ? THEME_COLORS.gold
            : THEME_COLORS.border,
          paddingHorizontal: 16,
        }}
      >
        <TextInput
          {...props}
          secureTextEntry={isPassword && !showPassword}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          placeholderTextColor={THEME_COLORS.text3}
          style={[
            {
              flex: 1,
              color: THEME_COLORS.text,
              fontFamily: 'InterTight_400Regular',
              fontSize: 15,
              paddingVertical: 14,
            },
            style,
          ]}
        />
        {isPassword && (
          <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
            <Text style={{ color: THEME_COLORS.text3, fontSize: 16 }}>
              {showPassword ? '○' : '●'}
            </Text>
          </Pressable>
        )}
      </View>
      {error && (
        <Text
          style={{
            color: THEME_COLORS.rose,
            fontFamily: 'InterTight_400Regular',
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
