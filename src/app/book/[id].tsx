import { useThemeStyles } from '../../components/AppTheme'
import React, { useMemo, useEffect, useState, useCallback } from "react";
import { Platform, StyleSheet, Text, View, ScrollView, Pressable, ActivityIndicator, Image, Alert, TextInput } from "react-native";
import KeyboardSafeScroll from "../../components/KeyboardSafe";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from '@react-navigation/native'
import { useDebouncedNavigation } from '../../lib/navigation'
import { radius, cardShadow, cardShadowSm, type AppColors } from '../../theme'
import { Cover, GenreChip, ScreenBack, SegmentedControl } from '../../components/ui'

import { apiFetchBook, API_BASE, apiLikeBook, apiUnlikeBook, apiFetchAuthors, apiFollowAuthor, apiUnfollowAuthor, apiFetchComments, apiPostComment, apiDeleteComment, apiGetWallet } from '../../lib/api'
import AuthorGiftCard from '../../components/AuthorGiftCard'
import * as Auth from '../../lib/auth'
import { shouldShowPlacement } from '../../lib/ads'
import AdInterstitial from '../../components/AdInterstitial'
import { downloadBookOffline, isBookDownloaded, removeOfflineBook } from '../../lib/offline'
import { getReadingProgress } from '../../lib/reading'
import { SkeletonLoader, CommentSkeleton, ChapterListSkeleton } from '../../components/SkeletonLoader'

