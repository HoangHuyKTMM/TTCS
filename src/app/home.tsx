import { Image, StyleSheet, Text, View, Pressable, ScrollView, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Auth from '../lib/auth'
import { AppColors, radius } from '../theme'
import { useThemeStyles } from '../components/AppTheme'

export default function HomePage() {
  const router = useRouter()
  const { colors, styles } = useThemeStyles(createStyles)
  const { width, height } = useWindowDimensions()
  const compact = height < 740
  const artHeight = Math.min(width - 48, compact ? 230 : 400)
  useEffect(() => {
    let active = true
    Auth.getToken().then(token => { if (active && token) router.replace('/(tabs)/explore') })
    return () => { active = false }
  }, [router])

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={[styles.artSection, { height: artHeight, marginBottom: compact ? 24 : 40 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Image source={require('../assets/welcome-characters.png')} style={styles.characterArt} resizeMode="contain" accessible={false} />
          </View>
          <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Đăng nhập" onPress={() => router.push('/(auth)/login')} style={({ pressed }) => [styles.primaryButton, pressed && { backgroundColor: colors.accentDark }]}>
                <Text style={styles.primaryText}>Đăng nhập</Text><Ionicons name="arrow-forward" size={19} color={colors.onAccent} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Tạo tài khoản mới" onPress={() => router.push('/(auth)/register')} style={({ pressed }) => [styles.secondaryButton, pressed && { backgroundColor: colors.surfaceSubtle }]}><Text style={styles.secondaryText}>Tạo tài khoản mới</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Khám phá không cần đăng nhập" onPress={() => router.push('/(tabs)/explore')} style={({ pressed }) => [styles.guestButton, pressed && { opacity: 0.7 }]}><Text style={styles.guestText}>Khám phá không cần đăng nhập</Text><Ionicons name="arrow-forward" size={15} color={colors.textSecondary} /></Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 460, flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' },
  artSection: { alignItems: 'center', justifyContent: 'center' },
  characterArt: { width: '100%', height: '100%' },
  actions: { gap: 10 },
  primaryButton: { minHeight: 54, borderRadius: radius.lg, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 52, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  guestButton: { minHeight: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  guestText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
})
