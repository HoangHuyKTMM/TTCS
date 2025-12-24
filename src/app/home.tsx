import { StyleSheet, Text, View, TouchableOpacity, Image } from "react-native";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from 'react'
import { Ionicons } from "@expo/vector-icons";
import * as Auth from '../lib/auth'
import { SafeAreaView } from "react-native-safe-area-context";

export default function HomePage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)

  useEffect(() => {
    let mounted = true
    Auth.getToken().then(t => {
      if (!mounted) return
      setToken(t)
      // If user is logged in, redirect to explore immediately
      if (t) {
        router.replace('/(tabs)/explore')
      }
    })
    // also try to read saved user info for greeting
    Auth.getUser().then(u => { if (!mounted) return; setUser(u) })
    return () => { mounted = false }
  }, [])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo/Icon */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="book" size={48} color="#1088ff" />
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Reader App</Text>
          <Text style={styles.subtitle}>Khám phá thế giới truyện{'\n'}ngay trong tầm tay bạn</Text>
        </View>

        {/* Buttons */}
        <View style={styles.actions}>
          <Link href={'/(auth)/login' as any} asChild>
            <TouchableOpacity style={styles.buttonPrimary}>
              <Text style={styles.buttonPrimaryText}>Đăng nhập</Text>
            </TouchableOpacity>
          </Link>

          <Link href={'/(auth)/register' as any} asChild>
            <TouchableOpacity style={styles.buttonSecondary}>
              <Text style={styles.buttonSecondaryText}>Tạo tài khoản mới</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Skip */}
        <Link href={'/(tabs)/explore' as any} asChild>
          <TouchableOpacity style={styles.skipButton}>
            <Text style={styles.skipText}>Khám phá không cần đăng nhập</Text>
            <Ionicons name="arrow-forward" size={16} color="#1088ff" />
          </TouchableOpacity>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#f0f7ff",
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 24,
  },
  actions: {
    gap: 12,
  },
  buttonPrimary: {
    height: 52,
    backgroundColor: "#111827",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonSecondary: {
    height: 52,
    backgroundColor: "#f2f4f7",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSecondaryText: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "600",
  },
  skipButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    gap: 6,
  },
  skipText: {
    color: "#1088ff",
    fontSize: 14,
    fontWeight: "500",
  },
});
