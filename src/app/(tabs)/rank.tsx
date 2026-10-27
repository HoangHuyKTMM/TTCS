import { useThemeStyles } from '../../components/AppTheme'
import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, FlatList, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { useDebouncedNavigation } from '../../lib/navigation'
import { apiFetchBooks, apiFetchGenres, API_BASE } from '../../lib/api';
import * as Auth from '../../lib/auth';
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import { useFocusEffect } from '@react-navigation/native'
import { radius, cardShadow, type AppColors } from '../../theme'
import { EmptyState, GenreChip, StoryRow } from '../../components/ui'

export default function RankScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const [filter, setFilter] = useState<string>('Tất cả');
  const [genres, setGenres] = useState<string[]>(['Tất cả']);
  const [books, setBooks] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { navigate } = useDebouncedNavigation()

  const fmtNum = (n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0)

  const loadBooks = useCallback(async (showSpinner = true) => {
    let mounted = true
    if (showSpinner) setLoading(true)
    setRefreshing(true)
    try {
      const token = await Auth.getToken();
      const [res, catalog]: any[] = await Promise.all([
        apiFetchBooks(token || undefined, { limit: 25, sort: 'views', genre: filter }),
        apiFetchGenres(token || undefined),
      ]);
      if (!mounted) return;
      if (res && Array.isArray(res.books)) {
        setGenres(['Tất cả', ...(Array.isArray(catalog) ? catalog.map((genre: any) => String(genre.name || '')).filter(Boolean) : [])]);
        setBooks(res.books.map((b: any) => {
          const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
          const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
          return {
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            views,
            likes,
            stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} thích`,
            genre: b.genre || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
          }
        }));
        setNextCursor(res.nextCursor || null)
        setHasMore(!!res.hasMore)
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (mounted) {
        if (showSpinner) setLoading(false);
        setRefreshing(false);
      }
    }
    return () => { mounted = false }
  }, [filter])

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const token = await Auth.getToken()
      const page: any = await apiFetchBooks(token || undefined, { limit: 25, cursor: nextCursor, sort: 'views', genre: filter })
      if (Array.isArray(page?.books)) {
        const mapped = page.books.map((b: any) => {
          const views = Number(b.views || 0), likes = Number(b.likes_count || 0)
          return { id: String(b.id || b.story_id), title: b.title || b.name, views, likes,
            stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} thích`, genre: b.genre || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null }
        })
        setBooks(current => [...current, ...mapped])
        setNextCursor(page.nextCursor || null)
        setHasMore(!!page.hasMore)
      }
    } catch (error) { console.error('rank next page err', error) }
    finally { setLoadingMore(false) }
  }, [filter, hasMore, loadingMore, nextCursor])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    loadBooks(false)
    return () => { active = false }
  }, [loadBooks]))

  useEffect(() => {
    loadBooks(true)
  }, [loadBooks])

  const openBookNow = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

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

  const data = books

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Bảng Xếp Hạng</Text>
        <Text style={styles.pageSubtitle}>Top các tác phẩm được đọc nhiều nhất</Text>
      </View>

      {/* Horizontal genre scroll */}
      <View style={styles.filtersWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersRow}
        >
          {genres.map((f) => (
            <GenreChip key={f} label={f} active={f === filter} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accentText} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={data}
          keyExtractor={(it) => it.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadBooks(false)} tintColor={colors.accent} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 18 }} color={colors.accentText} /> : null}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <EmptyState icon="trophy-outline" title="Chưa có bảng xếp hạng" subtitle="Hãy quay lại khi có thêm dữ liệu đọc." />
            </View>
          }
          renderItem={({ item, index }) => (
            <StoryRow
              cover={item.cover}
              title={item.title}
              subtitle={item.genre}
              meta={item.stats}
              rank={index}
              onPress={() => handleOpenBook(item.id)}
            />
          )}
        />
      )}
      <AdInterstitial visible={interstitialVisible} onFinish={() => { setInterstitialVisible(false); if (targetBookId) openBookNow(targetBookId); setTargetBookId(null) }} />
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
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
  filtersWrapper: {
    paddingVertical: 12,
  },
  filtersRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
});
