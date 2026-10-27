import { useThemeStyles } from '../../components/AppTheme'
import { type AppColors } from '../../theme'
import React, { useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, Alert, Image, ActivityIndicator } from 'react-native'
import KeyboardSafeScroll from '../../components/KeyboardSafe'
import { useRouter } from 'expo-router'
import * as Auth from '../../lib/auth'
import { apiCreateBook, apiFetchGenres } from '../../lib/api'
import * as ImagePicker from 'expo-image-picker'

export default function AuthorCreateScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [creating, setCreating] = useState(false)

  const [availableGenres, setAvailableGenres] = useState<any[]>([])
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    Auth.getToken().then(t => { if (mounted) setToken(t) })
    Auth.getUser().then(u => { if (mounted) setUser(u) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!token || !user) return
    loadGenres()
  }, [token, user])

  async function loadGenres() {
    try {
      const res: any = await apiFetchGenres(token || undefined)
      if (Array.isArray(res)) setAvailableGenres(res)
    } catch (e) { /* ignore */ }
  }

  async function handleCreateBook() {
    if (!token) return Alert.alert('Cần đăng nhập')
    if (!title.trim()) return Alert.alert('Nhập tiêu đề')
    if (creating) return // Prevent double submission
    
    const selectedNames = availableGenres.filter(g => selectedGenreIds.includes(String(g.id || g.genre_id))).map(g => g.name).filter(Boolean)
    if (availableGenres.length > 0 && selectedNames.length === 0) return Alert.alert('Chọn thể loại có sẵn')
    
    setCreating(true)
    try {
      const payload = { title: title.trim(), genre: selectedNames.join(', ') || undefined, description: description.trim() || undefined, cover_url: coverUrl.trim() || undefined }
      const res: any = await apiCreateBook(payload, token)
      if (res && !res.error) {
        Alert.alert('Đã tạo truyện', res.title || 'Thành công')
        setTitle(''); setSelectedGenreIds([]); setDescription(''); setCoverUrl('')
      } else {
        if (res?.error === 'forbidden') {
          Alert.alert('Lỗi', 'Chỉ tài khoản Tác giả/Admin mới được tạo truyện. Vui lòng đăng nhập tài khoản phù hợp hoặc gửi yêu cầu trở thành tác giả.')
        } else if (res?.error === 'missing authorization' || res?.error === 'invalid authorization format') {
          Alert.alert('Lỗi', 'Phiên đăng nhập thiếu/không hợp lệ. Hãy đăng nhập lại.')
        } else {
          Alert.alert('Lỗi', String(res?.error || 'Không tạo được truyện'))
        }
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  function toggleGenre(id: string) {
    setSelectedGenreIds(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])
  }

  async function pickCoverFromDevice() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Thiếu quyền', 'Cần quyền truy cập thư viện ảnh để chọn bìa.')
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      })
      if (result.canceled) return
      const asset = result.assets && result.assets[0]
      if (!asset) return
      const mime = asset.mimeType || 'image/jpeg'
      if (asset.base64) {
        const dataUrl = `data:${mime};base64,${asset.base64}`
        setCoverUrl(dataUrl)
      } else if (asset.uri) {
        setCoverUrl(asset.uri)
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardSafeScroll style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Sáng tác truyện</Text>
        <Text style={styles.subtitle}>Dành cho tác giả. Bạn có thể tạo truyện mới và đăng chương.</Text>

        <Pressable style={[styles.secondaryBtn, { marginTop: 14 }]} onPress={() => router.push('/author/manage')}>
          <Text style={styles.secondaryText}>Quản lý truyện / Import chương Word</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tạo truyện mới</Text>
          <Text style={styles.label}>Tiêu đề</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Tiêu đề truyện" style={styles.input} />
          <Text style={styles.label}>Thể loại (chọn từ admin)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {availableGenres.length === 0 ? <Text style={styles.label}>Chưa tải được danh sách thể loại</Text> : null}
              {availableGenres.map((g) => {
                const gid = String(g.id || g.genre_id)
                const active = selectedGenreIds.includes(gid)
                return (
                  <Pressable key={gid} onPress={() => toggleGenre(gid)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{g.name}</Text>
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>
          {selectedGenreIds.length > 0 ? (
            <Text style={[styles.label, { color: colors.text }]}>Đã chọn: {availableGenres.filter(g => selectedGenreIds.includes(String(g.id || g.genre_id))).map(g => g.name).join(', ')}</Text>
          ) : null}
          <Text style={styles.label}>Ảnh bìa (URL)</Text>
          <TextInput value={coverUrl} onChangeText={setCoverUrl} placeholder="https://..." style={styles.input} />
          <Pressable onPress={pickCoverFromDevice} style={[styles.secondaryBtn, { marginTop: 8 }]}>
            <Text style={styles.secondaryText}>Chọn ảnh từ thiết bị</Text>
          </Pressable>
          {coverUrl ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Xem trước</Text>
              <Image source={{ uri: coverUrl }} style={styles.coverPreview} />
            </View>
          ) : null}
          <Text style={styles.label}>Mô tả</Text>
          <TextInput value={description} onChangeText={setDescription} placeholder="Giới thiệu ngắn" style={[styles.input, { height: 80 }]} multiline />
          <Pressable style={[styles.primaryBtn, creating && styles.primaryBtnDisabled]} onPress={handleCreateBook} disabled={creating}>
            {creating ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>Tạo truyện</Text>
            )}
          </Pressable>
        </View>

        <Pressable style={styles.linkBtn} onPress={() => router.back()}>
          <Text style={styles.linkText}>← Quay lại</Text>
        </Pressable>
      </KeyboardSafeScroll>
    </SafeAreaView>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: colors.surface, marginTop: 14, borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 8 },
  label: { fontSize: 12, color: colors.textSecondary, marginTop: 6, marginBottom: 4 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryText: { color: colors.onAccent, fontWeight: '700' },
  secondaryBtn: { backgroundColor: colors.surfaceSubtle, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight },
  secondaryText: { color: colors.text, fontWeight: '700' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight, backgroundColor: colors.bg, maxWidth: 160 },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.accentText, fontWeight: '700' },
  linkBtn: { marginTop: 12, alignItems: 'center' },
  linkText: { color: colors.accentText, fontWeight: '700' },
  coverPreview: { width: '100%', height: 180, borderRadius: 10, backgroundColor: colors.borderLight },
})
