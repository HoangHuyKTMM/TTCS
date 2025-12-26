import React, { useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, Alert, Image } from 'react-native'
import { useRouter } from 'expo-router'
import * as Auth from '../../lib/auth'
import { apiCreateBook, apiFetchGenres } from '../../lib/api'
import * as ImagePicker from 'expo-image-picker'

export default function AuthorCreateScreen() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverUrl, setCoverUrl] = useState('')

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
    const selectedNames = availableGenres.filter(g => selectedGenreIds.includes(String(g.id || g.genre_id))).map(g => g.name).filter(Boolean)
    if (availableGenres.length > 0 && selectedNames.length === 0) return Alert.alert('Chọn thể loại có sẵn')
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
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Sáng tác truyện</Text>
        <Text style={styles.subtitle}>Dành cho tác giả. Bạn có thể tạo truyện mới và đăng chương.</Text>

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
            <Text style={[styles.label, { color: '#0f172a' }]}>Đã chọn: {availableGenres.filter(g => selectedGenreIds.includes(String(g.id || g.genre_id))).map(g => g.name).join(', ')}</Text>
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
          <Pressable style={styles.primaryBtn} onPress={handleCreateBook}>
            <Text style={styles.primaryText}>Tạo truyện</Text>
          </Pressable>
        </View>

        <Pressable style={styles.linkBtn} onPress={() => router.back()}>
          <Text style={styles.linkText}>← Quay lại</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fb' },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { color: '#6b7280', marginTop: 4 },
  card: { backgroundColor: '#fff', marginTop: 14, borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  label: { fontSize: 12, color: '#6b7280', marginTop: 6, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff' },
  primaryBtn: { backgroundColor: '#1088ff', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#f1f5f9', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  secondaryText: { color: '#0f172a', fontWeight: '700' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', maxWidth: 160 },
  chipActive: { backgroundColor: '#1088ff11', borderColor: '#1088ff' },
  chipText: { color: '#0f172a' },
  chipTextActive: { color: '#1088ff', fontWeight: '700' },
  linkBtn: { marginTop: 12, alignItems: 'center' },
  linkText: { color: '#1088ff', fontWeight: '700' },
  coverPreview: { width: '100%', height: 180, borderRadius: 10, backgroundColor: '#e5e7eb' },
})
