import { useMemo, useState, useEffect, useCallback } from "react";
import { Image, TouchableOpacity, Linking, RefreshControl } from 'react-native'
import { API_BASE, apiFetchBooks } from '../lib/api'
import * as Auth from '../lib/auth'
import { shouldShowAds, shouldShowPlacement } from '../lib/ads'
import AdInterstitial from '../components/AdInterstitial'
import { useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BookCardSkeleton } from '../components/SkeletonLoader'

type RankItem = {
  id: string;
  title: string;
  subtitle: string;
  stats: string;
  cover?: string;
};

type RecommendItem = {
  id: string;
  title: string;
  desc: string;
  stats: string;
  cover?: string;
};

const TABS = ["Đề xuất"] as const;

export default function ExplorePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [books, setBooks] = useState<any[]>([])
  const [recData, setRecData] = useState<RecommendItem[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [entryAdVisible, setEntryAdVisible] = useState(false)
  const router = useRouter()
  const loadBooks = useCallback(async () => {
    let mounted = true
    setRefreshing(true)
    setIsLoading(true)
    try {
      const res: any = await apiFetchBooks()
      if (!mounted) return
      if (res && res.error) {
        console.error('fetch books err', res)
        setError(res.message || 'Network request failed')
        setBooks([])
        setRecData([])
      } else if (Array.isArray(res)) {
        const mapped = res.map((b: any, idx: number) => {
          const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
          const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
          return {
            id: String(b.id || b.story_id || idx + 1),
            title: b.title || b.name || 'Không rõ',
            genre: b.genre || '',
            views,
            likes,
            desc: b.description || b.desc || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
          }
        })
        setBooks(mapped)

        // Random 6 books for "Có Thể Bạn Sẽ Thích".
        // IMPORTANT: randomization happens only when data is (re)loaded.
        const pool = [...mapped]
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const tmp = pool[i]
          pool[i] = pool[j]
          pool[j] = tmp
        }
        setRecData(
          pool.slice(0, 6).map((b: any) => ({
            id: String(b.id),
            title: b.title || '',
            desc: b.desc || '',
            stats: `${fmtNum(Number(b.views || 0))} lượt xem · ${fmtNum(Number(b.likes || 0))} lượt thích`,
            cover: b.cover ? (String(b.cover).startsWith('http') ? b.cover : `${API_BASE}${b.cover}`) : null
          }))
        )

        setError(null)
      } else {
        setBooks([])
        setRecData([])
      }
    } catch (e) {
      console.error('fetch books err', e)
      setError(String(e))
      setBooks([])
      setRecData([])
    } finally {
      if (mounted) {
        setRefreshing(false)
        setIsLoading(false)
      }
    }
    return () => { mounted = false }
  }, [])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    // Refresh on focus so the home widgets (BXH + Có Thể Bạn Sẽ Thích) show updated likes/views.
    loadBooks()
    return () => { active = false }
  }, [loadBooks]))

  // Home entry ad: show only once per session
  useEffect(() => {
    if (!userLoaded) return
    if (shouldShowPlacement('home-once', user)) setEntryAdVisible(true)
  }, [userLoaded, user])

  // NOTE: don't call loadBooks() here; useFocusEffect already loads on initial focus.

  function openBookNow(id: string) {
    router.push({ pathname: '/book/[id]', params: { id } } as any)
  }

  function handleOpenBook(id: string) {
    openBookNow(id)
  }

  const fmtNum = (n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0)

  const topByViews = useMemo(() => {
    return [...books]
      .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
      .slice(0, 6)
  }, [books])

  const rankColumns: RankItem[][] = useMemo(() => {
    const cols: RankItem[][] = [];
    const rankData = topByViews.map((b, idx) => ({
      id: String(b.id || idx + 1),
      title: b.title || 'Không rõ',
      subtitle: b.genre || '',
      stats: `${fmtNum(Number(b.views || 0))} lượt xem · ${fmtNum(Number(b.likes || 0))} lượt thích`,
      cover: b.cover ? (String(b.cover).startsWith('http') ? b.cover : `${API_BASE}${b.cover}`) : null
    }))
    for (let i = 0; i < rankData.length; i += 3) {
      cols.push(rankData.slice(i, i + 3));
    }
    return cols;
  }, [topByViews]);

  // recData is now computed in loadBooks() to avoid re-randomizing on unrelated re-renders.

  // banners
  const [banners, setBanners] = useState<any[]>([])
  useEffect(() => {
    let mounted = true
    async function loadB() {
      try {
        const res: any = await (await import('../lib/api')).apiFetchBooks ? await (await import('../lib/api')).apiFetchBooks() : null
        // load banners directly via fetch to /banners
        const r = await fetch(`${API_BASE}/banners`)
        const json = await r.json()
        if (!mounted) return
        if (Array.isArray(json)) setBanners(
          json
            .filter((b: any) => b.enabled !== false)
            .map((b: any) => ({
              ...b,
              image_url: b.image_url && String(b.image_url).startsWith('http') ? b.image_url : (b.image_url ? `${API_BASE}${b.image_url}` : null)
            }))
        )
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
      if (supported) {
        await Linking.openURL(normalized)
      } else {
        console.warn('Cannot open url', normalized)
      }
    } catch (e) {
      console.error('open banner url error', e)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadBooks} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Xin chào! 👋</Text>
            <Text style={styles.headerSubtitle}>Khám phá thế giới truyện hôm nay</Text>
          </View>
          <Link href="/(tabs)/profile" asChild>
            <Pressable style={styles.avatarBtn}>
              <Ionicons name="person-circle-outline" size={36} color="#1088ff" />
            </Pressable>
          </Link>
        </View>

        {/* Search Box */}
        <View style={styles.searchRow}>
          <Link href="/search" asChild>
            <Pressable style={styles.searchBox}>
              <Ionicons name="search-outline" size={20} color="#9ca3af" />
              <Text style={styles.searchPlaceholder}>Tìm kiếm tiểu thuyết, tác giả…</Text>
            </Pressable>
          </Link>
          <Link href="/chatbot" asChild>
            <Pressable style={styles.aiBtn}>
              <Ionicons name="sparkles" size={20} color="#fff" />
            </Pressable>
          </Link>
        </View>

        {/* Banner Section */}
        {banners.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bannerContainer}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {banners.map((banner) => (
              <Pressable
                key={banner.id}
                style={styles.bannerItem}
                onPress={() => handleBannerPress(banner.link)}
              >
                <Image
                  source={{ uri: banner.image_url }}
                  style={styles.bannerImage}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Link href={"/(tabs)/rank"} asChild>
            <Pressable>
              <Text style={styles.sectionTitle}>BXH Tháng Này</Text>
            </Pressable>
          </Link>
          <Text style={styles.sectionAction}>BXH Hoàn Chỉnh</Text>
        </View>
        {error ? (
          <View style={{ padding: 12, backgroundColor: '#fee2e2', borderRadius: 8, marginTop: 8 }}>
            <Text style={{ color: '#b91c1c' }}>Không thể kết nối tới server: {error}</Text>
            <TouchableOpacity onPress={() => { setError(null); (async () => { const res: any = await apiFetchBooks(); if (Array.isArray(res)) setBooks(res); else setError(res.message || 'Network request failed') })() }} style={{ marginTop: 8 }}>
              <Text style={{ color: '#2563eb' }}>Thử lại</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLoading ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
          >
            {[0, 1].map((colIdx) => (
              <View key={colIdx} style={styles.col}>
                {[0, 1, 2].map((rowIdx) => (
                  <View key={rowIdx} style={{ marginBottom: 12 }}>
                    <BookCardSkeleton />
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
          >
            {rankColumns.map((col, colIdx) => (
              <View key={colIdx} style={styles.col}>
                {col.map((item, rowIdx) => {
                  const globalIndex = colIdx * 3 + rowIdx;
                  return (
                    <Pressable key={item.id} style={styles.rankItem} onPress={() => handleOpenBook(item.id)}>
                      <View style={styles.coverWrap}>
                        {item.cover ? (
                          <Image source={{ uri: item.cover }} style={styles.cover} />
                        ) : (
                          <View style={styles.cover} />
                        )}
                        <View
                          style={[
                            styles.rankBadge,
                            globalIndex === 0 && styles.rankGold,
                            globalIndex === 1 && styles.rankSilver,
                            globalIndex === 2 && styles.rankBronze,
                          ]}
                        >
                          <Text style={styles.rankBadgeText}>{globalIndex + 1}</Text>
                        </View>
                      </View>
                      <View style={styles.rankTextWrap}>
                        <Text style={styles.rankTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.rankSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                        <Text style={styles.rankStats}>{item.stats}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Có Thể Bạn Sẽ Thích</Text>
          <Text style={styles.sectionAction}>Thêm</Text>
        </View>
        {isLoading ? (
          <>
            {[0, 1, 2, 3].map((idx) => (
              <View key={idx} style={{ marginBottom: 12 }}>
                <BookCardSkeleton variant="horizontal" />
              </View>
            ))}
          </>
        ) : (
          recData.map((it) => (
            <Pressable key={it.id} style={styles.recItem} onPress={() => handleOpenBook(it.id)}>
              {it.cover ? (
                <Image source={{ uri: it.cover }} style={styles.recCover} />
              ) : (
                <View style={styles.recCover} />
              )}
              <View style={styles.recTextWrap}>
                <Text style={styles.recTitle} numberOfLines={2}>{it.title}</Text>
                <Text style={styles.recDesc} numberOfLines={2}>{it.desc}</Text>
                <Text style={styles.recStats}>{it.stats}</Text>
              </View>
            </Pressable>
          ))
        )}
        <AdInterstitial visible={entryAdVisible} placement="home" onFinish={() => setEntryAdVisible(false)} />
      </ScrollView>

      {/* <AdInterstitial
        visible={entryAdVisible}
        placement="home"
        onFinish={() => setEntryAdVisible(false)}
      /> */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { paddingHorizontal: 16, paddingBottom: 100 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e0f2fe",
    justifyContent: "center",
    alignItems: "center",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 0,
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchPlaceholder: { color: "#9ca3af", fontSize: 15 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  aiBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1088ff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#1088ff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: "#f2f4f7" },
  sectionHeader: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  sectionAction: { fontSize: 12, color: "#6b7280" },
  rankItem: { flexDirection: "row", gap: 12, marginTop: 12, alignItems: "center" },
  coverWrap: { width: 64, height: 86 },
  cover: { width: 64, height: 86, backgroundColor: "#e5e7eb", borderRadius: 8 },
  rankBadge: {
    position: "absolute",
    left: -8,
    top: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#9ca3af",
    alignItems: "center",
    justifyContent: "center",
  },
  rankGold: { backgroundColor: "#f59e0b" },
  rankSilver: { backgroundColor: "#9ca3af" },
  rankBronze: { backgroundColor: "#d97706" },
  rankBadgeText: { color: "#fff", fontWeight: "700" },
  rankTextWrap: { flex: 1 },
  rankTitle: { fontSize: 15, fontWeight: "700" },
  rankSubtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  rankStats: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  colList: { paddingTop: 8, paddingBottom: 4, paddingRight: 16 },
  col: { width: 280, marginRight: 12 },
  recItem: { flexDirection: "row", gap: 12, marginTop: 12 },
  recCover: { width: 64, height: 64, borderRadius: 12, backgroundColor: "#fee2e2" },
  recTextWrap: { flex: 1 },
  recTitle: { fontSize: 15, fontWeight: "700" },
  recDesc: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  recStats: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  bannerContainer: {
    marginTop: 16,
    marginHorizontal: -16,
    marginBottom: 8,
  },
  bannerItem: {
    width: 260,
    height: 120,
    marginRight: 12,
    borderRadius: 10,
    overflow: "hidden",
  },
  bannerImage: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
});
