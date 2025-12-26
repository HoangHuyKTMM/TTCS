import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import * as Auth from '../../lib/auth'
import { API_BASE, apiFetchAuthorBooks, apiFetchAuthors, apiFollowAuthor, apiUnfollowAuthor, type AuthorItem } from '../../lib/api'
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import CustomAlert from '../../components/CustomAlert'

type UiBook = {
  id: string
  title: string
  cover: string | null
  stats: string
}

export default function AuthorDetailScreen() {
  const params = useLocalSearchParams() as any
  const authorId = String(params?.id || '')
  const initialName = params?.name ? String(params.name) : ''

  const [authorName, setAuthorName] = useState(initialName)
  const [authorUserId, setAuthorUserId] = useState<string | null>(null)
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState<string | null>(null)
  const [followers, setFollowers] = useState(0)
  const [booksCount, setBooksCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)

  const [books, setBooks] = useState<UiBook[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)

  const [alertVisible, setAlertVisible] = useState(false)
  const [alertTitle, setAlertTitle] = useState('')
  const [alertMessage, setAlertMessage] = useState('')
  const [alertButtons, setAlertButtons] = useState<any[] | undefined>(undefined)

  const router = useRouter()

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  const showAlert = useCallback((title: string, message: string, buttons?: any[]) => {
    setAlertTitle(title)
    setAlertMessage(message)
    setAlertButtons(buttons)
    setAlertVisible(true)
  }, [])

  const loadUser = useCallback(async () => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    return () => { active = false }
  }, [])

  const loadAuthorMeta = useCallback(async () => {
    if (!authorId) return
    try {
      const token = await Auth.getToken()
      const res: any = await apiFetchAuthors(token || undefined)
      if (Array.isArray(res)) {
        const hit: any = res.find((a: AuthorItem) => String((a as any).id || (a as any).author_id) === String(authorId))
        if (hit) {
          setAuthorName(String(hit.pen_name || hit.name || authorName || 'Tác giả'))
          setAuthorUserId(hit.user_id ? String(hit.user_id) : null)
          setAuthorAvatarUrl(hit.avatar_url
            ? (String(hit.avatar_url).startsWith('http')
              ? String(hit.avatar_url)
              : (String(hit.avatar_url).startsWith('/')
                ? `${API_BASE}${String(hit.avatar_url)}`
                : `${API_BASE}/${String(hit.avatar_url)}`))
            : null)
          setFollowers(Number(hit.followers_count || 0))
          setBooksCount(Number(hit.books_count || 0))
          setIsFollowing(!!hit.is_following)
        }
      }
    } catch (e) {
      // ignore
    }
  }, [authorId, authorName])

  const loadBooks = useCallback(async (showSpinner = true) => {
    if (!authorId) return
    if (showSpinner) setLoading(true)
    setRefreshing(true)
    try {
      const token = await Auth.getToken()
      const res: any = await apiFetchAuthorBooks(authorId, token || undefined)
      if (Array.isArray(res)) {
        setBooks(res.map((b: any) => {
          const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
          const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
          return {
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
            stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} lượt thích`,
          }
        }))
      } else {
        setBooks([])
      }
    } catch (e) {
      console.error(e)
      setBooks([])
    } finally {
      if (showSpinner) setLoading(false)
      setRefreshing(false)
    }
  }, [authorId, fmtNum])

  useFocusEffect(useCallback(() => {
    loadUser()
    loadAuthorMeta()
    loadBooks(false)
  }, [loadUser, loadAuthorMeta, loadBooks]))

  useEffect(() => {
    loadUser()
    loadAuthorMeta()
    loadBooks(true)
  }, [loadUser, loadAuthorMeta, loadBooks])

  const handleToggleFollow = useCallback(async () => {
    try {
      const token = await Auth.getToken()
      if (!token) {
        showAlert('Cần đăng nhập', 'Vui lòng đăng nhập để theo dõi tác giả.', [
          { text: 'Để sau' },
          { text: 'Đăng nhập', onPress: () => router.push('/(auth)/login' as any) },
        ])
        return
      }

      // Prevent self-follow
      if (user && authorUserId && String(authorUserId) === String(user.id || user.user_id)) {
        showAlert('Không thể theo dõi', 'Bạn không thể tự theo dõi chính mình.')
        return
      }

      const next = !isFollowing
      setIsFollowing(next)
      setFollowers((prev) => Math.max(0, prev + (next ? 1 : -1)))

      if (next) {
        const r: any = await apiFollowAuthor(authorId, token)
        if (r && r.error) {
          showAlert('Không thể theo dõi', r.message || 'Không thể theo dõi tác giả này.')
          return loadAuthorMeta()
        }
      } else {
        const r: any = await apiUnfollowAuthor(authorId, token)
        if (r && r.error) {
          showAlert('Không thể bỏ theo dõi', r.message || 'Không thể bỏ theo dõi tác giả này.')
          return loadAuthorMeta()
        }
      }

      loadAuthorMeta()
    } catch (e) {
      console.error(e)
      loadAuthorMeta()
    }
  }, [authorId, authorUserId, isFollowing, loadAuthorMeta, router, showAlert, user])

  function openBookNow(id: string) {
    router.push({ pathname: '/book/[id]', params: { id } } as any)
  }

  function handleOpenBook(id: string) {
    if (!userLoaded) {
      setPendingOpen(id)
      return
    }
    if (!shouldShowAds(user)) return openBookNow(id)
    setTargetBookId(id)
    setInterstitialVisible(true)
  }

  useEffect(() => {
    if (!userLoaded) return
    if (!pendingOpen) return
    const id = pendingOpen
    setPendingOpen(null)
    if (!shouldShowAds(user)) return openBookNow(id)
    setTargetBookId(id)
    setInterstitialVisible(true)
  }, [userLoaded, pendingOpen, user])

  const isSelf = !!(user && authorUserId && String(authorUserId) === String(user.id || user.user_id))

  const renderHeader = useMemo(() => (
    <View style={styles.header}>
      <View style={styles.avatar}>
        {authorAvatarUrl ? (
          <Image source={{ uri: authorAvatarUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarText}>{(authorName || 'T').trim().slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.authorName} numberOfLines={1}>{authorName || 'Tác giả'}</Text>
        <Text style={styles.authorMeta}>
          {booksCount ? `${booksCount} tác phẩm` : 'Tác giả'}
          {' · '}
          {fmtNum(followers)} người theo dõi
        </Text>
      </View>
      <Pressable
        onPress={handleToggleFollow}
        disabled={isSelf}
        style={[styles.followBtn, isFollowing ? styles.followingBtn : styles.followBtnOn, isSelf && { opacity: 0.6 }]}
      >
        <Text style={[styles.followBtnText, isFollowing ? styles.followingText : styles.followBtnTextOn]}>
          {isSelf ? 'Bạn' : (isFollowing ? 'Đang theo dõi' : 'Theo dõi')}
        </Text>
      </Pressable>
    </View>
  ), [authorAvatarUrl, authorName, booksCount, followers, fmtNum, handleToggleFollow, isFollowing, isSelf])

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
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>Tác giả</Text>
        <View style={{ width: 34 }} />
      </View>

      <FlatList
        data={books}
        keyExtractor={(it) => it.id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadAuthorMeta(); loadBooks(false) }} />}
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text style={{ color: '#6b7280' }}>Tác giả chưa có truyện nào.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => handleOpenBook(item.id)} style={styles.bookRow}>
            {item.cover ? (
              <Image source={{ uri: item.cover }} style={styles.cover} />
            ) : (
              <View style={styles.cover} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.bookMeta} numberOfLines={1}>{item.stats}</Text>
            </View>
          </Pressable>
        )}
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

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' },
  backText: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: -2 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#111827' },

  list: { paddingHorizontal: 16, paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eef2f7',
    borderRadius: 14,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  avatar: { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: '#1088ff22', alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#1088ff', fontWeight: '900', fontSize: 20 },
  authorName: { fontSize: 16, fontWeight: '900', color: '#111827' },
  authorMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  followBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  followBtnOn: { backgroundColor: '#1088ff' },
  followingBtn: { backgroundColor: '#f3f4f6' },
  followBtnText: { fontSize: 12, fontWeight: '900' },
  followBtnTextOn: { color: '#fff' },
  followingText: { color: '#111827' },

  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eef2f7' },
  cover: { width: 48, height: 64, borderRadius: 10, backgroundColor: '#e5e7eb' },
  bookTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  bookMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
})
