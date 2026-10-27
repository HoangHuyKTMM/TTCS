import { useThemeStyles } from '../../components/AppTheme'
import { type AppColors } from '../../theme'
import { useState } from "react";
import { Stack, Link, useRouter } from "expo-router";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Auth from '../../lib/auth'
import CustomAlert from '../../components/CustomAlert'
import KeyboardSafeScroll from '../../components/KeyboardSafe'

export default function RegisterScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [fbLoading, setFbLoading] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<any>({ type: 'info', title: '', message: '' });

  async function handleRegister() {
    if (loading || googleLoading || fbLoading) return;
    if (!name.trim() || !email.trim() || !password) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Vui lòng điền đầy đủ thông tin' });
      setAlertVisible(true);
      return;
    }

    if (password !== confirmPassword) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Mật khẩu nhập lại không khớp' });
      setAlertVisible(true);
      return;
    }

    if (password.length < 6) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Mật khẩu phải có ít nhất 6 ký tự' });
      setAlertVisible(true);
      return;
    }

    setLoading(true);
    try {
      const res: any = await Auth.register(name.trim(), email.trim(), password);
      if (res?.error || !res?.id) throw new Error(res?.message || res?.error || 'Đăng ký thất bại');
      setAlertConfig({
        type: 'success', title: 'Thành công',
        message: 'Đăng ký thành công! Vui lòng đăng nhập.',
        buttons: [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      });
      setAlertVisible(true);
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: err.message || 'Đăng ký thất bại' });
      setAlertVisible(true);
    } finally {
      setLoading(false);
    }
  }

  const handleGoogleLogin = async () => {
    if (loading || googleLoading || fbLoading) return;
    setGoogleLoading(true);
    try {
      const res = await Auth.loginWithGoogle();
      if (res?.token) router.replace('/(tabs)/explore');
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi Google', message: err.message || 'Đăng ký Google thất bại' });
      setAlertVisible(true);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleFacebookLogin = async () => {
    if (loading || googleLoading || fbLoading) return;
    setFbLoading(true);
    try {
      const res = await Auth.loginWithFacebook();
      if (res?.token) router.replace('/(tabs)/explore');
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi Facebook', message: err.message || 'Đăng ký Facebook thất bại' });
      setAlertVisible(true);
    } finally {
      setFbLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardSafeScroll
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Tạo tài khoản</Text>
          <Text style={styles.subtitle}>Đăng ký để khám phá truyện và theo dõi chương mới</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          {/* Name Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Họ và tên"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              editable={!loading}
            />
          </View>

          {/* Email Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Mật khẩu"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
              <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Confirm Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập lại mật khẩu"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
              <Ionicons name={showConfirmPassword ? "eye-outline" : "eye-off-outline"} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Register Button */}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryButtonText}>Đăng ký</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>hoặc đăng ký với</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.socialFull, googleLoading && styles.socialButtonLoading]}
            disabled={loading || googleLoading || fbLoading}
            onPress={handleGoogleLogin}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={colors.text} />
                <Text style={styles.socialFullText}>Đăng ký với Google</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.socialFull, fbLoading && styles.socialButtonLoading]}
            disabled={loading || googleLoading || fbLoading}
            onPress={handleFacebookLogin}
          >
            {fbLoading ? (
              <ActivityIndicator color="#1877F2" size="small" />
            ) : (
              <>
                <Ionicons name="logo-facebook" size={20} color="#1877F2" />
                <Text style={styles.socialFullText}>Đăng ký với Facebook</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Đã có tài khoản? </Text>
          <Link href={"/(auth)/login" as any} replace>
            <Text style={styles.footerLink}>Đăng nhập</Text>
          </Link>
        </View>
      </KeyboardSafeScroll>

      <CustomAlert
        visible={alertVisible}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  formContainer: {
    gap: 14,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  eyeButton: {
    padding: 4,
  },
  primaryButton: {
    height: 52,
    backgroundColor: colors.accent,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: "600",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderLight,
  },
  dividerText: {
    marginHorizontal: 14,
    color: colors.textMuted,
    fontSize: 13,
  },
  socialFull: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  socialFullText: { fontSize: 15, fontWeight: "700", color: colors.text },
  socialButtonLoading: {
    opacity: 0.7,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 32,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: colors.accentText,
    fontSize: 14,
    fontWeight: "600",
  },
});
