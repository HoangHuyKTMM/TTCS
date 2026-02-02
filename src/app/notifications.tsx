import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link, useRouter } from 'expo-router'
import { useDebouncedNavigation } from '../lib/navigation'
import * as Auth from '../lib/auth'
import { API_BASE, apiFetchNotifications, apiMarkNotificationsSeen, type NotificationItem } from '../lib/api'

type UiNotification = {
  id: string
  type: 'like' | 'follow' | 'donation' | 'rank' | 'new_story' | 'new_chapter'
  created_at: string
  actorName: string
  actorAvatar: string | null
  storyId: string | null
  storyTitle: string | null
  chapterId: string | null
  chapterNo: number | null
  chapterTitle: string | null
  rank: number | null
  coins: number | null
  message: string | null
  isUnread: boolean
}

function timeAgo(iso: string) {
  try {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const diff = Date.now() - t
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return `${sec}s trước`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} phút trước`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} giờ trước`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day} ngày trước`
    const week = Math.floor(day / 7)
    if (week < 4) return `${week} tuần trước`
    const month = Math.floor(day / 30)
    if (month < 12) return `${month} tháng trước`
    const year = Math.floor(day / 365)
    return `${year} năm trước`
  } catch {
    return ''
  }
}

export default function NotificationsScreen() {
  const router = useRouter()
  const { navigate } = useDebouncedNavigation()
  const [token, setToken] = useState<string | null>(null)
  const [items, setItems] = useState<UiNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    setRefreshing(true)
    try {
      const t = await Auth.getToken()
      setToken(t)
      if (!t) {
        setItems([])
        return
      }
      const res: any = await apiFetchNotifications(t, { limit: 50, offset: 0 })
      if (!Array.isArray(res)) {
        setItems([])
        return
      }
      const mapped: UiNotification[] = (res as NotificationItem[]).map((it: any) => {
        const rawAvatar = it.actor_avatar_url
        const actorAvatar = rawAvatar
          ? (String(rawAvatar).startsWith('http') ? String(rawAvatar) : `${API_BASE}${rawAvatar}`)
          : null
        return {
          id: String(it.id),
          type: it.type === 'rank' ? 'rank' 
              : it.type === 'donation' ? 'donation' 
              : it.type === 'follow' ? 'follow' 
              : it.type === 'new_story' ? 'new_story'
              : it.type === 'new_chapter' ? 'new_chapter'
              : 'like',
          created_at: String(it.created_at || ''),
          actorName: String(it.actor_name || (it.type === 'rank' ? 'Hệ thống' : 'Ai đó')),
          actorAvatar,
          storyId: it.story_id ? String(it.story_id) : null,
          storyTitle: it.story_title ? String(it.story_title) : null,
          chapterId: it.chapter_id ? String(it.chapter_id) : null,
          chapterNo: it.chapter_no !== undefined && it.chapter_no !== null ? Number(it.chapter_no) : null,
          chapterTitle: it.chapter_title ? String(it.chapter_title) : null,
          rank: it.rank !== undefined && it.rank !== null ? Number(it.rank) : null,
          coins: it.coins !== undefined && it.coins !== null ? Number(it.coins) : null,
          message: it.message ? String(it.message) : null,
          isUnread: !!it.is_unread,
        }
      })
      setItems(mapped)

      // Visiting this screen means the user has seen the latest notifications.
      // Best-effort: don't block UI on this call.
      try { await apiMarkNotificationsSeen(t) } catch { }
    } catch (e) {
      console.error(e)
      setItems([])
    } finally {
      setRefreshing(false)
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(true)
  }, [load])

  const empty = useMemo(() => {
    if (!token) return 'Đăng nhập để xem thông báo.'
    return 'Chưa có thông báo nào.'
  }, [token])

  const renderMessage = (it: UiNotification) => {
    if (it.type === 'rank') {
      const title = it.storyTitle ? `"${it.storyTitle}"` : 'truyện của bạn'
      const n = it.rank || 0
      if (n === 1 || n === 2 || n === 3) return `Chúc mừng! Truyện ${title} đang Top ${n} trên bảng Thịnh hành.`
      if (n > 0) return `Truyện ${title} đang đứng hạng #${n} trên bảng Thịnh hành.`
      return `Truyện ${title} đang có thứ hạng trên bảng Thịnh hành.`
    }
    if (it.type === 'follow') return `${it.actorName} đã theo dõi bạn.`
    if (it.type === 'donation') {
      const storyPart = it.storyTitle ? ` cho truyện "${it.storyTitle}"` : ''
      return `${it.actorName} đã donate ${it.coins ?? 0} xu${storyPart}.`
    }
    if (it.type === 'new_story') {
      const title = it.storyTitle ? `"${it.storyTitle}"` : 'truyện mới'
      return `${it.actorName} đã thêm truyện mới ${title}.`
    }
    if (it.type === 'new_chapter') {
      const storyPart = it.storyTitle ? ` "${it.storyTitle}"` : ''
      const chapterPart = it.chapterTitle 
        ? `chương "${it.chapterTitle}"` 
        : it.chapterNo 
          ? `chương ${it.chapterNo}` 
          : 'chương mới'
      return `${it.actorName} đã thêm ${chapterPart} vào truyện${storyPart}.`
    }
    // like
    const storyPart = it.storyTitle ? ` truyện "${it.storyTitle}"` : ' truyện của bạn'
    return `${it.actorName} đã thích${storyPart}.`
  }

  const renderItem = ({ item }: { item: UiNotification }) => {
    const canOpenStory = !!item.storyId
    const targetPath = item.chapterId && item.type === 'new_chapter'
      ? '/reader/[id]'
      : '/book/[id]'
    const params = item.chapterId && item.type === 'new_chapter'
      ? { id: item.storyId || '1', ch: item.chapterNo?.toString() || '1' }
      : { id: item.storyId }
    
    return (
      <Pressable
        onPress={() => {
          if (canOpenStory && item.storyId) navigate(targetPath, params)
        }}
        style={({ pressed }) => [
          styles.item, 
          pressed && { opacity: 0.8 }, 
          !canOpenStory && { opacity: 1 },
          item.isUnread && { backgroundColor: '#f0f9ff' }
        ]}
      >
        <View style={{ position: 'relative' }}>
          {item.actorAvatar ? (
            <Image source={{ uri: item.actorAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={{ fontWeight: '800', color: '#0f172a' }}>{item.actorName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          {item.isUnread && (
            <View style={styles.unreadDot} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.msg}>{renderMessage(item)}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={styles.meta}>{timeAgo(item.created_at)}</Text>
            {canOpenStory ? <Text style={styles.metaLink}>Xem</Text> : <Text style={styles.meta} />}
          </View>
          {!!item.message && item.type === 'donation' && (
            <Text style={styles.note} numberOfLines={2}>“{item.message}”</Text>
          )}
        </View>
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Thông báo</Text>
      </View>

      {!token && !loading && (
        <View style={styles.loginCard}>
          <Text style={styles.muted}>Bạn chưa đăng nhập.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Link href="/(auth)/login" asChild>
              <Pressable style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Đăng nhập</Text></Pressable>
            </Link>
          </View>
        </View>
      )}

      {loading ? (
        <View style={{ padding: 16 }}>
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(false)} />}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.muted}>{empty}</Text>}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f9fc' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },

  loginCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },

  item: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#b3d7ff' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  msg: { color: '#0f172a', fontWeight: '700', fontSize: 14, lineHeight: 20 },
  meta: { color: '#64748b', fontSize: 12 },
  metaLink: { color: '#1088ff', fontSize: 12, fontWeight: '800' },
  note: { color: '#334155', fontStyle: 'italic', marginTop: 6 },
  muted: { color: '#475569' },

  primaryBtn: { backgroundColor: '#1088ff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
})
