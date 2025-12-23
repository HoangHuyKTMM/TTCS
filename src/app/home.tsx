import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from 'react'
import * as Auth from '../lib/auth'

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

  async function loadBooks(t: string) {
    // Not needed anymore - we redirect to explore if logged in
  }

  async function handleLogout() {
    await Auth.removeToken()
    await Auth.removeUser()
    setToken(null)
    setUser(null)
    router.replace('/(auth)/login')
  }
  
  // If logged in, this component won't render (redirected to explore)
  // So we only need to show login/register buttons

  return (
    <View style={styles.container}>
      <View style={styles.main}>
        <Text style={styles.title}>Reader App</Text>
        <Text style={styles.subtitle}>Chào mừng bạn đến với ứng dụng đọc truyện</Text>

        <View style={styles.actions}>
          <Link href={'/(auth)/login' as any} asChild>
            <TouchableOpacity style={styles.buttonPrimary}>
              <Text style={styles.buttonText}>Đăng nhập</Text>
            </TouchableOpacity>
          </Link>

          <Link href={'/(auth)/register' as any} asChild>
            <TouchableOpacity style={styles.buttonSecondary}>
              <Text style={styles.buttonSecondaryText}>Đăng ký</Text>
            </TouchableOpacity>
          </Link>

          <Link href={'/(tabs)/explore' as any} asChild>
            <TouchableOpacity style={styles.skipButton}>
              <Text style={styles.linkSkip}>Bỏ qua</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    padding: 24,
  },
  main: {
    flex: 1,
    justifyContent: "center",
    maxWidth: 960,
    marginHorizontal: "auto",
  },
  title: {
    fontSize: 40,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 18,
    color: "#38434D",
    marginTop: 8,
  },
  actions: {
    marginTop: 24,
    gap: 12,
  },
  buttonPrimary: {
    height: 48,
    backgroundColor: "#111827",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonSecondary: {
    height: 48,
    borderColor: "#111827",
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonSecondaryText: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "600",
  },
  linkSkip: {
    color: "#1088ff",
    fontSize: 14,
    textAlign: "center",
  },
  skipButton: {
    borderWidth: 1,
    borderColor: "#1088ff",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
});
