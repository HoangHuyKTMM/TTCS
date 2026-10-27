import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { toByteArray } from 'base64-js'
import { extractDocxText, MAX_WORD_FILE_BYTES } from './docxText'

export const MAX_CHAPTER_CHARACTERS = 80000
const MAX_TEXT_FILE_BYTES = MAX_CHAPTER_CHARACTERS * 4 + 3

export type ChapterImportAsset = {
  name: string
  uri: string
  size?: number
  file?: { text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }
}

export type ImportedChapterDraft = {
  id: string
  fileName: string
  title: string
  content: string
}

export function validateChapterDraft(draft: Pick<ImportedChapterDraft, 'title' | 'content'>): string | null {
  if (!draft.title.trim()) return 'Vui lòng nhập tiêu đề chương.'
  if (!draft.content.trim()) return 'File không có nội dung chương.'
  if (draft.content.trim().length > MAX_CHAPTER_CHARACTERS) return 'Mỗi chương tối đa 80.000 ký tự. Hãy chia nội dung thành các file nhỏ hơn.'
  if (/[\u0000\uFFFD]/.test(draft.content)) return 'Không đọc được văn bản. Hãy lưu file bằng mã hóa UTF-8 rồi chọn lại.'
  return null
}

function validateFileName(fileName: string) {
  if (/\.doc$/i.test(fileName)) throw new Error('File .doc đời cũ chưa được hỗ trợ. Hãy mở bằng Word, lưu thành .docx rồi nhập lại.')
  if (!/\.(txt|md|markdown|docx)$/i.test(fileName)) throw new Error('Chỉ hỗ trợ file .txt, .md, .markdown hoặc Word .docx.')
}

export function prepareChapterDraft(fileName: string, raw: string, id = fileName): ImportedChapterDraft {
  validateFileName(fileName)
  const draft = {
    id,
    fileName,
    title: fileName.replace(/\.(txt|md|markdown|docx)$/i, '').trim() || 'Chương mới',
    content: raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim(),
  }
  const error = validateChapterDraft(draft)
  if (error) throw new Error(error)
  return draft
}

export async function readChapterFiles(assets: readonly ChapterImportAsset[]) {
  const drafts: ImportedChapterDraft[] = []
  const errors: string[] = []
  const sorted = [...assets].sort((a, b) => a.name.localeCompare(b.name, 'vi-VN', { numeric: true, sensitivity: 'base' }))
  for (const [index, asset] of sorted.entries()) {
    try {
      validateFileName(asset.name)
      const isWord = /\.docx$/i.test(asset.name)
      const maxBytes = isWord ? MAX_WORD_FILE_BYTES : MAX_TEXT_FILE_BYTES
      if (asset.size !== undefined && asset.size > maxBytes) throw new Error(isWord ? 'File Word tối đa 10 MB.' : 'File quá lớn. Mỗi chương tối đa 80.000 ký tự.')
      let raw: string
      if (isWord) {
        let bytes: Uint8Array
        if (Platform.OS === 'web') {
          if (asset.file?.arrayBuffer) bytes = new Uint8Array(await asset.file.arrayBuffer())
          else {
            const response = await fetch(asset.uri)
            if (!response.ok) throw new Error('Không đọc được file Word đã chọn.')
            bytes = new Uint8Array(await response.arrayBuffer())
          }
        } else {
          const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
          bytes = toByteArray(base64)
        }
        raw = extractDocxText(bytes)
      } else if (Platform.OS === 'web') {
        if (asset.file) raw = await asset.file.text()
        else {
          const response = await fetch(asset.uri)
          if (!response.ok) throw new Error('Không đọc được file đã chọn.')
          raw = await response.text()
        }
      } else {
        raw = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 })
      }
      drafts.push(prepareChapterDraft(asset.name, raw, `${index}:${asset.uri}`))
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : 'Không đọc được file.'}`)
    }
  }
  return { drafts, errors }
}

type CreateChapterResult = {
  id?: string | number
  chapter_id?: string | number
  error?: string
  message?: string
  status?: string
  moderation?: { zone?: string }
} | null | undefined

function submissionError(result: CreateChapterResult): string {
  if (result?.error === 'network') return 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.'
  if (result?.error === 'content_too_large') return 'Mỗi chương tối đa 80.000 ký tự.'
  if (result?.error === 'forbidden' || result?.error === 'not your story') return 'Bạn không có quyền thêm chương vào truyện này.'
  return result?.message || 'Không thể đăng chương. Vui lòng thử lại.'
}

export async function submitImportedChapters(
  drafts: readonly ImportedChapterDraft[],
  create: (payload: { title: string; content: string }) => Promise<CreateChapterResult>,
  onSaved: (draft: ImportedChapterDraft, completed: number) => void = () => {},
) {
  const savedIds: string[] = []
  let pendingCount = 0
  // Validate every draft before creating any chapters.
  for (const draft of drafts) {
    const error = validateChapterDraft(draft)
    if (error) return { savedIds, pendingCount, error: `${draft.fileName}: ${error}` }
  }
  // Create sequentially so chapter numbers follow the preview order.
  for (const draft of drafts) {
    try {
      const result = await create({ title: draft.title.trim(), content: draft.content.trim() })
      if (!result || result.error || (result.id == null && result.chapter_id == null)) {
        return { savedIds, pendingCount, error: `${draft.fileName}: ${submissionError(result)}` }
      }
      savedIds.push(draft.id)
      if (result.status === 'pending_review' || ['yellow', 'red', 'unknown'].includes(result.moderation?.zone || '')) pendingCount++
      onSaved(draft, savedIds.length)
    } catch (error) {
      return { savedIds, pendingCount, error: `${draft.fileName}: ${error instanceof Error ? error.message : 'Không thể đăng chương.'}` }
    }
  }
  return { savedIds, pendingCount, error: null }
}
