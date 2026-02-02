import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useDebouncedNavigation } from '../../lib/navigation'
import * as Auth from '../../lib/auth'
import { API_BASE, apiFetchAuthors, apiFetchPublicFeed, apiFollowAuthor, apiUnfollowAuthor, type AuthorItem, type FollowingFeedItem } from '../../lib/api'
import CustomAlert from '../../components/CustomAlert'
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'

type UiAuthor = {
  id: string
  user_id?: string | null
  name: string
  avatarUrl?: string | null
  followers: number
  books: number
  isFollowing: boolean
}

type UiFeedItem = {
  id: string
  type: 'story' | 'chapter'
  created_at: string
  authorName: string
  authorId: string | null
  storyId: string
  storyTitle: string
  cover: string | null
  genre: string | null
  views: number
  likes: number
  chapterNo: number | null
  chapterTitle: string | null
}

export default function FollowScreen() {
  const [authors, setAuthors] = useState<UiAuthor[]>([])
  const [feed, setFeed] = useState<UiFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userLoaded, setUserLoaded] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<any | null>(null)

  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)

  const [alertVisible, setAlertVisible] = useState(false)
  const [alertTitle, setAlertTitle] = useState('')
  const [alertMessage, setAlertMessage] = useState('')
  const [alertButtons, setAlertButtons] = useState<any[] | undefined>(undefined)

  const router = useRouter()
  const { navigate } = useDebouncedNavigation()

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  const timeAgo = useCallback((iso: string) => {
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
  }, [])

  const showAlert = useCallback((title: string, message: string, buttons?: any[]) => {
    setAlertTitle(title)
    setAlertMessage(message)
    setAlertButtons(buttons)
    setAlertVisible(true)
  }, [])

  const loadAuth = useCallback(async () => {
    setUserLoaded(false)
    try {
      const t = await Auth.getToken()
      setToken(t)
      try {
        const u = await Auth.getUser()
        setMe(u)
      } catch {
        setMe(null)
      }
    } finally {
      setUserLoaded(true)
    }
  }, [])

  const loadAuthors = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    setRefreshing(true)
    try {
      const t = await Auth.getToken()
      const res: any = await apiFetchAuthors(t || undefined)
      if (Array.isArray(res)) {
        const mapped: UiAuthor[] = res.map((a: AuthorItem) => ({
          id: String((a as any).id || (a as any).author_id),
          user_id: (a as any).user_id ? String((a as any).user_id) : null,
          name: String((a as any).pen_name || (a as any).name || 'Tác giả'),
          avatarUrl: (a as any).avatar_url
            ? (String((a as any).avatar_url).startsWith('http')
              ? String((a as any).avatar_url)
              : (String((a as any).avatar_url).startsWith('/')
                ? `${API_BASE}${String((a as any).avatar_url)}`
                : `${API_BASE}/${String((a as any).avatar_url)}`))
            : null,
          followers: Number((a as any).followers_count || 0),
          books: Number((a as any).books_count || 0),
          isFollowing: !!(a as any).is_following,
        }))
        setAuthors(mapped)
      } else {
        setAuthors([])
      }
    } catch (e) {
      console.error(e)
      setAuthors([])
    } finally {
      if (showSpinner) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadFeed = useCallback(async () => {
    try {
      const res: any = await apiFetchPublicFeed({ limit: 30, offset: 0 })
      if (!Array.isArray(res)) {
        setFeed([])
        return
      }
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000
      const now = Date.now()
      const mapped: UiFeedItem[] = (res as FollowingFeedItem[])
        .filter((it: any) => it && it.story_id)
        // Hide posts older than 3 days
        .filter((it: any) => {
          const created = it && it.created_at ? Date.parse(String(it.created_at)) : NaN
          if (!Number.isFinite(created)) return true
          return (now - created) <= threeDaysMs
        })
        .map((it: any) => {
          const cover = it.cover_url ? (String(it.cover_url).startsWith('http') ? String(it.cover_url) : `${API_BASE}${it.cover_url}`) : null
          return {
            id: String(it.id),
            type: (it.type === 'chapter' ? 'chapter' : 'story'),
            created_at: String(it.created_at || ''),
            authorName: String(it.author_name || 'Tác giả'),
            authorId: it.author_id ? String(it.author_id) : null,
            storyId: String(it.story_id),
            storyTitle: String(it.story_title || 'Truyện'),
            cover,
            genre: it.genre ? String(it.genre) : null,
            views: Number(it.views || 0),
            likes: Number(it.likes_count || 0),
            chapterNo: it.chapter_no !== undefined && it.chapter_no !== null ? Number(it.chapter_no) : null,
            chapterTitle: it.chapter_title ? String(it.chapter_title) : null,
          }
        })
      setFeed(mapped)
    } catch (e) {
      console.error(e)
      setFeed([])
    }
  }, [])

  useFocusEffect(useCallback(() => {
    loadAuth()
    loadAuthors(false)
    loadFeed()
  }, [loadAuth, loadAuthors, loadFeed]))

  useEffect(() => {
    loadAuth()
    loadAuthors(true)
    loadFeed()
  }, [loadAuth, loadAuthors, loadFeed])

  const handleToggleFollow = useCallback(async (authorId: string, nextFollow: boolean) => {
    try {
      const t = token || await Auth.getToken()
      if (!t) {
        showAlert('Cần đăng nhập', 'Vui lòng đăng nhập để theo dõi tác giả.', [
          { text: 'Để sau' },
          { text: 'Đăng nhập', onPress: () => navigate('/(auth)/login') },
        ])
        return
      }

      // Prevent self-follow on UI
      const mine = authors.find(it => it.id === authorId)
      if (mine && me && mine.user_id && String(mine.user_id) === String(me.id || me.user_id)) {
        showAlert('Không thể theo dõi', 'Bạn không thể tự theo dõi chính mình.')
        return
      }

      // optimistic UI
      setAuthors(prev => prev.map(it => it.id === authorId ? ({ ...it, isFollowing: nextFollow, followers: Math.max(0, it.followers + (nextFollow ? 1 : -1)) }) : it))

      if (nextFollow) {
        const r: any = await apiFollowAuthor(authorId, t)
        if (r && r.error) {
          showAlert('Không thể theo dõi', r.message || 'Không thể theo dõi tác giả này.')
          return loadAuthors(false)
        }
      } else {
        const r: any = await apiUnfollowAuthor(authorId, t)
        if (r && r.error) {
          showAlert('Không thể bỏ theo dõi', r.message || 'Không thể bỏ theo dõi tác giả này.')
          return loadAuthors(false)
        }
      }

      // refresh from server so counts stay correct
      loadAuthors(false)
      // refresh feed as well (may change because followed authors list changed)
      loadFeed()
    } catch (e) {
      console.error(e)
      // revert by refreshing
      loadAuthors(false)
      loadFeed()
    }
  }, [authors, token, loadAuthors, loadFeed, me, navigate, showAlert])

  const openBookNow = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

  function handleOpenBook(id: string) {
    if (!userLoaded) {
      setPendingOpen(id)
      return
    }
    if (!shouldShowAds(me)) return openBookNow(id)
    setTargetBookId(id)
    setInterstitialVisible(true)
  }

  useEffect(() => {
    if (!userLoaded) return
    if (!pendingOpen) return
    const id = pendingOpen
    setPendingOpen(null)
    if (!shouldShowAds(me)) return openBookNow(id)
    setTargetBookId(id)
    setInterstitialVisible(true)
  }, [userLoaded, pendingOpen, me])

  const renderAuthorCard = useCallback(({ item }: { item: UiAuthor }) => {
    const initials = (item.name || 'T').trim().slice(0, 1).toUpperCase()
    const isSelf = !!(me && item.user_id && String(item.user_id) === String(me.id || me.user_id))
    return (
      <View style={styles.authorCard}>
        <Pressable onPress={() => navigate('/author/[id]', { id: item.id, name: item.name })} style={{ flex: 1 }}>
          <View style={styles.authorAvatar}>
            {item.avatarUrl ? (
              <Image source={{ uri: item.avatarUrl }} style={styles.authorAvatarImg} />
            ) : (
              <Text style={styles.authorAvatarText}>{initials}</Text>
            )}
          </View>
          <Text style={styles.authorName} numberOfLines={1}>{item.name}</Text>
        </Pressable>
        <Pressable
          onPress={() => handleToggleFollow(item.id, !item.isFollowing)}
          style={[styles.authorBtn, item.isFollowing ? styles.authorBtnFollowing : styles.authorBtnFollow]}
          disabled={!userLoaded || isSelf}
        >
          <Text style={[styles.authorBtnText, item.isFollowing ? styles.authorBtnTextFollowing : styles.authorBtnTextFollow]}>
            {isSelf ? 'Bạn' : (item.isFollowing ? 'Đang theo dõi' : 'Theo dõi')}
          </Text>
        </Pressable>
      </View>
    )
  }, [handleToggleFollow, me, navigate, userLoaded])

  const renderFeedItem = useCallback(({ item }: { item: UiFeedItem }) => {
    const headerRight = timeAgo(item.created_at)
    const message = item.type === 'chapter'
      ? `Vừa đăng chương mới${item.chapterNo ? ` (Ch. ${item.chapterNo})` : ''}${item.chapterTitle ? `: ${item.chapterTitle}` : ''}`
      : 'Đã đăng một tác phẩm mới, mau đến đọc nào~'

    return (
      <View style={styles.postCard}>
        <View style={styles.postHeader}>
          <Pressable onPress={() => item.authorId ? navigate('/author/[id]', { id: item.authorId, name: item.authorName }) : undefined}>
            <Text style={styles.postAuthor} numberOfLines={1}>{item.authorName}</Text>
          </Pressable>
          <Text style={styles.postTime}>{headerRight}</Text>
        </View>
        <Text style={styles.postText}>{message}</Text>

        <Pressable onPress={() => handleOpenBook(item.storyId)} style={styles.storyCard}>
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={styles.storyCover} />
          ) : (
            <View style={styles.storyCover} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.storyTitle} numberOfLines={2}>{item.storyTitle}</Text>
            <Text style={styles.storyMeta} numberOfLines={1}>
              {fmtNum(item.views)} lượt xem
              {item.genre ? ` · ${item.genre}` : ''}
            </Text>
          </View>
        </Pressable>
      </View>
    )
  }, [fmtNum, handleOpenBook, router, timeAgo])

  const keyAuthor = useCallback((it: UiAuthor) => it.id, [])
  const keyFeed = useCallback((it: UiFeedItem) => it.id, [])

  const listEmpty = useMemo(() => (
    <View style={{ padding: 16 }}>
      <Text style={{ color: '#6b7280' }}>Chưa có bài đăng.</Text>
    </View>
  ), [])

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        contentContainerStyle={styles.list}
        data={feed}
        keyExtractor={keyFeed}
        renderItem={renderFeedItem}
        ListEmptyComponent={listEmpty}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Theo dõi</Text>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Tác giả</Text>
            </View>

            <FlatList
              data={authors}
              keyExtractor={keyAuthor}
              renderItem={renderAuthorCard}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.authorList}
            />

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Bài đăng mới</Text>
            </View>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadAuthors(false); loadFeed() }} />}
      />

      <AdInterstitial
        visible={interstitialVisible}
        onFinish={() => {
          setInterstitialVisible(false)
          if (targetBookId) openBookNow(targetBookId)
          setTargetBookId(null)
        }}
      />

      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        buttons={alertButtons}
        onDismiss={() => setAlertVisible(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },

  list: { paddingBottom: 24 },
  sectionHeaderRow: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#111827' },

  authorList: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  authorCard: {
    width: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eef2f7',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fff',
    marginRight: 10,
  },
  authorAvatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#1088ff22', alignItems: 'center', justifyContent: 'center' },
  authorAvatarImg: { width: '100%', height: '100%' },
  authorAvatarText: { color: '#1088ff', fontWeight: '900', fontSize: 18 },
  authorName: { marginTop: 8, fontSize: 13, fontWeight: '900', color: '#111827' },
  authorBtn: { marginTop: 10, paddingVertical: 7, borderRadius: 999, alignItems: 'center' },
  authorBtnFollow: { backgroundColor: '#1088ff' },
  authorBtnFollowing: { backgroundColor: '#f3f4f6' },
  authorBtnText: { fontSize: 11, fontWeight: '900' },
  authorBtnTextFollow: { color: '#fff' },
  authorBtnTextFollowing: { color: '#111827' },

  postCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eef2f7',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fff',
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postAuthor: { fontSize: 14, fontWeight: '900', color: '#111827' },
  postTime: { fontSize: 12, color: '#6b7280' },
  postText: { marginTop: 6, fontSize: 13, color: '#374151' },

  storyCard: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: '#f8fafc' },
  storyCover: { width: 44, height: 58, borderRadius: 10, backgroundColor: '#e5e7eb' },
  storyTitle: { fontSize: 13, fontWeight: '900', color: '#111827' },
  storyMeta: { marginTop: 3, fontSize: 12, color: '#6b7280' },
})
