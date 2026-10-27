import React, { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiGetChatMessages, apiListChatSessions } from '../lib/api'
import * as Auth from '../lib/auth'
import { radius, type AppColors } from '../theme'
import { useThemeStyles } from './AppTheme'

export type ChatHistoryMessage = { id: string; role: 'user' | 'assistant'; content: string }

type Props = {
  disabled?: boolean
  onNewSession: () => void
  onOpenSession: (session: { id: string; messages: ChatHistoryMessage[] }) => void
}

export default function ChatSessionBar({ disabled, onNewSession, onOpenSession }: Props) {
  const { colors, styles } = useThemeStyles(createStyles)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [sessions, setSessions] = useState<{ id: string; title: string; preview: string }[]>([])

  const showHistory = async () => {
    if (disabled) return
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoading(true)
    setNote('')
    try {
      const token = await Auth.getToken()
      if (!token) {
        setSessions([])
        setNote('Đăng nhập để xem lịch sử chat đã lưu.')
        return
      }
      const data: any = await apiListChatSessions(token)
      const rows = Array.isArray(data?.conversations) ? data.conversations : []
      setSessions(rows.map((row: any) => ({
        id: String(row.id),
        title: String(row.title || row.preview || 'Cuộc trò chuyện'),
        preview: String(row.preview || ''),
      })))
      if (!rows.length) setNote('Chưa có cuộc trò chuyện nào.')
    } catch {
      setSessions([])
      setNote('Không tải được lịch sử chat.')
    } finally {
      setLoading(false)
    }
  }

  const openSession = async (id: string) => {
    if (disabled) return
    setLoading(true)
    try {
      const token = await Auth.getToken()
      if (!token) {
        setNote('Đăng nhập để xem lịch sử chat đã lưu.')
        return
      }
      const data: any = await apiGetChatMessages(id, token)
      const messages = Array.isArray(data?.messages) ? data.messages : []
      onOpenSession({
        id,
        messages: messages.map((item: any) => ({
          id: String(item.id),
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content || ''),
        })),
      })
      setOpen(false)
    } catch {
      setNote('Không mở được cuộc trò chuyện này.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View>
      <View style={styles.row}>
        <Pressable style={styles.btn} disabled={disabled} onPress={() => { setOpen(false); onNewSession() }}>
          <Ionicons name="add" size={16} color={colors.accentText} />
          <Text style={styles.btnText}>Phiên mới</Text>
        </Pressable>
        <Pressable style={styles.btn} disabled={disabled} onPress={() => { void showHistory() }}>
          <Ionicons name="time-outline" size={16} color={colors.accentText} />
          <Text style={styles.btnText}>Lịch sử</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={styles.panel}>
          {loading ? <ActivityIndicator color={colors.accentText} style={{ marginVertical: 8 }} /> : null}
          {!!note && !loading ? <Text style={styles.note}>{note}</Text> : null}
          <ScrollView style={{ maxHeight: 168 }} nestedScrollEnabled>
            {sessions.map((session) => (
              <Pressable key={session.id} style={styles.item} onPress={() => { void openSession(session.id) }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{session.title}</Text>
                {!!session.preview && session.preview !== session.title ? (
                  <Text style={styles.itemPreview} numberOfLines={1}>{session.preview}</Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
  },
  btnText: { color: colors.accentText, fontSize: 12, fontWeight: '700' },
  panel: {
    marginBottom: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.bg,
    padding: 8,
  },
  note: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  item: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
  itemTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  itemPreview: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
})
