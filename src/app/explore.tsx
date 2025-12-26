import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Image, TouchableOpacity, Linking, RefreshControl } from 'react-native'
import { API_BASE, apiFetchBooks } from '../lib/api'
import * as Auth from '../lib/auth'
import { shouldShowAds } from '../lib/ads'
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

  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [entryAdVisible, setEntryAdVisible] = useState(false)
  const entryAdShownRef = useRef(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const pendingOpenRef = useRef(false)
  const router = useRouter()
  const loadBooks = useCallback(async () => {
    let mounted = true
    setRefreshing(true)
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
      if (mounted) setRefreshing(false)
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

  // Show full-screen ad when entering this page (replace the top banner ad).
  useEffect(() => {
    if (!userLoaded) return
    if (!shouldShowAds(user)) return
    if (entryAdShownRef.current) return
    entryAdShownRef.current = true
    setEntryAdVisible(true)
  }, [userLoaded, user])

  // NOTE: don't call loadBooks() here; useFocusEffect already loads on initial focus.

  function openBookNow(id: string) {
    router.push({ pathname: '/book/[id]', params: { id } } as any)
  }

  function handleOpenBook(id: string) {
    // Don't decide before we know the user's role.
    if (!userLoaded) {
      setTargetBookId(id)
      pendingOpenRef.current = true
      return
    }
    if (!shouldShowAds(user)) return openBookNow(id)
    setTargetBookId(id)
    setInterstitialVisible(true)
  }

  // If user tapped a book before role loaded, resolve it after load.
  useEffect(() => {
    if (!userLoaded) return
    if (!pendingOpenRef.current) return
    if (!targetBookId) return
    pendingOpenRef.current = false
    if (!shouldShowAds(user)) {
      openBookNow(targetBookId)
      setTargetBookId(null)
      return
    }
    setInterstitialVisible(true)
  }, [userLoaded, user, targetBookId])

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
        <View style={styles.tabsRow}>
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabItem]}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t}</Text>
                {active ? <View style={styles.tabIndicator} /> : <View style={styles.tabIndicatorHidden} />}
              </Pressable>
            );
          })}
        </View>

        {tab === TABS[0] && (
          <View style={styles.searchRow}>
            <Link href={"/search"} asChild>
              <Pressable style={styles.searchBox}>
                <Text style={styles.searchPlaceholder}>Tìm kiếm tiểu thuyết, tác giả…</Text>
              </Pressable>
            </Link>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Link href={"/(tabs)/rank"} asChild>
            <Pressable>
              <Text style={styles.sectionTitle}>BXH Tháng Này</Text>
            </Pressable>
          </Link>
          <Text style={styles.sectionAction}>BXH Hoàn Chính</Text>
        </View>
        {error ? (
          <View style={{ padding: 12, backgroundColor: '#fee2e2', borderRadius: 8, marginTop: 8 }}>
            <Text style={{ color: '#b91c1c' }}>Không thể kết nối tới server: {error}</Text>
            <TouchableOpacity onPress={() => { setError(null); (async () => { const res: any = await apiFetchBooks(); if (Array.isArray(res)) setBooks(res); else setError(res.message || 'Network request failed') })() }} style={{ marginTop: 8 }}>
              <Text style={{ color: '#2563eb' }}>Thử lại</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {banners.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
            {banners.map(b => (
              <TouchableOpacity key={b.id} activeOpacity={0.8} onPress={() => handleBannerPress(b.link)} disabled={!b.link}>
                <Image source={{ uri: b.image_url }} style={{ width: 320, height: 120, borderRadius: 8, marginRight: 12, opacity: b.link ? 1 : 0.9 }} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.colList}
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Có Thể Bạn Sẽ Thích</Text>
          <Text style={styles.sectionAction}>Thêm</Text>
        </View>
        {recData.map((it) => (
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
        ))}
        <AdInterstitial visible={interstitialVisible} placement="interstitial" onFinish={() => { setInterstitialVisible(false); if (targetBookId) openBookNow(targetBookId); setTargetBookId(null) }} />
      </ScrollView>

      <AdInterstitial
        visible={entryAdVisible}
        placement="home"
        onFinish={() => setEntryAdVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  tabsRow: {
    flexDirection: "row",
    gap: 16,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "flex-end",
  },
  tabItem: { alignItems: "center" },
  tabText: { fontSize: 18, color: "#111" },
  tabTextActive: { color: "#1088ff", fontWeight: "700" },
  tabIndicator: {
    width: 24,
    height: 3,
    backgroundColor: "#1088ff",
    borderRadius: 2,
    marginTop: 4,
  },
  tabIndicatorHidden: { width: 24, height: 3, backgroundColor: "transparent", marginTop: 4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  searchBox: {
    flex: 1,
    height: 40,
    backgroundColor: "#f2f4f7",
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  searchPlaceholder: { color: "#9aa3af", fontSize: 14 },
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
  colList: { paddingTop: 8, paddingBottom: 4 },
  col: { width: 280, marginRight: 12 },
  recItem: { flexDirection: "row", gap: 12, marginTop: 12 },
  recCover: { width: 64, height: 64, borderRadius: 12, backgroundColor: "#fee2e2" },
  recTextWrap: { flex: 1 },
  recTitle: { fontSize: 15, fontWeight: "700" },
  recDesc: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  recStats: { fontSize: 12, color: "#6b7280", marginTop: 6 },
});
