import { useEffect, useState } from "react";
import { Stack, Link, useRouter } from "expo-router";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Auth from '../../lib/auth'
import CustomAlert from '../../components/CustomAlert'

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [fbLoading, setFbLoading] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<any>({ type: 'info', title: '', message: '' });

  // Handle email/password login
  async function handleLogin() {
    if (!email || !password) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Vui lòng nhập email và mật khẩu' });
      setAlertVisible(true);
      return;
    }

    setLoading(true);
    try {
      const res: any = await Auth.login(email, password);
      if (res && res.token) {
        router.replace('/(tabs)/explore');
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi đăng nhập', message: err.message || 'Đăng nhập thất bại' });
      setAlertVisible(true);
    } finally {
      setLoading(false);
    }
  }

  // Handle Google Sign In
  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    try {
      const res = await Auth.loginWithGoogle();
      if (res && res.token) {
        router.replace('/(tabs)/explore');
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi Google', message: err.message || 'Đăng nhập Google thất bại' });
      setAlertVisible(true);
    } finally {
      setGoogleLoading(false);
    }
  };

  // Handle Facebook Login  
  const handleFacebookLogin = async () => {
    if (fbLoading) return;
    setFbLoading(true);
    try {
      const res = await Auth.loginWithFacebook();
      if (res && res.token) {
        router.replace('/(tabs)/explore');
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi Facebook', message: err.message || 'Đăng nhập Facebook thất bại' });
      setAlertVisible(true);
    } finally {
      setFbLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Chào mừng trở lại</Text>
          <Text style={styles.subtitle}>Đăng nhập để tiếp tục đọc truyện yêu thích</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          {/* Email Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color="#6b7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color="#6b7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Mật khẩu"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
              <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Forgot Password */}
          <TouchableOpacity style={styles.forgotButton}>
            <Text style={styles.forgotText}>Quên mật khẩu?</Text>
          </TouchableOpacity>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Đăng nhập</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>hoặc tiếp tục với</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Buttons */}
          <View style={styles.socialContainer}>
            <TouchableOpacity
              style={[styles.socialButton, googleLoading && styles.socialButtonLoading]}
              disabled={googleLoading}
              onPress={handleGoogleLogin}
            >
              {googleLoading ? (
                <ActivityIndicator color="#111827" size="small" />
              ) : (
                <Ionicons name="logo-google" size={22} color="#111827" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.socialButton, fbLoading && styles.socialButtonLoading]}
              disabled={fbLoading}
              onPress={handleFacebookLogin}
            >
              {fbLoading ? (
                <ActivityIndicator color="#1877F2" size="small" />
              ) : (
                <Ionicons name="logo-facebook" size={22} color="#1877F2" />
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.socialButton, styles.socialButtonDisabled]} disabled>
              <Ionicons name="logo-apple" size={22} color="#999" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Chưa có tài khoản? </Text>
          <Link href={"/(auth)/register" as any} replace>
            <Text style={styles.footerLink}>Đăng ký ngay</Text>
          </Link>
        </View>
      </ScrollView>

      <CustomAlert
        visible={alertVisible}
        type={alertConfig.type}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
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
    backgroundColor: "#f2f4f7",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: {
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#6b7280",
    lineHeight: 22,
  },
  formContainer: {
    gap: 14,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f4f7",
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
    color: "#111827",
  },
  eyeButton: {
    padding: 4,
  },
  forgotButton: {
    alignSelf: "flex-end",
    marginTop: -6,
  },
  forgotText: {
    color: "#1088ff",
    fontSize: 13,
    fontWeight: "500",
  },
  primaryButton: {
    height: 52,
    backgroundColor: "#111827",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#fff",
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
    backgroundColor: "#e5e7eb",
  },
  dividerText: {
    marginHorizontal: 14,
    color: "#9ca3af",
    fontSize: 13,
  },
  socialContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
  },
  socialButton: {
    width: 52,
    height: 52,
    backgroundColor: "#f2f4f7",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  socialButtonLoading: {
    opacity: 0.7,
  },
  socialButtonDisabled: {
    opacity: 0.5,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 40,
  },
  footerText: {
    color: "#6b7280",
    fontSize: 14,
  },
  footerLink: {
    color: "#1088ff",
    fontSize: 14,
    fontWeight: "600",
  },
});
