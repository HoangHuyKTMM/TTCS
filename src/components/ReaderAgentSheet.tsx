import { useThemeStyles } from './AppTheme'
import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { apiChat } from '../lib/api'
import * as Auth from '../lib/auth'
import StoryFlashcards, { recommendationLead, type SuggestionBook } from './StoryFlashcards'
import ChatSessionBar, { type ChatHistoryMessage } from './ChatSessionBar'
import TypingDots from './TypingDots'
import { radius, type AppColors } from '../theme'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; books?: SuggestionBook[]; intent?: 'recommend' | 'recap' }

const RECAP_LOGIN_MESSAGE = 'Đăng nhập để dùng tóm tắt truyện bằng AI.'

function sheetWelcome(bookTitle: string | null | undefined, chapterNo: number, signedIn: boolean) {
  const place = bookTitle
    ? `Bạn đang đọc ${bookTitle}, chương ${chapterNo}.`
    : `Bạn đang ở chương ${chapterNo}.`
  if (!signedIn) return `${place} Gợi ý truyện vẫn dùng được. ${RECAP_LOGIN_MESSAGE}`
  return bookTitle
    ? `${place} Hỏi mình bất cứ điều gì. Mình tóm tắt chương bạn đã đọc, hoặc gợi ý truyện cùng vibe.`
    : `${place} Hỏi mình bất cứ điều gì. Mình tóm tắt chương bạn đã đọc, hoặc gợi ý truyện.`
}

type Props = {
  visible: boolean
  onClose: () => void
  bookId: string
  chapterNo: number
  bookTitle?: string | null
  autoRecap?: boolean
}

