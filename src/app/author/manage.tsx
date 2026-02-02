import React, { useCallback, useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, Text, Pressable, StyleSheet, Alert, FlatList, TextInput, Modal, ActivityIndicator } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useDebouncedNavigation } from '../../lib/navigation'
import * as Auth from '../../lib/auth'
import { apiFetchBooks, apiDeleteBook, apiUpdateBook, apiDeleteChapter, apiUpdateChapter, apiFetchBook, API_BASE } from '../../lib/api'

type Book = {
  id: string
  title: string
  description?: string
  chapters_count: number
  cover_url?: string
}

type Chapter = {
  id: string
  title: string
  content?: string
  chapter_no?: number
}

export default function AuthorManageScreen() {
  const router = useRouter()
  const { navigate } = useDebouncedNavigation()
  const [token, setToken] = useState<string | null>(null)
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [editingBook, setEditingBook] = useState<Book | null>(null)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editContent, setEditContent] = useState('')

  useEffect(() => {
    let mounted = true
    Auth.getToken().then(t => { if (mounted) setToken(t) })
    return () => { mounted = false }
  }, [])

  useFocusEffect(useCallback(() => {
    if (token) loadMyBooks()
  }, [token]))

  async function loadMyBooks() {
    if (!token) return
    setLoading(true)
    try {
      const res: any = await apiFetchBooks(token, { mine: true })
      if (Array.isArray(res)) {
        setBooks(res.map((b: any) => ({
          id: String(b.id || b.story_id),
          title: b.title || 'Không rõ',
          description: b.description || '',
          chapters_count: b.chapters_count || 0,
          cover_url: b.cover_url
        })))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadBookChapters(bookId: string) {
    if (!token) return
    try {
      const res: any = await apiFetchBook(bookId, token)
      if (res && Array.isArray(res.chapters)) {
        setChapters(res.chapters.map((c: any) => ({
          id: String(c.id || c.chapter_id),
          title: c.title || 'Chương',
          content: c.content || '',
          chapter_no: c.chapter_no || 0
        })))
      }
    } catch (e) {
      console.error(e)
    }
  }

  function handleSelectBook(book: Book) {
    setSelectedBook(book)
    loadBookChapters(book.id)
  }

  function handleEditBook(book: Book) {
    setEditingBook(book)
    setEditTitle(book.title)
    setEditDescription(book.description || '')
  }

  async function handleSaveBook() {
    if (!token || !editingBook) return
    try {
      await apiUpdateBook(editingBook.id, { title: editTitle, description: editDescription }, token)
      Alert.alert('Thành công', 'Đã cập nhật truyện')
      setEditingBook(null)
      loadMyBooks()
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || String(e))
    }
  }

  async function handleDeleteBook(book: Book) {
    if (!token) return
    Alert.alert(
      'Xác nhận xóa',
      `Xóa truyện "${book.title}"? Hành động này không thể hoàn tác.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiDeleteBook(book.id, token)
              Alert.alert('Đã xóa', 'Truyện đã bị xóa')
              loadMyBooks()
              if (selectedBook?.id === book.id) {
                setSelectedBook(null)
                setChapters([])
              }
            } catch (e: any) {
              Alert.alert('Lỗi', e.message || String(e))
            }
          }
        }
      ]
    )
  }

  function handleEditChapter(chapter: Chapter) {
    setEditingChapter(chapter)
    setEditTitle(chapter.title)
    setEditContent(chapter.content || '')
  }

  async function handleSaveChapter() {
    if (!token || !editingChapter || !selectedBook) return
    try {
      await apiUpdateChapter(selectedBook.id, editingChapter.id, { title: editTitle, content: editContent }, token)
      Alert.alert('Thành công', 'Đã cập nhật chương')
      setEditingChapter(null)
      loadBookChapters(selectedBook.id)
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || String(e))
    }
  }

  async function handleDeleteChapter(chapter: Chapter) {
    if (!token || !selectedBook) return
    Alert.alert(
      'Xác nhận xóa',
      `Xóa chương "${chapter.title}"?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiDeleteChapter(selectedBook.id, chapter.id, token)
              Alert.alert('Đã xóa', 'Chương đã bị xóa')
              loadBookChapters(selectedBook.id)
            } catch (e: any) {
              Alert.alert('Lỗi', e.message || String(e))
            }
          }
        }
      ]
    )
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={styles.title}>Đăng nhập để quản lý truyện</Text>
          <Pressable onPress={() => navigate('/(auth)/login')} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Đăng nhập</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (selectedBook) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => { setSelectedBook(null); setChapters([]) }} style={styles.backBtn}>
            <Text style={{ fontSize: 18 }}>←</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{selectedBook.title}</Text>
        </View>
        
        <FlatList
          data={chapters}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.chapterItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.chapterTitle}>{item.title}</Text>
                <Text style={styles.chapterMeta}>{item.content?.length || 0} ký tự</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => handleEditChapter(item)} style={styles.editBtn}>
                  <Text style={styles.editBtnText}>Sửa</Text>
                </Pressable>
                <Pressable onPress={() => handleDeleteChapter(item)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Xóa</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={{ color: '#64748b', textAlign: 'center' }}>Chưa có chương nào</Text>}
        />

        {/* Edit Chapter Modal */}
        <Modal visible={!!editingChapter} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Sửa chương</Text>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Tiêu đề chương"
                style={styles.input}
              />
              <TextInput
                value={editContent}
                onChangeText={setEditContent}
                placeholder="Nội dung chương"
                multiline
                numberOfLines={10}
                style={[styles.input, { height: 200, textAlignVertical: 'top' }]}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable onPress={() => setEditingChapter(null)} style={[styles.secondaryBtn, { flex: 1 }]}>
                  <Text style={styles.secondaryBtnText}>Hủy</Text>
                </Pressable>
                <Pressable onPress={handleSaveChapter} style={[styles.primaryBtn, { flex: 1 }]}>
                  <Text style={styles.primaryBtnText}>Lưu</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Quản lý truyện</Text>
        <Pressable onPress={() => navigate('/author/create')} style={styles.importBtn}>
          <Text style={styles.importBtnText}>Tạo truyện</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => handleSelectBook(item)} style={styles.bookItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bookTitle}>{item.title}</Text>
                <Text style={styles.bookMeta}>{item.chapters_count} chương</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => handleEditBook(item)} style={styles.editBtn}>
                  <Text style={styles.editBtnText}>Sửa</Text>
                </Pressable>
                <Pressable onPress={() => handleDeleteBook(item)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Xóa</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#64748b', marginBottom: 16 }}>Chưa có truyện nào</Text>
              <Pressable onPress={() => navigate('/author/create')} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Tạo truyện mới</Text>
              </Pressable>
            </View>
          }
        />
      )}

      {/* Edit Book Modal */}
      <Modal visible={!!editingBook} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sửa truyện</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Tiêu đề truyện"
              style={styles.input}
            />
            <TextInput
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Mô tả"
              multiline
              numberOfLines={4}
              style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setEditingBook(null)} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Text style={styles.secondaryBtnText}>Hủy</Text>
              </Pressable>
              <Pressable onPress={handleSaveBook} style={[styles.primaryBtn, { flex: 1 }]}>
                <Text style={styles.primaryBtnText}>Lưu</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f9fc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb'
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a', flex: 1 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2
  },
  bookTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  bookMeta: { fontSize: 13, color: '#64748b' },
  chapterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  chapterTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a', marginBottom: 2 },
  chapterMeta: { fontSize: 12, color: '#64748b' },
  editBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  editBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  deleteBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  importBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center'
  },
  importBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#1088ff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  secondaryBtnText: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#f9fafb',
    marginBottom: 12
  }
})
