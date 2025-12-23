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

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const onLogin = () => {
    // local fallback (if you want to use local mock)
    // go to main tabs view instead of root so user lands in app
    router.replace('/(tabs)/explore')
  };

  async function handleLogin() {
    if (!email || !password) {
      setAlertConfig({ type: 'error', title: 'Lỗi', message: 'Vui lòng nhập email và mật khẩu' });
      setAlertVisible(true);
      return;
    }
    try {
      const res: any = await Auth.login(email, password)
      if (res && res.token) {
        // login success, navigate to explore
        router.replace('/(tabs)/explore')
      }
    } catch (err: any) {
      setAlertConfig({ type: 'error', title: 'Lỗi đăng nhập', message: err.message || 'Đăng nhập thất bại' });
      setAlertVisible(true);
    }
  }

  useEffect(() => {
    if (googleResponse?.type === "success") {
      // const token = googleResponse.authentication?.accessToken;
      router.replace('/(tabs)/explore')
    }
  }, [googleResponse]);

  useEffect(() => {
    if (fbResponse?.type === "success") {
      // const token = fbResponse.authentication?.accessToken;
      router.replace('/(tabs)/explore')
    }
  }, [fbResponse]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Đăng nhập" }} />
      <Text style={styles.title}>Đăng nhập</Text>

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

      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Đăng nhập</Text>
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

      <Link href={"/(auth)/register" as any} style={styles.link} replace>
        Chưa có tài khoản? Đăng ký
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
