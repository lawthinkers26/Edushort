import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

type Mode = 'signIn' | 'signUp';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (mode === 'signUp' && name.trim().length < 2) return 'Please enter your name.';
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signIn') await signIn(email, password);
      else await signUp(name, email, password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter your email above first, then tap “Forgot password”.');
      return;
    }
    try {
      await resetPassword(email);
      Alert.alert('Check your inbox', `We sent a password reset link to ${email.trim()}.`);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not send reset email');
    }
  };

  const inputClass = 'rounded-xl border border-ink-700 bg-ink-900 px-4 py-3.5 text-base text-white';

  return (
    <LinearGradient colors={['#2E1065', '#07060B']} locations={[0, 0.6]} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
          contentContainerClassName="px-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
              <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 4 }} />
            </View>
            <Text className="mt-4 text-3xl font-extrabold text-white">EduShorts</Text>
            <Text className="mt-1 text-center text-base text-ink-300">Learn anything in 60 seconds.</Text>
          </View>

          <View className="mt-10 gap-3">
            {mode === 'signUp' ? (
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="words"
                textContentType="name"
                className={inputClass}
              />
            ) : null}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              className={inputClass}
            />
            <View className="justify-center">
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textFaint}
                secureTextEntry={!showPassword}
                textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
                autoComplete={mode === 'signUp' ? 'new-password' : 'password'}
                className={`${inputClass} pr-12`}
                onSubmitEditing={submit}
                returnKeyType="go"
              />
              <Pressable
                onPress={() => setShowPassword((value) => !value)}
                hitSlop={10}
                className="absolute right-4"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          {error ? <Text className="mt-3 text-sm text-red-400">{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting}
            className="mt-6 items-center rounded-xl bg-brand-600 py-4 active:opacity-80"
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-bold text-white">{mode === 'signIn' ? 'Sign in' : 'Create account'}</Text>
            )}
          </Pressable>

          {mode === 'signIn' ? (
            <Pressable onPress={forgotPassword} className="mt-4 items-center py-1">
              <Text className="text-sm text-ink-300">Forgot password?</Text>
            </Pressable>
          ) : null}

          <View className="flex-1" />

          <Pressable
            onPress={() => {
              setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
              setError(null);
            }}
            className="mt-8 items-center py-2"
          >
            <Text className="text-sm text-ink-300">
              {mode === 'signIn' ? "New to EduShorts? " : 'Already have an account? '}
              <Text className="font-bold text-brand-300">{mode === 'signIn' ? 'Create an account' : 'Sign in'}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
