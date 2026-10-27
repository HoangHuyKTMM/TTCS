import { useThemeStyles } from '../../components/AppTheme'
import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, Pressable, RefreshControl, Dimensions } from "react-native";
import { useDebouncedNavigation } from '../../lib/navigation'
import { apiFetchBooks, apiFetchLikedBooks, API_BASE } from '../../lib/api';
import * as Auth from '../../lib/auth';
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import { getReadingList, getReadingProgress } from '../../lib/reading'
import { useFocusEffect } from '@react-navigation/native'
import { listOfflineBooks, removeOfflineBook, formatBytes, type OfflineBookMeta } from '../../lib/offline'
import { radius, cardShadow, type AppColors } from '../../theme'
import { EmptyState, ProgressBar, SegmentedControl, StoryPoster, StoryRow } from '../../components/ui'

const POSTER_W = Math.floor((Dimensions.get('window').width - 44) / 2)

export default function LibraryScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const [reading, setReading] = useState<any[]>([]);
  const [liked, setLiked] = useState<any[]>([]);
  const [likedCursor, setLikedCursor] = useState<string | null>(null)
  const [likedHasMore, setLikedHasMore] = useState(false)
  const [loadingMoreLiked, setLoadingMoreLiked] = useState(false)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [downloaded, setDownloaded] = useState<OfflineBookMeta[]>([])
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const [tab, setTab] = useState('Đang đọc')
  const { navigate } = useDebouncedNavigation()

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  const loadAll = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setRefreshing(true);
    try {
      const token = await Auth.getToken();

      // Offline downloads list
      try {
        const off = await listOfflineBooks()
        setDownloaded(off)
      } catch {
        setDownloaded([])
      }

      const likedPage: any = token ? await apiFetchLikedBooks(token, { limit: 20 }) : null
      if (Array.isArray(likedPage?.books)) {
        const likedList = likedPage.books.map((b: any) => {
          const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
          const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
          return {
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
            views,
            likes,
            stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} lượt thích`,
          }
        });
        setLiked(likedList);
        setLikedCursor(likedPage.nextCursor || null)
        setLikedHasMore(!!likedPage.hasMore)
      } else {
        setLiked([])
        setLikedCursor(null)
        setLikedHasMore(false)
      }

      // load local reading progress and suggestions
      try {
        const list = await getReadingList()
        const readingRows = (Array.isArray(list) ? list : []).flatMap((r: any) => {
          const title = r.title
          if (!title) return []
          const rawCover = r.cover || null
          const cover = rawCover
            ? (String(rawCover).startsWith('http') || String(rawCover).startsWith('data:') ? String(rawCover) : `${API_BASE}${rawCover}`)
            : null
          return [{
            id: String(r.bookId),
            title,
            cover,
            chapterNo: r.chapterNo,
            progress: r.chapterNo ? `Đọc tiếp chương ${r.chapterNo}` : (r.chapter ? `Ch. ${r.chapter}` : ''),
            progressPct: r.progressPct,
            genre: r.genre,
          }]
        })
        setReading(readingRows)

        if (readingRows.length) {
          const first = readingRows[0]
          if (first && first.genre) {
            try {
              const firstGenre = String(first.genre).split(',')[0].trim()
              const page: any = await apiFetchBooks(token || undefined, { limit: 7, sort: 'recommended', genre: firstGenre })
              if (Array.isArray(page?.books)) {
                const selected = page.books.filter((b: any) => String(b.id || b.story_id) !== String(first.id)).slice(0, 6)
                setSuggestions(selected.map((b: any) => {
                  const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
                  const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
                  return {
                    id: String(b.id || b.story_id),
                    title: b.title || b.name,
                    cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
                    views,
                    likes,
                    stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} lượt thích`,
                  }
                }))
              }
            } catch (e) {
              // ignore
            }
          } else {
            setSuggestions([])
          }
        } else {
          setSuggestions([])
        }
      } catch (e) {
        setReading([])
        setSuggestions([])
      }

    } catch (e) {
      console.error(e);
    } finally {
      if (showSpinner) setLoading(false);
      setRefreshing(false);
    }
  }, [])

  const loadMoreLiked = useCallback(async () => {
    if (!user || !likedHasMore || !likedCursor || loadingMoreLiked) return
    const token = await Auth.getToken()
    if (!token) return
    setLoadingMoreLiked(true)
    try {
      const page: any = await apiFetchLikedBooks(token, { limit: 20, cursor: likedCursor })
      if (Array.isArray(page?.books)) {
        const mapped = page.books.map((b: any) => {
          const views = Number(b.views || 0), likes = Number(b.likes_count || 0)
          return { id: String(b.id || b.story_id), title: b.title || b.name,
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
            views, likes, stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} lượt thích` }
        })
        setLiked(current => [...current, ...mapped])
        setLikedCursor(page.nextCursor || null)
        setLikedHasMore(!!page.hasMore)
      }
    } catch (error) { console.error('load liked books page err', error) }
    finally { setLoadingMoreLiked(false) }
  }, [user, likedHasMore, likedCursor, loadingMoreLiked, fmtNum])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    loadAll(false)
    return () => { active = false }
  }, [loadAll]))

  useEffect(() => {
    loadAll(true);
  }, [loadAll]);

  const openBookNow = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

  const openReaderNow = useCallback((id: string, chapterNo?: number) => {
    navigate('/reader/[id]', { id, ch: String(chapterNo && chapterNo > 0 ? chapterNo : 1) })
  }, [navigate])

  const openContinueReading = useCallback((it: any) => {
    const ch = Number(it.chapterNo || 0)
    if (ch > 0) return openReaderNow(String(it.id), ch)
    openBookNow(String(it.id))
  }, [openReaderNow, openBookNow])

  const handleRemoveDownloaded = useCallback(async (bookId: string) => {
    try {
      await removeOfflineBook(String(bookId))
      setDownloaded((prev) => (prev || []).filter((d) => String(d.bookId) !== String(bookId)))
    } catch {
      // ignore
    }
  }, [])

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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accentText} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAll(false)} tintColor={colors.accent} />}
      >
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Thư Viện</Text>
          <Text style={styles.pageSubtitle}>Tủ truyện cá nhân của bạn</Text>
        </View>

        <View style={styles.segmentWrapper}>
          <SegmentedControl tabs={['Đang đọc', 'Đã thích', 'Đã tải']} value={tab} onChange={setTab} />
        </View>

        {tab === 'Đã tải' && (
          <View style={styles.tabContent}>
            {downloaded.length === 0 ? (
              <EmptyState icon="download-outline" title="Chưa có truyện đã tải" subtitle="Vào chi tiết truyện và nhấn Tải về để đọc offline mọi lúc mọi nơi." />
            ) : (
              <View style={styles.card}>
                {downloaded.map((d) => (
                  <StoryRow
                    key={String(d.bookId)}
                    cover={d.cover ? (String(d.cover).startsWith('http') ? String(d.cover) : `${API_BASE}${d.cover}`) : null}
                    title={d.title || `Truyện #${d.bookId}`}
                    meta={`${d.chaptersCount ? `${d.chaptersCount} chương` : 'Offline'}${d.bytes ? ` · ${formatBytes(d.bytes)}` : ''}`}
                    onPress={async () => {
                      try {
                        const p = await getReadingProgress(String(d.bookId))
                        openReaderNow(String(d.bookId), p?.chapterNo || undefined)
                      } catch {
                        openReaderNow(String(d.bookId))
                      }
                    }}
                    right={
                      <Pressable onPress={() => handleRemoveDownloaded(String(d.bookId))} style={styles.deleteBtn}>
                        <Text style={styles.deleteBtnText}>Xóa</Text>
                      </Pressable>
                    }
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'Đang đọc' && (
          <View style={styles.tabContent}>
            {reading.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title="Chưa có truyện đang đọc"
                subtitle="Khám phá kho truyện phong phú và bắt đầu đọc ngay!"
                actionLabel="Khám phá ngay"
                onAction={() => navigate('/(tabs)/explore')}
              />
            ) : (
              <View style={styles.card}>
                {reading.map((it) => (
                  <Pressable key={it.id} onPress={() => openContinueReading(it)} style={styles.readRow}>
                    <StoryRow
                      cover={it.cover}
                      title={it.title}
                      subtitle={it.progress}
                    />
                    <ProgressBar value={it.progressPct} />
                  </Pressable>
                ))}
              </View>
            )}
            {suggestions.length > 0 && (
              <View style={{ marginTop: 24 }}>
                <Text style={styles.sectionTitle}>Gợi ý tiếp theo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                  {suggestions.map((it: any) => (
                    <StoryPoster
                      key={it.id}
                      cover={it.cover}
                      title={it.title}
                      subtitle={it.stats}
                      onPress={() => handleOpenBook(it.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {tab === 'Đã thích' && (
          <View style={styles.tabContent}>
            {liked.length === 0 ? (
              <EmptyState icon="heart-outline" title="Chưa có truyện đã thích" subtitle="Nhấn biểu tượng trái tim tại truyện bạn yêu thích để lưu vào đây." />
            ) : (
              <View style={styles.grid}>
                {liked.map((it) => (
                  <StoryPoster
                    key={it.id}
                    cover={it.cover}
                    title={it.title}
                    subtitle={it.stats}
                    width={POSTER_W}
                    onPress={() => handleOpenBook(it.id)}
                  />
                ))}
              </View>
            )}
            {likedHasMore ? (
              <Pressable onPress={loadMoreLiked} disabled={loadingMoreLiked} style={styles.loadMoreBtn}>
                <Text style={styles.loadMoreText}>{loadingMoreLiked ? 'Đang tải…' : 'Tải thêm truyện đã thích'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <AdInterstitial visible={interstitialVisible} onFinish={() => { setInterstitialVisible(false); if (targetBookId) openBookNow(targetBookId); setTargetBookId(null) }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    paddingTop: 8,
    marginBottom: 14,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  segmentWrapper: {
    marginBottom: 6,
  },
  tabContent: {
    marginTop: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  readRow: {
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    color: colors.text,
    letterSpacing: -0.3,
  },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.dangerSoft,
    marginLeft: 10,
  },
  deleteBtnText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  loadMoreBtn: { marginTop: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
  loadMoreText: { fontSize: 14, fontWeight: '700', color: colors.accentText },
});
