import { useThemeStyles } from '../components/AppTheme'
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Image,
  TouchableOpacity,
  Linking,
  RefreshControl,
  Dimensions,
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native'
import { API_BASE, apiFetchBanners, apiFetchBooks, apiFetchGenres } from '../lib/api'
import { pickHomeRecommendations } from '../lib/homeFeed'
import * as Auth from '../lib/auth'
import { shouldShowPlacement } from '../lib/ads'
import AdInterstitial from '../components/AdInterstitial'

import { useFocusEffect } from '@react-navigation/native'
import { useDebouncedNavigation } from '../lib/navigation'
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BookCardSkeleton } from '../components/SkeletonLoader'
import { cardShadow, cardShadowSm, radius, type AppColors } from '../theme'
import { GenreChip, SectionHeader, StoryPoster, StoryRow } from '../components/ui'

const { width: SCREEN_W } = Dimensions.get('window')
const BANNER_W = Math.min(SCREEN_W - 32, 380)
const BANNER_H = Math.round(BANNER_W * 0.46)

export default function ExplorePage() {
  const { colors, styles } = useThemeStyles(createStyles)

  const [books, setBooks] = useState<any[]>([])
  const [recData, setRecData] = useState<any[]>([])
  const [rankData, setRankData] = useState<any[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const previousUpdated = useRef<{ id: string }[]>([])
  const pageRequestId = useRef(0)
  const [refreshing, setRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [entryAdVisible, setEntryAdVisible] = useState(false)
  const [greetingName, setGreetingName] = useState('')
  const [activeBanner, setActiveBanner] = useState(0)
  const { navigate: navigateTo } = useDebouncedNavigation()

  const navigate = navigateTo

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  const mapBook = useCallback((b: any, idx: number) => {
    const rawViews = Number(b.views ?? b.view_count ?? b.reads ?? b.view ?? b.total_views ?? 0)
    const views = Number.isFinite(rawViews) ? Math.max(0, rawViews) : 0
    const likes = Number(b.likes_count || b.likes || b.favorites || 0)
    return {
      id: String(b.id || b.story_id || idx + 1),
      title: b.title || b.name || 'Không rõ',
      genre: b.genre || '',
      views, likes,
      desc: b.description || b.desc || '',
      cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
    }
  }, [])

  const loadBooks = useCallback(async () => {
    const requestId = ++pageRequestId.current
    setRefreshing(true)
    setIsLoading(true)
    try {
      const token = await Auth.getToken()
      const [res, ranked, recommended, genreRows]: any[] = await Promise.all([
        apiFetchBooks(token || undefined, { limit: 50, sort: 'recent' }),
        apiFetchBooks(token || undefined, { limit: 5, sort: 'views' }),
        apiFetchBooks(token || undefined, { limit: 5, sort: 'recommended' }),
        apiFetchGenres(token || undefined),
      ])
      if (requestId !== pageRequestId.current) return
      if (res && res.error) {
        console.error('fetch books err', res)
        setError(res.message || 'Network request failed')
        setBooks([])
        setRecData([])
      } else if (res && Array.isArray(res.books)) {
        const updated = pickHomeRecommendations(res.books.map(mapBook), previousUpdated.current, 5)
        previousUpdated.current = updated
        setBooks(updated)
        setRankData(Array.isArray(ranked?.books) ? ranked.books.map(mapBook) : [])
        setRecData(Array.isArray(recommended?.books) ? recommended.books.map(mapBook) : [])
        setGenres(Array.isArray(genreRows) ? genreRows.map((item: any) => String(item.name || '')).filter(Boolean) : [])
        setError(null)
      } else {
        setBooks([])
        setRecData([])
      }
    } catch (e) {
      if (requestId !== pageRequestId.current) return
      console.error('fetch books err', e)
      setError(String(e))
      setBooks([])
      setRecData([])
    } finally {
      if (requestId === pageRequestId.current) {
        setRefreshing(false)
        setIsLoading(false)
      }
    }
  }, [mapBook])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
      const name = u?.fullname || u?.name || (u?.email ? String(u.email).split('@')[0] : '')
      setGreetingName(name)
    })
    loadBooks()
    return () => { active = false }
  }, [loadBooks]))

  useEffect(() => {
    if (!userLoaded) return
    if (shouldShowPlacement('home-once', user)) setEntryAdVisible(true)
  }, [userLoaded, user])

  const handleOpenBook = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

  const availableGenres = ['Tất cả', ...genres]

  const [banners, setBanners] = useState<any[]>([])
  useEffect(() => {
    let mounted = true
    async function loadB() {
      try {
        const json = await apiFetchBanners()
        if (!mounted) return
        if (Array.isArray(json)) setBanners(json.filter((b: any) => b && b.enabled !== false))
      } catch (e) {
        console.error('fetch banners err', e)
      }
    }
    loadB()
    return () => { mounted = false }
  }, [])

  const handleBannerPress = async (url?: string) => {
    if (!url) return
    const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    try {
      const supported = await Linking.canOpenURL(normalized)
      if (supported) await Linking.openURL(normalized)
    } catch (e) {
      console.error('open banner url error', e)
    }
  }

  const handleBannerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const slide = Math.round(e.nativeEvent.contentOffset.x / (BANNER_W + 12))
    if (slide >= 0 && slide < banners.length && slide !== activeBanner) {
      setActiveBanner(slide)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadBooks} tintColor={colors.accent} />}
      >
        {/* Top Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerGreeting}>
              {greetingName ? `Xin chào, ${greetingName} 👋` : 'Xin chào bạn đọc 👋'}
            </Text>
            <Text style={styles.headerSubtitle}>Hôm nay bạn muốn đọc gì?</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => navigate('/notifications')} style={styles.iconBtn}>
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => navigate('/(tabs)/profile')} style={styles.iconBtn}>
              <Ionicons name="person-outline" size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Search & AI Bar */}
        <View style={styles.searchRow}>
          <Pressable onPress={() => navigate('/search')} style={styles.searchBox}>
            <Ionicons name="search-outline" size={20} color={colors.accentText} />
            <Text style={styles.searchPlaceholder}>Tìm truyện, tác giả, thể loại…</Text>
          </Pressable>
          <Pressable onPress={() => navigate('/chatbot')} style={styles.aiBtn}>
            <Ionicons name="sparkles" size={19} color={colors.onAccent} />
          </Pressable>
        </View>

        {/* Genre Tags */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreRow}
        >
          {availableGenres.map((g) => (
            <GenreChip
              key={g}
              label={g}
              onPress={() => {
                if (g === 'Tất cả') navigate('/search')
                else navigate('/search', { genre: g })
              }}
            />
          ))}
        </ScrollView>

        {/* Banners Carousel */}
        {banners.length > 0 && (
          <View style={styles.bannerSection}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleBannerScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {banners.map((banner) => (
                <Pressable
                  key={banner.id}
                  style={styles.bannerItem}
                  onPress={() => handleBannerPress(banner.link)}
                >
                  {banner.image_url ? (
                    <Image source={{ uri: banner.image_url }} style={styles.bannerImage} resizeMode="cover" />
                  ) : (
                    <View style={[styles.bannerImage, { backgroundColor: colors.accentSoft }]} />
                  )}
                </Pressable>
              ))}
            </ScrollView>

            {/* Pagination Dots */}
            {banners.length > 1 && (
              <View style={styles.paginationRow}>
                {banners.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      i === activeBanner ? styles.dotActive : styles.dotInactive,
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Section: Trending / Ranking */}
        <SectionHeader title="Bảng xếp hạng hot" action="Xem tất cả" onAction={() => navigate('/(tabs)/rank')} />

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>Không thể kết nối máy chủ: {error}</Text>
            <TouchableOpacity onPress={() => { setError(null); loadBooks() }} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Thử lại</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLoading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hPad}>
            {[0, 1, 2, 3].map((idx) => (
              <View key={idx} style={{ marginRight: 12 }}>
                <BookCardSkeleton />
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hPad}>
            {rankData.map((item, index) => (
              <View key={item.id} style={{ marginRight: 14 }}>
                <StoryPoster
                  cover={item.cover}
                  title={item.title}
                  subtitle={`${fmtNum(item.views)} lượt xem`}
                  rank={index}
                  onPress={() => handleOpenBook(item.id)}
                />
              </View>
            ))}
          </ScrollView>
        )}

        {/* Section: Recommended Stories */}
        <SectionHeader title="Có thể bạn sẽ thích" action="Khám phá thêm" onAction={() => navigate('/search')} />
        {isLoading ? (
          recData.length === 0 ? (
            [0, 1, 2].map((idx) => (
              <View key={idx} style={{ marginHorizontal: 16, marginBottom: 10 }}>
                <BookCardSkeleton variant="horizontal" />
              </View>
            ))
          ) : null
        ) : (
          <View style={styles.recCard}>
            {recData.map((it) => (
              <StoryRow
                key={it.id}
                cover={it.cover}
                title={it.title}
                subtitle={it.genre || it.desc}
                meta={`${fmtNum(Number(it.views || 0))} lượt xem · ${fmtNum(Number(it.likes || 0))} thích`}
                onPress={() => handleOpenBook(it.id)}
              />
            ))}
          </View>
        )}

        <SectionHeader title="Truyện mới cập nhật" action="Tìm thêm" onAction={() => navigate('/search')} />
        <View style={styles.recCard}>
          {books.slice(0, 5).map((item) => (
            <StoryRow key={item.id} cover={item.cover} title={item.title} subtitle={item.genre || item.desc}
              meta={`${fmtNum(Number(item.views || 0))} lượt xem`} onPress={() => handleOpenBook(item.id)} />
          ))}
        </View>

        <AdInterstitial visible={entryAdVisible} placement="home" onFinish={() => {
          setEntryAdVisible(false)
        }} />
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
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  headerGreeting: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: "500",
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadowSm,
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadowSm,
  },
  searchBoxPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  searchPlaceholder: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "500",
  },
  aiBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    justifyContent: "center",
    alignItems: "center",
    ...cardShadowSm,
  },
  genreRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  bannerSection: {
    marginTop: 16,
  },
  bannerItem: {
    width: BANNER_W,
    height: BANNER_H,
    marginRight: 12,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  bannerImage: {
    width: "100%",
    height: "100%",
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.accent,
  },
  dotInactive: {
    width: 6,
    backgroundColor: colors.border,
  },
  hPad: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  recCard: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  errorBox: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: 6,
  },
  errorText: {
    color: colors.dangerText,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  retryBtnText: {
    color: colors.dangerText,
    fontWeight: '700',
    fontSize: 12,
  },

});