export default function ReaderAgentSheet({ visible, onClose, bookId, chapterNo, bookTitle, autoRecap }: Props) {
  const { colors, styles } = useThemeStyles(createStyles)

  const router = useRouter()
  const autoRecapKey = useRef('')
  const conversationIdRef = useRef<string | number | null>(null)
  const conversationTokenRef = useRef<string | undefined>(undefined)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])

  useEffect(() => {
    let alive = true
    conversationIdRef.current = null
    conversationTokenRef.current = undefined
    setInput('')
    setMessages([{ id: 'welcome', role: 'assistant', content: sheetWelcome(bookTitle, chapterNo, true) }])
    Auth.getToken().then((token) => {
      if (!alive || token) return
      setMessages((prev) => {
        if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev
        return [{ id: 'welcome', role: 'assistant', content: sheetWelcome(bookTitle, chapterNo, false) }]
      })
    })
    return () => { alive = false }
  }, [bookId, chapterNo])

  useEffect(() => {
    if (!visible) return
    let alive = true
    Auth.getToken().then((token) => {
      if (!alive) return
      setMessages((prev) => {
        if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev
        const content = sheetWelcome(bookTitle, chapterNo, Boolean(token))
        if (prev[0].content === content) return prev
        return [{ id: 'welcome', role: 'assistant', content }]
      })
    })
    return () => { alive = false }
  }, [visible, bookId, chapterNo, bookTitle])

  const askLoginForRecap = () => {
    Alert.alert('Cần đăng nhập', RECAP_LOGIN_MESSAGE, [
      { text: 'Để sau', style: 'cancel' },
      { text: 'Đăng nhập', onPress: () => { onClose(); router.push('/(auth)/login' as any) } },
    ])
  }

  const send = async (text: string, intent?: 'recap' | 'recommend') => {
    const content = String(text || '').trim()
    if (!content || loading) return
    const token = await Auth.getToken()
    if (intent === 'recap' && !token) {
      askLoginForRecap()
      return
    }
    setMessages((prev) => [...prev, { id: `${Date.now()}`, role: 'user', content }])
    setInput('')
    setLoading(true)
    try {
      const data: any = await apiChat({
        message: content,
        intent,
        book_id: bookId || undefined,
        chapter_no: chapterNo > 0 ? chapterNo : undefined,
        conversation_id: conversationIdRef.current ?? undefined,
        conversation_token: conversationTokenRef.current,
      }, token || undefined)
      if (data && data.conversation_id) conversationIdRef.current = data.conversation_id
      if (data?.conversation_token) conversationTokenRef.current = data.conversation_token
      if (data?.error === 'conversation_not_found') {
        conversationIdRef.current = null
        conversationTokenRef.current = undefined
      }
      if (data?.error === 'login_required') {
        askLoginForRecap()
        setMessages((prev) => [...prev, {
          id: `${Date.now()}-login`,
          role: 'assistant',
          content: data?.message || RECAP_LOGIN_MESSAGE,
        }])
        return
      }
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-a`,
        role: 'assistant',
        content: data?.reply || data?.message || 'Mình chưa trả lời được.',
        books: Array.isArray(data?.books) ? data.books : [],
        intent: data?.intent === 'recap' || data?.intent === 'recommend' ? data.intent : undefined,
      }])
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-e`,
        role: 'assistant',
        content: 'Đã có lỗi. Thử lại sau.',
      }])
    } finally {
      setLoading(false)
    }
  }

  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!visible || !autoRecap) return
    const key = `${bookId}:${chapterNo}`
    if (autoRecapKey.current === key) return
    autoRecapKey.current = key
    const timer = setTimeout(() => { void sendRef.current('Tóm tắt các chương đã đọc', 'recap') }, 0)
    return () => clearTimeout(timer)
  }, [visible, autoRecap, bookId, chapterNo])

  const startNewSession = () => {
    conversationIdRef.current = null
    conversationTokenRef.current = undefined
    setInput('')
    setMessages([{ id: 'welcome', role: 'assistant', content: sheetWelcome(bookTitle, chapterNo, true) }])
    Auth.getToken().then((token) => {
      setMessages((prev) => {
        if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev
        return [{ id: 'welcome', role: 'assistant', content: sheetWelcome(bookTitle, chapterNo, Boolean(token)) }]
      })
    })
  }

  const openSession = (session: { id: string; messages: ChatHistoryMessage[] }) => {
    conversationIdRef.current = session.id
    conversationTokenRef.current = undefined
    const restored: Msg[] = session.messages
      .filter((item) => item.content)
      .map((item) => ({ id: item.id, role: item.role, content: item.content }))
    setMessages(restored.length ? restored : [{ id: 'welcome', role: 'assistant', content: sheetWelcome(bookTitle, chapterNo, true) }])
  }

  if (!visible) return null

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.dismiss} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sparkle}>
            <Ionicons name="sparkles" size={16} color={colors.onAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>Trợ lý đọc</Text>
            <Text style={styles.sheetSub} numberOfLines={1}>
              {bookTitle ? `${bookTitle} · Chương ${chapterNo}` : `Chương ${chapterNo}`}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        </View>
        <ChatSessionBar disabled={loading} onNewSession={startNewSession} onOpenSession={openSession} />
        <ScrollView style={styles.messages} contentContainerStyle={{ paddingBottom: 8 }}>
          {messages.map((item) => {
            const suggestions = item.role === 'assistant' && item.intent !== 'recap' ? (item.books || []) : []
            const showCards = suggestions.length > 0
            return (
            <View key={item.id} style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble, showCards && styles.cardBubble]}>
              <Text style={item.role === 'user' ? styles.userText : styles.aiText}>
                {showCards ? recommendationLead(item.content) : item.content}
              </Text>
              {showCards ? (
                <StoryFlashcards
                  compact
                  books={suggestions.slice(0, 4)}
                  onOpen={(id) => {
                    onClose()
                    router.push({ pathname: '/book/[id]', params: { id } } as any)
                  }}
                />
              ) : null}
            </View>
            )
          })}
          {loading ? (
            <View style={[styles.bubble, styles.aiBubble]}>
              <TypingDots color={colors.textMuted} />
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.chips}>
          <Pressable style={styles.chip} disabled={loading} onPress={() => send('Tóm tắt các chương đã đọc', 'recap')}>
            <Text style={styles.chipText}>Tóm tắt chương đã đọc</Text>
          </Pressable>
          <Pressable style={styles.chip} disabled={loading} onPress={() => send('Gợi ý truyện cùng vibe', 'recommend')}>
            <Text style={styles.chipText}>Gợi ý truyện</Text>
          </Pressable>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Hỏi về truyện này..."
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
          />
          <Pressable style={styles.send} disabled={loading} onPress={() => send(input)}>
            <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.4)',
  },
  dismiss: { flex: 1 },
  sheet: {
    height: '68%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sparkle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  messages: { flex: 1 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: '92%' },
  userBubble: { backgroundColor: colors.accent, alignSelf: 'flex-end' },
  aiBubble: { backgroundColor: colors.bg, alignSelf: 'flex-start' },
  userText: { color: colors.onAccent, lineHeight: 20 },
  aiText: { color: colors.text, lineHeight: 20 },
  cardBubble: { maxWidth: '100%', alignSelf: 'stretch' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { color: colors.accentDark, fontWeight: '700', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    borderRadius: radius.full,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, color: colors.text, paddingVertical: 8, fontSize: 15 },
  send: {
    backgroundColor: colors.accent,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
