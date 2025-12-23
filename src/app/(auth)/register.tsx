import { useEffect, useState } from "react";
import { Stack, Link, useRouter } from "expo-router";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { AntDesign, FontAwesome } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as Facebook from "expo-auth-session/providers/facebook";
import * as Auth from '../../lib/auth'
import CustomAlert from '../../components/CustomAlert'

WebBrowser.maybeCompleteAuthSession();

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<any>({ type: 'info', title: '', message: '' });
  const extra = (Constants.expoConfig?.extra || {}) as any;

  const googleClientId = Platform.OS === "android" ? extra.googleAndroidClientId : extra.googleWebClientId;

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    clientId: googleClientId,
  });

  const [fbRequest, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: extra.facebookAppId,
  });

  const onRegister = () => {
    router.replace("/");
  };

  async function handleRegister() {
    try {
      // Validate passwords match
      if (password !== confirmPassword) {
        setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Mật khẩu nhập lại không khớp' });
        setAlertVisible(true);
        return
      }
      if (!password || password.length < 6) {
        setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Mật khẩu phải có ít nhất 6 ký tự' });
        setAlertVisible(true);
        return
      }
      const res: any = await Auth.register(name, email, password)
      // server returns user object on success, or { error: '...' } on failure
      if (res && res.error) {
        setAlertConfig({ type: 'error', title: 'Lỗi', message: res.error });
        setAlertVisible(true);
      } else if (res && res.id) {
        // register success (server returned user object with id)
        setAlertConfig({
          type: 'success',
          title: 'Thành công',
          message: 'Đăng ký thành công! Vui lòng đăng nhập lại.',
          buttons: [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
        });
        setAlertVisible(true);
      } else {
        setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Đăng ký thất bại' });
        setAlertVisible(true);
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: err.message || 'Đăng ký thất bại' });
      setAlertVisible(true);
    }
  }

  useEffect(() => {
    if (googleResponse?.type === "success") {
      router.replace("/");
    }
  }, [googleResponse]);

  useEffect(() => {
    if (fbResponse?.type === "success") {
      router.replace("/");
    }
  }, [fbResponse]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Đăng ký" }} />
      <Text style={styles.title}>Đăng ký</Text>

      <TextInput
        style={styles.input}
        placeholder="Họ và tên"
        value={name}
        onChangeText={setName}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Mật khẩu"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TextInput
        style={styles.input}
        placeholder="Nhập lại mật khẩu"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      <TouchableOpacity style={styles.button} onPress={handleRegister}>
        <Text style={styles.buttonText}>Tạo tài khoản</Text>
      </TouchableOpacity>

      <View style={styles.socialRow}>
        <TouchableOpacity
          style={[styles.socialBtn, styles.google]}
          disabled={!googleRequest}
          onPress={() => googlePromptAsync()}
        >
          <AntDesign name="google" size={18} color="#ea4335" style={styles.iconLeft} />
          <Text style={styles.socialText}>Tiếp tục với Google</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.socialBtn, styles.facebook]}
          disabled={!fbRequest}
          onPress={() => fbPromptAsync()}
        >
          <FontAwesome name="facebook" size={18} color="#fff" style={styles.iconLeft} />
          <Text style={[styles.socialText, { color: "#fff" }]}>Tiếp tục với Facebook</Text>
        </TouchableOpacity>
      </View>

      <Link href={"/(auth)/login" as any} style={styles.link} replace>
        Đã có tài khoản? Đăng nhập
      </Link>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  button: {
    height: 48,
    backgroundColor: "#111827",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  socialRow: {
    marginTop: 16,
    gap: 10,
  },
  socialBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    columnGap: 8,
    paddingHorizontal: 12,
  },
  google: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  facebook: {
    backgroundColor: "#1877F2",
  },
  socialText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "600",
  },
  iconLeft: { marginRight: 8 },
  link: {
    marginTop: 16,
    textAlign: "center",
    color: "#2563eb",
    fontSize: 14,
  },
});
