import { useThemeStyles } from '../components/AppTheme'
import { type AppColors } from '../theme'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import * as Auth from '../lib/auth'
import { API_BASE, apiChangePassword, apiGetMe } from '../lib/api'
import KeyboardSafeScroll from '../components/KeyboardSafe'

function formatDate(d?: string | null) {
  if (!d) return ''
  try {
    const dt = new Date(d)
    if (!Number.isFinite(dt.getTime())) return String(d)
    return dt.toLocaleString('vi-VN')
  } catch {
    return String(d)
  }
}

export default function AccountScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [changing, setChanging] = useState(false)

  const avatarUri = useMemo(() => {
    const raw = user?.avatar_url
    if (!raw) return null
    const s = String(raw)
    if (s.startsWith('http')) return s
    if (s.startsWith('/')) return `${API_BASE}${s}`
    return s
  }, [user])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const t = await Auth.getToken()
      setToken(t)
      if (!t) {
        setUser(null)
        return
      }
      const res: any = await apiGetMe(t)
      if (res && !res.error) setUser(res)
      else {
        // fallback to cached user if /me fails
        try { setUser(await Auth.getUser()) } catch { setUser(null) }
      }
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const renderRow = (label: string, value: any) => {
    const text = value === undefined || value === null ? '' : String(value)
    return (
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={2}>{text}</Text>
      </View>
    )
  }

  const handleChangePassword = useCallback(async () => {
    const t = token || await Auth.getToken()
    if (!t) {
      Alert.alert('Cần đăng nhập', 'Vui lòng đăng nhập để đổi mật khẩu.')
      return
    }
    if (!oldPass || !newPass || !confirmPass) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.')
      return
    }
    if (newPass.length < 6) {
      Alert.alert('Mật khẩu yếu', 'Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }
    if (newPass !== confirmPass) {
      Alert.alert('Không khớp', 'Mật khẩu mới và xác nhận mật khẩu không khớp.')
      return
    }

    setChanging(true)
    try {
      const res: any = await apiChangePassword(oldPass, newPass, t)
      if (res && res.error) {
        Alert.alert('Không thể đổi mật khẩu', res.message || res.error || 'Đổi mật khẩu thất bại.')
        return
      }
      Alert.alert('Thành công', 'Đã đổi mật khẩu.')
      setOldPass('')
      setNewPass('')
      setConfirmPass('')
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    } finally {
      setChanging(false)
    }
  }, [token, oldPass, newPass, confirmPass])

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardSafeScroll
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Text style={styles.title}>Tài khoản</Text>

        {!token && (
          <View style={styles.card}>
            <Text style={styles.muted}>Bạn chưa đăng nhập.</Text>
            <View style={{ marginTop: 10, flexDirection: 'row', gap: 10 }}>
              <Link href="/(auth)/login" asChild>
                <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Đăng nhập</Text></Pressable>
              </Link>
              <Link href="/(auth)/register" asChild>
                <Pressable style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Đăng ký</Text></Pressable>
              </Link>
            </View>
          </View>
        )}

        {token && user && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={{ fontSize: 18 }}>{String(user?.fullname || user?.name || 'U').slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user.fullname || user.name || ''}</Text>
                <Text style={styles.muted}>{user.email || ''}</Text>
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              {renderRow('Họ tên', user.fullname || user.name)}
              {renderRow('Email', user.email)}
              {renderRow('Vai trò', user.role)}
              {renderRow('VIP đến', user.vip_until ? formatDate(user.vip_until) : '')}
              {renderRow('Ngày tạo', user.created_at ? formatDate(user.created_at) : '')}
            </View>
          </View>
        )}

        {token && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>🔒 Đổi mật khẩu</Text>

            <Text style={styles.inputLabel}>Mật khẩu hiện tại</Text>
            <TextInput
              value={oldPass}
              onChangeText={setOldPass}
              placeholder="Nhập mật khẩu hiện tại"
              secureTextEntry
              style={styles.input}
            />

            <Text style={styles.inputLabel}>Mật khẩu mới</Text>
            <TextInput
              value={newPass}
              onChangeText={setNewPass}
              placeholder="Nhập mật khẩu mới (>= 6 ký tự)"
              secureTextEntry
              style={styles.input}
            />

            <Text style={styles.inputLabel}>Xác nhận mật khẩu mới</Text>
            <TextInput
              value={confirmPass}
              onChangeText={setConfirmPass}
              placeholder="Nhập lại mật khẩu mới"
              secureTextEntry
              style={styles.input}
            />

            <Pressable
              onPress={handleChangePassword}
              disabled={changing}
              style={[styles.primaryBtn, { marginTop: 12, opacity: changing ? 0.6 : 1 }]}
            >
              <Text style={styles.primaryBtnText}>{changing ? 'Đang đổi...' : 'Đổi mật khẩu'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardSafeScroll>
    </SafeAreaView>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },

  card: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accentSoft },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '800', color: colors.text },
  muted: { color: colors.textSecondary },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  inputLabel: { color: colors.textSecondary, marginTop: 10, marginBottom: 6, fontWeight: '700' },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, padding: 10, backgroundColor: colors.bg },

  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.surfaceSubtle },
  rowLabel: { color: colors.textSecondary, fontWeight: '700', width: 120 },
  rowValue: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },

  primaryBtn: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  primaryBtnText: { color: colors.onAccent, fontWeight: '800' },
  secondaryBtn: { backgroundColor: colors.borderLight, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  secondaryBtnText: { color: colors.text, fontWeight: '800' },
})
