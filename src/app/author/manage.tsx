import { useThemeStyles } from '../../components/AppTheme'
import { type AppColors } from '../../theme'
import React, { useCallback, useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, Text, Pressable, StyleSheet, Alert, FlatList, TextInput, Modal, ActivityIndicator } from 'react-native'
import { KeyboardModalFrame } from '../../components/KeyboardSafe'
import { useRouter, useFocusEffect } from 'expo-router'
import { useDebouncedNavigation } from '../../lib/navigation'
import * as Auth from '../../lib/auth'
import { apiFetchBooks, apiDeleteBook, apiUpdateBook, apiCreateChapter, apiDeleteChapter, apiUpdateChapter, apiFetchBook, apiCheckDuplicate, API_BASE } from '../../lib/api'
import ChapterImportModal from '../../components/ChapterImportModal'
import CustomAlert from '../../components/CustomAlert'

function checkedResult(result: any) {
  if (!result || result.error) throw new Error(result?.message || result?.error || 'Không thể lưu thay đổi. Vui lòng thử lại.')
  return result
}

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
  status?: string
}

export default function AuthorManageScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

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
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const [actionError, setActionError] = useState('')
  const errorAlert = <CustomAlert visible={!!actionError} type="error" title="Không thể thực hiện" message={actionError} onDismiss={() => setActionError('')} />

  // State for creating new chapter with AI auto-moderation
  const [isAddingChapter, setIsAddingChapter] = useState(false)
  const [newChapterTitle, setNewChapterTitle] = useState('')
  const [newChapterContent, setNewChapterContent] = useState('')
  const [savingNewChapter, setSavingNewChapter] = useState(false)
  const [isImportingChapters, setIsImportingChapters] = useState(false)

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
          chapter_no: c.chapter_no || 0,
          status: c.status || 'published'
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
      checkedResult(await apiUpdateBook(editingBook.id, { title: editTitle, description: editDescription }, token))
      Alert.alert('Thành công', 'Đã cập nhật truyện')
      setEditingBook(null)
      loadMyBooks()
    } catch (e: any) {
      setActionError(e.message || String(e))
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
              checkedResult(await apiDeleteBook(book.id, token))
              Alert.alert('Đã xóa', 'Truyện đã bị xóa')
              loadMyBooks()
              if (selectedBook?.id === book.id) {
                setSelectedBook(null)
                setChapters([])
              }
            } catch (e: any) {
              setActionError(e.message || String(e))
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

  async function handleCreateNewChapter() {
    if (!token || !selectedBook) return
    if (!newChapterTitle.trim() || !newChapterContent.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập cả tiêu đề và nội dung chương.')
      return
    }
    setSavingNewChapter(true)
    try {
      const res: any = await apiCreateChapter(
        selectedBook.id,
        { title: newChapterTitle.trim(), content: newChapterContent.trim() },
        token
      )
      if (res && res.error) {
        throw new Error(res.message || 'Không thể đăng chương.')
      }

      // AI auto-scanned on publish: check if flagged for Human-in-the-loop review
      if (res && (res.status === 'pending_review' || (res.moderation && (res.moderation.zone === 'yellow' || res.moderation.zone === 'red')))) {
        const pct = res.moderation?.zone === 'unknown' ? '' : res.moderation?.similarity_pct || ''
        Alert.alert(
          'Đã gửi chương (Chờ Admin duyệt)',
          `Chương đã được lưu và cần quản trị viên đối chiếu${pct ? ` (${pct}% Jaccard)` : ''}. Điểm đối chiếu không phải phần trăm đạo văn.\n\nChương đã được chuyển vào hàng chờ duyệt của Quản trị viên (Human-in-the-loop) trước khi hiển thị công khai.`
        )
      } else {
        Alert.alert('Thành công', 'Đăng chương thành công và đã xuất bản!')
      }

      setNewChapterTitle('')
      setNewChapterContent('')
      setIsAddingChapter(false)
      loadBookChapters(selectedBook.id)
    } catch (e: any) {
      setActionError(e?.message || String(e))
    } finally {
      setSavingNewChapter(false)
    }
  }

  async function handleSaveChapter() {
    if (!token || !editingChapter || !selectedBook) return
    try {
      const res: any = checkedResult(await apiUpdateChapter(selectedBook.id, editingChapter.id, { title: editTitle, content: editContent }, token))
      if (res && (res.status === 'pending_review' || (res.moderation && (res.moderation.zone === 'yellow' || res.moderation.zone === 'red')))) {
        const pct = res.moderation?.zone === 'unknown' ? '' : res.moderation?.similarity_pct || ''
        Alert.alert(
          'Đã lưu (Chờ Admin duyệt)',
          `Chương đã được lưu và cần quản trị viên đối chiếu${pct ? ` (${pct}% Jaccard)` : ''}. Điểm đối chiếu không phải phần trăm đạo văn.\n\nChương đã được chuyển sang trạng thái "Chờ duyệt AI" để Quản trị viên thẩm định (Human-in-the-loop).`
        )
      } else {
        Alert.alert('Thành công', 'Đã cập nhật chương thành công')
      }
      setEditingChapter(null)
      loadBookChapters(selectedBook.id)
    } catch (e: any) {
      setActionError(e.message || String(e))
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
              checkedResult(await apiDeleteChapter(selectedBook.id, chapter.id, token))
              Alert.alert('Đã xóa', 'Chương đã bị xóa')
              loadBookChapters(selectedBook.id)
            } catch (e: any) {
              setActionError(e.message || String(e))
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
          <Pressable onPress={() => setIsAddingChapter(true)} style={styles.addChapterBtn}>
            <Text style={styles.addChapterBtnText}>+ Đăng chương</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setIsImportingChapters(true)} style={[styles.secondaryBtn, { marginHorizontal: 16, marginTop: 12 }]}>
          <Text style={styles.secondaryBtnText}>Import Word / văn bản (.docx, .txt, .md)</Text>
        </Pressable>

        {isImportingChapters && (
          <ChapterImportModal
            bookId={selectedBook.id}
            token={token}
            onClose={() => setIsImportingChapters(false)}
            onImported={() => {
              loadBookChapters(selectedBook.id)
              loadMyBooks()
            }}
          />
        )}

        <FlatList
          data={chapters}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => {
            const isPending = item.status === 'pending_review'
            const isRejected = item.status === 'rejected'
            const statusLabel = isPending ? 'Chờ duyệt AI' : isRejected ? 'Bị từ chối' : 'Đã duyệt'
            const statusBg = isPending ? colors.goldSoft : isRejected ? colors.dangerSoft : colors.successSoft
            const statusColor = isPending ? colors.warning : isRejected ? colors.danger : colors.success

            return (
              <View style={styles.chapterItem}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.chapterTitle}>{item.title}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>
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
            )
          }}
          ListEmptyComponent={<Text style={{ color: colors.textSecondary, textAlign: 'center' }}>Chưa có chương nào</Text>}
        />

        {/* Create Chapter Modal with direct AI auto-moderation */}
        <Modal visible={isAddingChapter} animationType="slide" transparent>
          <KeyboardModalFrame>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Đăng chương mới</Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
                Hệ thống AI sẽ tự động phân tích trùng lặp ngay khi đăng để Quản trị viên duyệt (Human-in-the-loop).
              </Text>
              <TextInput
                value={newChapterTitle}
                onChangeText={setNewChapterTitle}
                placeholder="Tiêu đề chương (VD: Chương 1: Khởi đầu)"
                style={styles.input}
              />
              <TextInput
                value={newChapterContent}
                onChangeText={setNewChapterContent}
                placeholder="Nội dung chương truyện..."
                multiline
                numberOfLines={10}
                style={[styles.input, { height: 200, textAlignVertical: 'top' }]}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable onPress={() => setIsAddingChapter(false)} style={[styles.secondaryBtn, { flex: 1 }]}>
                  <Text style={styles.secondaryBtnText}>Hủy</Text>
                </Pressable>
                <Pressable onPress={handleCreateNewChapter} disabled={savingNewChapter} style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.secondary }]}>
                  {savingNewChapter ? (
                    <ActivityIndicator size="small" color={colors.onDark} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Đăng chương</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardModalFrame>
        </Modal>

        {/* Edit Chapter Modal with direct AI auto-moderation */}
        <Modal visible={!!editingChapter} animationType="slide" transparent>
          <KeyboardModalFrame>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Sửa chương</Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
                Hệ thống AI sẽ tự động quét trùng lặp khi bạn lưu để gửi Quản trị viên duyệt nếu cần.
              </Text>
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
                  <Text style={styles.primaryBtnText}>Lưu thay đổi</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardModalFrame>
        </Modal>
        {errorAlert}
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
          <ActivityIndicator size="large" color={colors.accentText} />
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
              <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>Chưa có truyện nào</Text>
              <Pressable onPress={() => navigate('/author/create')} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Tạo truyện mới</Text>
              </Pressable>
            </View>
          }
        />
      )}

      {/* Edit Book Modal */}
      <Modal visible={!!editingBook} animationType="slide" transparent>
        <KeyboardModalFrame>
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
        </KeyboardModalFrame>
      </Modal>
      {errorAlert}
    </SafeAreaView>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, flex: 1 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2
  },
  bookTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  bookMeta: { fontSize: 13, color: colors.textSecondary },
  chapterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  chapterTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  chapterMeta: { fontSize: 12, color: colors.textSecondary },
  editBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  editBtnText: { color: colors.onDark, fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  deleteBtnText: { color: colors.onDark, fontSize: 13, fontWeight: '700' },
  importBtn: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center'
  },
  importBtnText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  primaryBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalContent: {
    backgroundColor: colors.surface,
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
    color: colors.text,
    marginBottom: 16
  },
  input: { color: colors.text,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 12
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  statusBadgeText: { color: colors.text,
    fontSize: 11,
    fontWeight: '700'
  },
  aiCheckBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe'
  },
  aiCheckBtnText: {
    color: '#4f46e5',
    fontSize: 12,
    fontWeight: '700'
  },
  addChapterBtn: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  addChapterBtnText: {
    color: colors.onDark,
    fontSize: 13,
    fontWeight: '700'
  }
})