export default function BookDetailScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const { id } = useLocalSearchParams<{ id: string }>();
  const { navigate, goBack } = useDebouncedNavigation()
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bookAttempt, setBookAttempt] = useState(0)
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [entryAdVisible, setEntryAdVisible] = useState(false)
  const [offlineDownloaded, setOfflineDownloaded] = useState(false)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineProgress, setOfflineProgress] = useState<{ done: number; total: number } | null>(null)
  const [likesCount, setLikesCount] = useState<number>(0)
  const [liked, setLiked] = useState<boolean>(false)
  const [comments, setComments] = useState<any[]>([])
  const [commentText, setCommentText] = useState<string>('')

  const [wallet, setWallet] = useState<any | null>(null)
  const [walletLoading, setWalletLoading] = useState<boolean>(false)
  const [commentBusy, setCommentBusy] = useState<boolean>(false)

  const [authorId, setAuthorId] = useState<string | null>(null)
  const [authorName, setAuthorName] = useState<string>('')
  const [authorUserId, setAuthorUserId] = useState<string | null>(null)
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState<string | null>(null)
  const [authorFollowers, setAuthorFollowers] = useState<number>(0)
  const [authorFollowing, setAuthorFollowing] = useState<boolean>(false)

  const [lastReadChapter, setLastReadChapter] = useState<number | null>(null)
  const [visibleComments, setVisibleComments] = useState<number>(5)
  const [section, setSection] = useState('Giới thiệu')
  const hasPendingComments = comments.some(c => String(c.user_id) === String(user?.id || user?.user_id)
    && ['pending', 'shadowbanned'].includes(String(c.status)))

  useFocusEffect(useCallback(() => {
    if (!id || section !== 'Bình luận' || !hasPendingComments) return
    let active = true, busy = false
    const started = Date.now()
    const timer = setInterval(async () => {
      // Cover slow providers and durable retries while bounding background HTTP traffic.
      if (Date.now() - started >= 120000) { clearInterval(timer); return }
      if (!active || busy) return
      busy = true
      try {
        const token = await Auth.getToken()
        const rows = await apiFetchComments(String(id), token || undefined)
        if (active && Array.isArray(rows)) setComments(rows)
      } catch { /* Keep the pending badge if a refresh temporarily fails. */ }
      finally { busy = false }
    }, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [id, section, hasPendingComments]))

  // Format thời gian bình luận (vừa xong, 5 phút trước, 2 giờ trước, etc.)
  const formatCommentTime = (timestamp: string | number | Date | null | undefined): string => {
    if (!timestamp) return ''
    
    try {
      const now = new Date()
      const commentDate = new Date(timestamp)
      const diffMs = now.getTime() - commentDate.getTime()
      const diffSec = Math.floor(diffMs / 1000)
      const diffMin = Math.floor(diffSec / 60)
      const diffHour = Math.floor(diffMin / 60)
      const diffDay = Math.floor(diffHour / 24)
      const diffMonth = Math.floor(diffDay / 30)
      const diffYear = Math.floor(diffDay / 365)

      if (diffSec < 60) return 'Vừa xong'
      if (diffMin < 60) return `${diffMin} phút trước`
      if (diffHour < 24) return `${diffHour} giờ trước`
      if (diffDay < 30) return `${diffDay} ngày trước`
      if (diffMonth < 12) return `${diffMonth} tháng trước`
      return `${diffYear} năm trước`
    } catch (e) {
      return ''
    }
  }

  const loadAuthorMeta = useCallback(async (aId: string) => {
    try {
      const token = await Auth.getToken()
      const res: any = await apiFetchAuthors(token || undefined)
      if (Array.isArray(res)) {
        const hit: any = res.find((a: any) => String(a.id || a.author_id) === String(aId))
        if (hit) {
          setAuthorName(String(hit.pen_name || hit.name || hit.author_name || hit.author || 'Tác giả'))
          setAuthorUserId(hit.user_id ? String(hit.user_id) : null)
          setAuthorAvatarUrl(hit.avatar_url
            ? (String(hit.avatar_url).startsWith('http')
              ? String(hit.avatar_url)
              : (String(hit.avatar_url).startsWith('/')
                ? `${API_BASE}${String(hit.avatar_url)}`
                : `${API_BASE}/${String(hit.avatar_url)}`))
            : null)
          setAuthorFollowers(Number(hit.followers_count || 0))
          setAuthorFollowing(!!hit.is_following)
          return
        }
      }
    } catch (e) {
      // ignore
    }
  }, [])

  const refreshWallet = useCallback(async () => {
    setWalletLoading(true)
    try {
      const token = await Auth.getToken()
      if (!token) {
        setWallet(null)
        return
      }
      const res: any = await apiGetWallet(token)
      if (res && !res.error) {
        const coins = res.coins ?? res.balance ?? res.coin_balance ?? 0
        setWallet({ ...res, coins })
      }
    } catch (e) {
      // ignore wallet errors
    } finally {
      setWalletLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    refreshWallet()
    if (id) {
      getReadingProgress(String(id)).then((progress) => {
        if (!active) return
        if (progress && progress.chapterNo) setLastReadChapter(Number(progress.chapterNo))
      }).catch(() => {})
    }
    return () => { active = false }
  }, [refreshWallet, id]))

  // Full-screen ad only once per session when opening any book.
  useEffect(() => {
    if (!id) return
    if (!userLoaded) return
    if (shouldShowPlacement('book-open-once', user)) setEntryAdVisible(true)
  }, [id, user, userLoaded])

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!id) return
      setLoading(true)
      setLoadError(null)
      try {
        const token = await Auth.getToken()
        const res: any = await apiFetchBook(String(id), token || undefined)
        if (!mounted) return
        if (res && !res.error) {
          const aId = res.author_id ? String(res.author_id) : null
          setAuthorId(aId)
          // best-effort: show something immediately while we fetch full author meta
          setAuthorName(String(res.author_name || res.author || res.pen_name || ''))
          setAuthorUserId(res.author_user_id ? String(res.author_user_id) : null)
          if (aId) loadAuthorMeta(aId)

          // normalize to Book shape
          const b: Book = {
            id: String(res.id || res.story_id || id),
            title: res.title || res.name || 'Tiểu thuyết chưa rõ',
            tags: res.tags || (res.genre ? [res.genre] : []),
            stats: `${((res.chapters && res.chapters.length) || res.chapters_count || 0)} chương`,
            desc: res.description || res.desc || res.content || '',
            cover: res.cover_url ? (String(res.cover_url).startsWith('http') ? res.cover_url : `${API_BASE}${res.cover_url}`) : null,
            chapters: Array.isArray(res.chapters) ? res.chapters.map((c: any, idx: number) => ({ id: String(c.id || c.chapter_id || `${id}-c${idx + 1}`), chapterNo: Number(c.chapter_no || c.chapterNo || idx + 1), title: c.title || `Chương ${idx + 1}`, content: c.content || c.body || c.text || '' })) : []
          }
          setBook(b)
          setLoadError(null)
          setLikesCount(Number(res.likes_count || 0))
          setLiked(!!res.liked)
          refreshComments(String(res.id || res.story_id || id))
          
          const progress = await getReadingProgress(String(res.id || res.story_id || id))
          if (progress && progress.chapterNo) {
            setLastReadChapter(Number(progress.chapterNo))
          } else {
            setLastReadChapter(null)
          }
          return
        }
        if (mounted) {
          setBook(null)
          setLoadError(res && res.message ? String(res.message) : 'Không tải được truyện.')
        }
      } catch (e) {
        console.error('fetch book err', e)
        if (mounted) {
          setBook(null)
          setLoadError('Không tải được truyện.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [id, loadAuthorMeta, bookAttempt])

  const isSelfAuthor = useMemo(() => {
    if (!user || !authorUserId) return false
    return String(user.id || user.user_id) === String(authorUserId)
  }, [authorUserId, user])

  const handleToggleAuthorFollow = useCallback(async () => {
    if (!authorId) return
    try {
      const token = await Auth.getToken()
      if (!token) {
        Alert.alert('Cần đăng nhập', 'Vui lòng đăng nhập để theo dõi tác giả.')
        return
      }

      if (isSelfAuthor) {
        Alert.alert('Không thể theo dõi', 'Bạn không thể tự theo dõi chính mình.')
        return
      }

      const next = !authorFollowing
      setAuthorFollowing(next)
      setAuthorFollowers((prev) => Math.max(0, prev + (next ? 1 : -1)))

      if (next) {
        const r: any = await apiFollowAuthor(authorId, token)
        if (r && r.error) {
          Alert.alert('Không thể theo dõi', r.message || 'Không thể theo dõi tác giả này.')
          loadAuthorMeta(authorId)
          return
        }
      } else {
        const r: any = await apiUnfollowAuthor(authorId, token)
        if (r && r.error) {
          Alert.alert('Không thể bỏ theo dõi', r.message || 'Không thể bỏ theo dõi tác giả này.')
          loadAuthorMeta(authorId)
          return
        }
      }

      loadAuthorMeta(authorId)
    } catch (e: any) {
      console.error(e)
      if (authorId) loadAuthorMeta(authorId)
    }
  }, [authorFollowing, authorId, isSelfAuthor, loadAuthorMeta])

  useEffect(() => {
    let active = true
      ; (async () => {
        if (!id) return
        const ok = await isBookDownloaded(String(id))
        if (active) setOfflineDownloaded(ok)
      })()
    return () => { active = false }
  }, [id])

  const handleDownloadOffline = useCallback(async () => {
    if (!id) return
    if (offlineBusy) return
    setOfflineBusy(true)
    setOfflineProgress({ done: 0, total: 1 })
    try {
      const token = await Auth.getToken()
      const saved: any = await downloadBookOffline(String(id), {
        token: token || undefined,
        onProgress: (p) => setOfflineProgress(p)
      })
      setOfflineDownloaded(true)
      if (saved && saved.partial) {
        const count = Number(saved.savedCount || 0)
        Alert.alert('Tải một phần', `Đã lưu ${count} chương. Các chương sau cần VIP.`)
      } else {
        Alert.alert('Thành công', 'Đã tải truyện để đọc offline.')
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    } finally {
      setOfflineBusy(false)
      setOfflineProgress(null)
    }
  }, [id, offlineBusy])

  const handleRemoveOffline = useCallback(async () => {
    if (!id) return
    if (offlineBusy) return
    Alert.alert('Xóa truyện đã tải?', 'Bạn muốn xóa dữ liệu offline của truyện này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive',
        onPress: async () => {
          setOfflineBusy(true)
          try {
            await removeOfflineBook(String(id))
            setOfflineDownloaded(false)
          } finally {
            setOfflineBusy(false)
          }
        }
      }
    ])
  }, [id, offlineBusy])

  async function handleToggleLike() {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để yêu thích truyện.')
      return
    }
    if (!id) return
    try {
      if (liked) {
        await apiUnlikeBook(String(id), token)
        setLiked(false)
        setLikesCount((c) => Math.max(0, c - 1))
      } else {
        await apiLikeBook(String(id), token)
        setLiked(true)
        setLikesCount((c) => c + 1)
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  async function refreshComments(bookId: string) {
    try {
      const token = await Auth.getToken()
      const list = await apiFetchComments(bookId, token || undefined)
      if (Array.isArray(list)) setComments(list)
    } catch (e) {
      // ignore
    }
  }

  async function handleSubmitComment() {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để bình luận.')
      return
    }
    if (!id) return
    if (!commentText.trim() || commentBusy) return

    setCommentBusy(true)
    try {
      const res: any = await apiPostComment(String(id), commentText.trim(), null, token)
      if (res && !res.error) {
        setCommentText('')
        // optimistic update: show immediately
        setComments((prev) => [res, ...(prev || [])])
        // also refresh from server to sync status/order
        refreshComments(String(id))
      } else {
        Alert.alert('Lỗi', String(res?.message || res?.error || 'Không gửi được bình luận'))
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    } finally {
      setCommentBusy(false)
    }
  }

  async function handleDeleteComment(commentId: string) {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để xóa bình luận.')
      return
    }

    Alert.alert('Xóa bình luận?', 'Bạn có chắc muốn xóa bình luận này không?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            const res: any = await apiDeleteComment(commentId, token)
            if (res && res.error) {
              Alert.alert('Không thể xóa', String(res.message || res.error || 'Không thể xóa bình luận'))
              return
            }
            // optimistic remove
            setComments(prev => (prev || []).filter((c: any) => String(c.id) !== String(commentId)))
          } catch (e: any) {
            Alert.alert('Lỗi', e?.message ? e.message : String(e))
          }
        }
      }
    ])
  }

  if (!book && !loading && loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{loadError}</Text>
          <Pressable onPress={() => setBookAttempt((n) => n + 1)} style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent }}>
            <Text style={{ color: colors.onAccent, fontWeight: '800' }}>Thử lại</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  // Defensive render: don't attempt to render full UI until we have a book object.
  if (!book) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Header Skeleton */}
          <View style={styles.headerRow}>
            <SkeletonLoader width={96} height={128} borderRadius={12} />
            <View style={{ flex: 1 }}>
              <SkeletonLoader width="80%" height={20} style={{ marginBottom: 8 }} />
              <SkeletonLoader width="60%" height={14} style={{ marginBottom: 6 }} />
              <SkeletonLoader width="50%" height={14} style={{ marginBottom: 12 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SkeletonLoader width={80} height={32} borderRadius={10} />
                <SkeletonLoader width={80} height={32} borderRadius={10} />
              </View>
            </View>
          </View>

          {/* Description Card Skeleton */}
          <View style={[styles.card, { marginTop: 16 }]}>
            <SkeletonLoader width="40%" height={18} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="100%" height={14} style={{ marginBottom: 6 }} />
            <SkeletonLoader width="95%" height={14} style={{ marginBottom: 6 }} />
            <SkeletonLoader width="85%" height={14} />
          </View>

          {/* Chapters Skeleton */}
          <View style={styles.card}>
            <SkeletonLoader width="50%" height={18} style={{ marginBottom: 12 }} />
            <ChapterListSkeleton />
          </View>

          {/* Comments Skeleton */}
          <View style={styles.card}>
            <SkeletonLoader width="40%" height={18} style={{ marginBottom: 12 }} />
            <CommentSkeleton />
            <CommentSkeleton />
            <CommentSkeleton />
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }
  const chapterCount = (book?.chapters || []).length
  const readHref = { pathname: "/reader/[id]", params: { id: id || (book ? book.id : ''), ch: String(lastReadChapter || book?.chapters[0]?.chapterNo || 1) } } as any

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenBack
        title={book.title}
        onBack={goBack}
        right={
          <Pressable onPress={handleToggleLike} hitSlop={8}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.danger : colors.text} />
          </Pressable>
        }
      />
      <KeyboardSafeScroll contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={styles.headerRow}>
            <Cover uri={book.cover} width={118} height={160} radius={14} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{book ? book.title : '...'}</Text>
              <View style={styles.tagRow}>
                {(book.tags || []).slice(0, 3).map((tag) => (
                  <GenreChip key={tag} label={tag} />
                ))}
              </View>
              <Text style={styles.meta2}>{`${chapterCount} chương · ${likesCount} yêu thích`}</Text>

              {!!authorId && (
                <View style={styles.authorRow}>
                  <Pressable
                    onPress={() => navigate('/author/[id]', { id: authorId, name: authorName || undefined })}
                    style={({ pressed }) => [styles.authorLeft, pressed && { opacity: 0.75 }]}
                  >
                    <View style={styles.authorAvatar}>
                      {authorAvatarUrl ? (
                        <Image source={{ uri: authorAvatarUrl }} style={styles.authorAvatarImg} />
                      ) : (
                        <Text style={styles.authorAvatarText}>{(authorName || 'T').trim().slice(0, 1).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.authorName} numberOfLines={1}>{authorName || 'Tác giả'}</Text>
                      <Text style={styles.authorMeta} numberOfLines={1}>{authorFollowers} người theo dõi</Text>
                    </View>
                  </Pressable>

                  <Pressable
                    onPress={handleToggleAuthorFollow}
                    disabled={isSelfAuthor}
                    style={[styles.authorFollowBtn, authorFollowing ? styles.authorFollowingBtn : styles.authorFollowBtnOn, isSelfAuthor && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.authorFollowText, authorFollowing ? styles.authorFollowingText : styles.authorFollowTextOn]}>
                      {isSelfAuthor ? 'Bạn' : (authorFollowing ? 'Đang theo dõi' : 'Theo dõi')}
                    </Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.actionRow}>
                {offlineDownloaded ? (
                  <Pressable disabled={offlineBusy} onPress={handleRemoveOffline} style={styles.btnSecondary}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={styles.btnSecondaryText}>{offlineBusy ? '...' : 'Đã tải'}</Text>
                  </Pressable>
                ) : (
                  <Pressable disabled={offlineBusy} onPress={handleDownloadOffline} style={styles.btnSecondary}>
                    <Ionicons name="download-outline" size={16} color={colors.accentText} />
                    <Text style={styles.btnSecondaryText}>{offlineBusy ? `${offlineProgress?.done || 0}/${offlineProgress?.total || 0}` : 'Tải về'}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <SegmentedControl tabs={['Giới thiệu', 'Chương', 'Bình luận']} value={section} onChange={setSection} />
          </View>

          {section === 'Giới thiệu' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Giới thiệu</Text>
            <Text style={styles.desc}>{book ? book.desc : ''}</Text>
          </View>
          )}

          {section === 'Giới thiệu' && (
          <AuthorGiftCard
            bookId={String(id || '')}
            user={user}
            userLoaded={userLoaded}
            wallet={wallet}
            walletLoading={walletLoading}
            isSelfAuthor={isSelfAuthor}
            onWalletRefresh={refreshWallet}
          />
          )}

          {section === 'Chương' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Danh sách chương</Text>
            {(book ? book.chapters : []).map((ch, idx) => {
              const chapterNum = ch.chapterNo || idx + 1
              const isLastRead = lastReadChapter === chapterNum
              return (
                <Link key={ch.id} href={{ pathname: "/reader/[id]", params: { id: id || (book ? book.id : ''), ch: String(chapterNum) } } as any} asChild>
                  <Pressable style={StyleSheet.flatten([styles.chapterRow, idx !== 0 && styles.rowDivider, isLastRead && styles.lastReadChapter])}>
                    <Text style={[styles.chapterText, isLastRead && styles.lastReadText]} numberOfLines={1}>
                      Ch. {chapterNum} · {ch.title}
                      {isLastRead && ' 📖'}
                    </Text>
                  </Pressable>
                </Link>
              )
            })}
          </View>
          )}

          {section === 'Bình luận' && (
          <View style={[styles.card, { marginBottom: 24 }]}>
            <View id="comment-section">
              <Text style={styles.cardTitle}>Bình luận</Text>
              <View style={styles.commentInputRow}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Viết bình luận..."
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                />
                <Pressable
                  onPress={handleSubmitComment}
                  disabled={commentBusy}
                  style={[styles.sendBtn, commentBusy && { opacity: 0.7 }]}
                >
                  {commentBusy ? (
                    <ActivityIndicator size="small" color={colors.onAccent} />
                  ) : (
                    <Text style={styles.sendBtnText}>Gửi</Text>
                  )}
                </Pressable>
              </View>
            </View>
            {(() => {
              const myId = user ? String(user.id || user.user_id) : ''
              const feed = comments.filter((c) => {
                const status = String(c.status || 'approved')
                const isMine = !!(myId && c && c.user_id && String(c.user_id) === myId)
                if (status === 'approved') return true
                return isMine && (status === 'shadowbanned' || status === 'pending')
              })
              if (feed.length === 0) {
                return <View style={styles.emptyBox}><Text style={styles.meta}>Chưa có bình luận</Text></View>
              }
              return (
              <>
                {feed.slice(0, visibleComments).map((c, idx) => {
                  const status = String(c.status || 'approved')
                  const myIdRow = user ? String(user.id || user.user_id) : null
                  const isMine = !!(myIdRow && c && c.user_id && String(c.user_id) === String(myIdRow))
                  const isShadow = isMine && status === 'shadowbanned'
                  const isPending = isMine && status === 'pending'
                  const ownLabel = isShadow
                    ? 'Vi phạm (Chỉ bạn thấy)'
                    : isPending
                      ? c.awaiting_admin ? 'Chờ quản trị viên duyệt' : 'Đang kiểm duyệt'
                      : null
                  
                  const avatarUrl = c.user_avatar || c.avatar_url || c.avatar || null
                  const fullAvatarUrl = avatarUrl 
                    ? (avatarUrl.startsWith('http') ? avatarUrl : `${API_BASE}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`)
                    : null
                  
                  return (
                    <View key={c.id || idx} style={[styles.commentRow, idx !== 0 && styles.rowDivider]}>
                      {fullAvatarUrl ? (
                        <Image source={{ uri: fullAvatarUrl }} style={styles.commentAvatar} />
                      ) : (
                        <View style={styles.commentAvatar}>
                          <Text style={styles.avatarPlaceholder}>
                            {(c.user_name || c.name || 'U').charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={styles.commentHeaderRow}>
                          <Text style={styles.commentAuthor}>{c.user_name || `Người dùng ${c.user_id}`}</Text>
                          {isMine && c.id ? (
                            <Pressable onPress={() => handleDeleteComment(String(c.id))} style={({ pressed }) => [styles.commentDeleteBtn, pressed && { opacity: 0.7 }]}
                            >
                              <Text style={styles.commentDeleteText}>Xóa</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        {ownLabel ? <Text style={[styles.commentBadge, isShadow && styles.commentBadgeShadow]}>{ownLabel}</Text> : null}
                        <Text style={styles.commentText}>{c.content}</Text>
                        {(c.created_at || c.timestamp) && (
                          <Text style={styles.commentTime}>
                            {formatCommentTime(c.created_at || c.timestamp)}
                          </Text>
                        )}
                      </View>
                    </View>
                  )
                })}
                {visibleComments < feed.length && (
                  <Pressable onPress={() => setVisibleComments(prev => prev + 5)} style={styles.loadMoreBtn}>
                    <Text style={styles.loadMoreText}>Xem thêm bình luận ({feed.length - visibleComments} còn lại)</Text>
                  </Pressable>
                )}
              </>
              )
            })()}
          </View>
          )}
        </KeyboardSafeScroll>

      <View style={styles.stickyBar}>
        <Pressable onPress={handleToggleLike} style={styles.stickyIcon}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.danger : colors.text} />
          <Text style={styles.stickyIconLabel}>{likesCount}</Text>
        </Pressable>
        <Link href={readHref} asChild>
          <Pressable style={styles.stickyCta}>
            <Text style={styles.stickyCtaText}>
              {lastReadChapter ? `Đọc tiếp chương ${lastReadChapter}` : 'Đọc từ đầu'}
            </Text>
          </Pressable>
        </Link>
      </View>

      <AdInterstitial
        visible={entryAdVisible}
        placement="book-open"
        onFinish={() => setEntryAdVisible(false)}
      />
    </SafeAreaView>
  );
}

type Book = {
  id: string;
  title: string;
  tags: string[];
  stats: string;
  desc: string;
  cover?: string | null;
  chapters: { id: string; title: string; chapterNo?: number }[];
};

const mockBooks: Record<string, Book> = {
  "1": {
    id: "1",
    title: "Muôn Đời Muôn Kiếp Một Mình Em",
    tags: ["Nữ cường", "Gương vỡ lại lành"],
    stats: "120 chương",
    desc: "Một câu chuyện tình yêu nhiều thử thách...",
    chapters: Array.from({ length: 30 }).map((_, i) => ({ id: `1-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  "2": {
    id: "2",
    title: "Ba Năm Rồi Bắt Đầu Yêu",
    tags: ["Tổng tài", "Cưới trước yêu sau"],
    stats: "98 chương",
    desc: "Từ hôn nhân hợp đồng đến tình yêu đích thực...",
    chapters: Array.from({ length: 25 }).map((_, i) => ({ id: `2-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  r1: {
    id: "r1",
    title: "[Văn Nghiêm Văn] Xuyên Thành Bạn T…",
    tags: ["Chuyển ver", "Giải trí"],
    stats: "60 chương",
    desc: "Truyện chuyển ver chưa có sự cho phép của tác giả.",
    chapters: Array.from({ length: 20 }).map((_, i) => ({ id: `r1-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 110 },
  headerRow: { flexDirection: "row", gap: 16 },
  title: { fontSize: 21, fontWeight: "800", color: colors.text, lineHeight: 28, letterSpacing: -0.3 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  meta2: { fontSize: 13, color: colors.textSecondary, marginTop: 8, fontWeight: '600' },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  stickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    ...cardShadow,
  },
  stickyIcon: { alignItems: 'center', minWidth: 44 },
  stickyIconLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', marginTop: 2 },
  stickyCta: {
    flex: 1,
    height: 48,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadowSm,
  },
  stickyCtaText: { color: colors.onAccent, fontWeight: '800', fontSize: 15 },

  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  authorLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  authorAvatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  authorAvatarImg: { width: '100%', height: '100%' },
  authorAvatarText: { color: colors.accentText, fontWeight: '800', fontSize: 14 },
  authorName: { color: colors.text, fontWeight: '800', fontSize: 13 },
  authorMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  authorFollowBtn: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  authorFollowBtnOn: { backgroundColor: colors.accent },
  authorFollowingBtn: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderLight },
  authorFollowText: { color: colors.text, fontWeight: '700', fontSize: 11 },
  authorFollowTextOn: { color: colors.onAccent },
  authorFollowingText: { color: colors.textSecondary },
  btnPrimary: { backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8 },
  btnPrimaryText: { color: colors.onAccent, fontWeight: "700" },
  btnSecondary: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  btnSecondaryText: { color: colors.accentText, fontWeight: "700", fontSize: 13 },
  btnSecondaryActive: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  btnSecondaryTextActive: { color: colors.accentText },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  cardTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: 10, letterSpacing: -0.3 },
  desc: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },

  chapterRow: { paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chapterText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  lastReadChapter: { backgroundColor: colors.accentSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  lastReadText: { color: colors.accentText, fontWeight: '700' },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderLight },

  emptyBox: { backgroundColor: colors.surfaceSubtle, borderRadius: radius.lg, padding: 20, alignItems: "center" },

  commentInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 14 },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: 12,
    minHeight: 44,
    backgroundColor: colors.surfaceSubtle,
    fontSize: 14,
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: { color: colors.onAccent, fontWeight: '700', fontSize: 13 },
  commentRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  commentAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholder: { color: colors.accentText, fontWeight: '800', fontSize: 16 },
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  commentAuthor: { fontWeight: '700', color: colors.text, fontSize: 14 },
  loadMoreBtn: { marginTop: 14, padding: 12, backgroundColor: colors.surfaceSubtle, borderRadius: radius.full, alignItems: 'center' },
  loadMoreText: { color: colors.accentText, fontWeight: '700', fontSize: 13 },
  commentDeleteBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.dangerSoft },
  commentDeleteText: { color: colors.dangerText, fontWeight: '700', fontSize: 11 },
  commentText: { color: colors.textSecondary, marginTop: 4, fontSize: 13, lineHeight: 19 },
  commentBadge: { alignSelf: 'flex-start', marginTop: 4, color: '#9a3412', backgroundColor: colors.orangeSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, fontSize: 11, fontWeight: '700', overflow: 'hidden' },
  commentBadgeShadow: { color: colors.dangerText, backgroundColor: colors.dangerSoft },
  commentTime: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
