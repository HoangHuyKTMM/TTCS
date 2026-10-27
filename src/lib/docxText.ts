import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

export const MAX_WORD_FILE_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024

export function extractDocxText(bytes: Uint8Array): string {
  if (bytes.length > MAX_WORD_FILE_BYTES) throw new Error('File Word tối đa 10 MB.')

  let documentXml: Uint8Array | undefined
  try {
    const files = unzipSync(bytes, {
      filter: file => {
        if (file.name !== 'word/document.xml') return false
        if (file.originalSize > MAX_DOCUMENT_XML_BYTES) throw new Error('Nội dung Word quá lớn. Hãy chia thành các file nhỏ hơn.')
        return true
      },
    })
    documentXml = files['word/document.xml']
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Nội dung Word')) throw error
    throw new Error('Không đọc được file Word. Hãy mở bằng Word và lưu lại thành .docx không đặt mật khẩu.')
  }
  if (!documentXml) throw new Error('File không phải tài liệu Word .docx hợp lệ hoặc đã bị hỏng.')

  const xml = strFromU8(documentXml)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Không đọc được cấu trúc file Word. Hãy lưu lại thành .docx.')
  let nodes: Record<string, unknown>[]
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: true,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: false,
    })
    nodes = parser.parse(xml, true)
  } catch {
    throw new Error('Nội dung file Word bị hỏng. Hãy mở bằng Word và lưu lại thành .docx.')
  }

  const document = nodes.find(node => Array.isArray(node.document))?.document as Record<string, unknown>[] | undefined
  const body = document?.find(node => Array.isArray(node.body))?.body
  if (!Array.isArray(body)) throw new Error('Không tìm thấy nội dung chương trong file Word.')

  const parts: string[] = []
  function readNodes(children: unknown[], inText = false) {
    for (const node of children) {
      if (!node || typeof node !== 'object') continue
      for (const [tag, value] of Object.entries(node)) {
        if (tag === '#text') {
          if (inText && typeof value === 'string') parts.push(value)
        } else if (tag === 'tab') parts.push('\t')
        else if (tag === 'br' || tag === 'cr') parts.push('\n')
        // Ignore deleted revisions, images, properties, and field instructions.
        else if (['del', 'drawing', 'pict', 'pPr', 'rPr', 'instrText'].includes(tag)) continue
        else if (Array.isArray(value)) {
          readNodes(value, tag === 't')
          if (tag === 'p') parts.push('\n\n')
        }
      }
    }
  }
  readNodes(body)
  return parts.join('').trim()
}
