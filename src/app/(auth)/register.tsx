import { useEffect, useState } from "react";
import { Stack, Link, useRouter } from "expo-router";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as Facebook from "expo-auth-session/providers/facebook";
import * as Auth from '../../lib/auth'
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from '../../lib/firebase'
import CustomAlert from '../../components/CustomAlert'

WebBrowser.maybeCompleteAuthSession();

export default function RegisterScreen() {
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
  const extra = (Constants.expoConfig?.extra || {}) as any;

  // Google Auth - use Firebase client IDs
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });

  // Facebook Auth
  const [fbRequest, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: extra.facebookAppId,
  });

  async function handleRegister() {
    if (!name || !email || !password) {
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
      // Try Firebase registration first
      try {
        const res = await Auth.registerWithFirebase(name, email, password);
        if (res && res.token) {
          setAlertConfig({
            type: 'success',
            title: 'Thành công',
            message: 'Đăng ký thành công!',
            buttons: [{ text: 'OK', onPress: () => router.replace('/(tabs)/explore') }]
          });
          setAlertVisible(true);
          return;
        }
      } catch (firebaseErr: any) {
        // If Firebase fails, try backend registration
        const res: any = await Auth.register(name, email, password);
        if (res && res.error) {
          throw new Error(res.error);
        } else if (res && res.id) {
          setAlertConfig({
            type: 'success',
            title: 'Thành công',
            message: 'Đăng ký thành công! Vui lòng đăng nhập.',
            buttons: [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
          });
          setAlertVisible(true);
          return;
        }
        throw firebaseErr;
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: err.message || 'Đăng ký thất bại' });
      setAlertVisible(true);
    } finally {
      setLoading(false);
    }
  }

  // Handle Google sign in response
  useEffect(() => {
    async function handleGoogleResponse() {
      if (googleResponse?.type === "success") {
        setGoogleLoading(true);
        try {
          const { authentication } = googleResponse;
          if (authentication?.idToken) {
            await Auth.loginWithGoogle(authentication.idToken);
            router.replace('/(tabs)/explore');
          }
        } catch (err: any) {
          setAlertConfig({ type: 'error', title: 'Lỗi Google', message: err.message || 'Đăng ký Google thất bại' });
          setAlertVisible(true);
        } finally {
          setGoogleLoading(false);
        }
      }
    }
    handleGoogleResponse();
  }, [googleResponse]);

  // Handle Facebook sign in response
  useEffect(() => {
    async function handleFacebookResponse() {
      if (fbResponse?.type === "success") {
        setFbLoading(true);
        try {
          const { authentication } = fbResponse;
          if (authentication?.accessToken) {
            await Auth.loginWithFacebook(authentication.accessToken);
            router.replace('/(tabs)/explore');
          }
        } catch (err: any) {
          setAlertConfig({ type: 'error', title: 'Lỗi Facebook', message: err.message || 'Đăng ký Facebook thất bại' });
          setAlertVisible(true);
        } finally {
          setFbLoading(false);
        }
      }
    }
    handleFacebookResponse();
  }, [fbResponse]);

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    try {
      await googlePromptAsync();
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Không thể mở Google Sign In' });
      setAlertVisible(true);
    }
  };

  const handleFacebookLogin = async () => {
    if (fbLoading) return;
    try {
      await fbPromptAsync();
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Không thể mở Facebook Login' });
      setAlertVisible(true);
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
          <Text style={styles.title}>Tạo tài khoản</Text>
          <Text style={styles.subtitle}>Đăng ký để bắt đầu hành trình đọc sách</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          {/* Name Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color="#6b7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Họ và tên"
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />
          </View>

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

          {/* Confirm Password Input */}
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color="#6b7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập lại mật khẩu"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
              <Ionicons name={showConfirmPassword ? "eye-outline" : "eye-off-outline"} size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Register Button */}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
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

          {/* Social Buttons */}
          <View style={styles.socialContainer}>
            <TouchableOpacity
              style={[styles.socialButton, googleLoading && styles.socialButtonLoading]}
              disabled={!googleRequest || googleLoading}
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
              disabled={!fbRequest || fbLoading}
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
          <Text style={styles.footerText}>Đã có tài khoản? </Text>
          <Link href={"/(auth)/login" as any} replace>
            <Text style={styles.footerLink}>Đăng nhập</Text>
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
    marginBottom: 32,
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
    marginTop: 32,
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
