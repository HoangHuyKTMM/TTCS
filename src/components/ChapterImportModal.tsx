import { useThemeStyles } from './AppTheme'
import { type AppColors } from '../theme'
import React, { useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { apiCreateChapter } from '../lib/api'
import { ImportedChapterDraft, readChapterFiles, submitImportedChapters } from '../lib/chapterImport'
import { KeyboardPush } from './KeyboardSafe'

type Props = {
  bookId: string
  token: string
  onClose: () => void
  onImported: () => void
}

export default function ChapterImportModal({ bookId, token, onClose, onImported }: Props) {
  const { colors, styles } = useThemeStyles(createStyles)

  const [drafts, setDrafts] = useState<ImportedChapterDraft[]>([])
  const [phase, setPhase] = useState<'reading' | 'publishing' | null>(null)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)

  async function chooseFiles() {
    if (busy.current) return
    busy.current = true
    setPhase('reading')
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'web'
          ? ['.txt', '.md', '.markdown', '.docx', '.doc', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']
          : ['text/*', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
        multiple: true,
        copyToCacheDirectory: true,
        base64: false,
      })
      if (result.canceled) return
      const loaded = await readChapterFiles(result.assets)
      setError(loaded.errors.join('\n'))
      setFeedback('')
      if (loaded.drafts.length) setDrafts(loaded.drafts)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể mở file. Vui lòng chọn lại.')
    } finally {
      busy.current = false
      setPhase(null)
    }
  }

  function updateDraft(id: string, field: 'title' | 'content', value: string) {
    setDrafts(previous => previous.map(draft => draft.id === id ? { ...draft, [field]: value } : draft))
  }

  async function publishChapters() {
    if (busy.current || !drafts.length) return
    busy.current = true
    setPhase('publishing')
    setCompleted(0)
    setTotal(drafts.length)
    setError('')
    setFeedback('')
    try {
      const result = await submitImportedChapters(
        drafts,
        payload => apiCreateChapter(bookId, payload, token),
        (_, count) => setCompleted(count),
      )
      const saved = new Set(result.savedIds)
      setDrafts(previous => previous.filter(draft => !saved.has(draft.id)))
      setError(result.error || '')
      if (saved.size) {
        setFeedback(`Đã thêm ${saved.size} chương: ${saved.size - result.pendingCount} đã xuất bản, ${result.pendingCount} chờ duyệt.${result.error ? ' Các chương chưa đăng được giữ lại để bạn sửa hoặc thử lại.' : ''}`)
        onImported()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể đăng chương.')
    } finally {
      busy.current = false
      setPhase(null)
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => { if (!busy.current) onClose() }}>
      <View style={styles.overlay}>
        <KeyboardPush style={styles.sheet}>
        <View style={styles.card}>
          <Text style={styles.heading}>Import chương từ file</Text>
          <Text style={styles.hint}>Chọn file Word .docx hoặc .txt/.md (UTF-8). Mỗi file là một chương, tối đa 80.000 ký tự. File được sắp theo tên; bạn có thể sửa trước khi đăng.</Text>
          <Pressable accessibilityRole="button" onPress={chooseFiles} disabled={!!phase} style={[styles.fileButton, !!phase && styles.disabled]}>
            <Text style={styles.fileButtonText}>{phase === 'reading' ? 'Đang đọc file…' : drafts.length ? 'Chọn lại các file' : 'Chọn các file văn bản'}</Text>
          </Pressable>
          <FlatList
            data={drafts}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            keyExtractor={draft => draft.id}
            ListHeaderComponent={(
              <View>
                {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
                {!!feedback && <Text style={styles.success}>{feedback}</Text>}
              </View>
            )}
            renderItem={({ item, index }) => (
              <View style={styles.draft}>
                <View style={styles.draftHeader}>
                  <Text style={styles.fileName} numberOfLines={2}>{index + 1}. {item.fileName}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Bỏ file ${item.fileName}`} disabled={!!phase} onPress={() => setDrafts(previous => previous.filter(draft => draft.id !== item.id))}>
                    <Text style={styles.removeText}>Bỏ</Text>
                  </Pressable>
                </View>
                <TextInput accessibilityLabel={`Tiêu đề chương từ ${item.fileName}`} value={item.title} editable={!phase} onChangeText={value => updateDraft(item.id, 'title', value)} placeholder="Tiêu đề chương" style={styles.input} />
                <TextInput accessibilityLabel={`Nội dung chương từ ${item.fileName}`} value={item.content} editable={!phase} onChangeText={value => updateDraft(item.id, 'content', value)} placeholder="Nội dung chương" multiline style={[styles.input, styles.contentInput]} />
                <Text style={styles.hint}>{item.content.trim().length.toLocaleString('vi-VN')} ký tự</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>{feedback ? 'Bạn có thể chọn file khác để thêm chương.' : 'Chưa chọn file văn bản.'}</Text>}
          />
          <Text style={styles.hint}>Chương nhập từ file được xét duyệt giống chương nhập thủ công.</Text>
          {phase === 'publishing' && <Text style={styles.progress}>Đang đăng: {completed}/{total} chương…</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => { if (!busy.current) onClose() }} disabled={!!phase} style={[styles.closeButton, !!phase && styles.disabled]}>
              <Text style={styles.closeText}>Đóng</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={publishChapters} disabled={!!phase || !drafts.length} style={[styles.publishButton, (!!phase || !drafts.length) && styles.disabled]}>
              {phase === 'publishing' ? <ActivityIndicator color={colors.onSecondary} /> : <Text style={styles.publishText}>Đăng {drafts.length || ''} chương</Text>}
            </Pressable>
          </View>
        </View>
        </KeyboardPush>
      </View>
    </Modal>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 560, height: '90%', flexGrow: 0, flex: 0 },
  card: { width: '100%', height: '100%', backgroundColor: colors.surface, borderRadius: 16, padding: 16 },
  heading: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  fileButton: { backgroundColor: colors.accentSoft, padding: 12, borderRadius: 10, alignItems: 'center', marginVertical: 12 },
  fileButtonText: { color: colors.accentText, fontWeight: '700' },
  list: { flex: 1, marginVertical: 8 },
  draft: { padding: 12, borderWidth: 1, borderColor: colors.borderLight, borderRadius: 12, marginBottom: 12 },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  fileName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  removeText: { color: colors.dangerText, fontWeight: '700', padding: 8 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, padding: 10, color: colors.text, backgroundColor: colors.surfaceSubtle, marginBottom: 8 },
  contentInput: { color: colors.text, height: 140, textAlignVertical: 'top' },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  error: { color: colors.dangerText, fontSize: 12, lineHeight: 18 },
  success: { color: colors.successText, fontSize: 13, lineHeight: 19 },
  progress: { color: colors.accentText, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  closeButton: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10, backgroundColor: colors.surfaceSubtle },
  closeText: { color: colors.text, fontWeight: '700' },
  publishButton: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10, backgroundColor: colors.secondary },
  publishText: { color: colors.onSecondary, fontWeight: '700' },
  disabled: { opacity: 0.5 },
})
