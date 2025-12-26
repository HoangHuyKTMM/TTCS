import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, Pressable, FlatList, ActivityIndicator, Image, RefreshControl } from "react-native";
import { Link, useRouter } from "expo-router";
import { apiFetchBooks, API_BASE } from '../../lib/api';
import * as Auth from '../../lib/auth';
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import { useFocusEffect } from '@react-navigation/native'

const FILTERS = ["Tất cả", "Ngôn tình", "Hiện đại", "Cổ đại", "Huyền huyễn"] as const;

export default function RankScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(FILTERS[0]);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const router = useRouter()

  const fmtNum = (n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0)

  const loadBooks = useCallback(async (showSpinner = true) => {
    let mounted = true
    if (showSpinner) setLoading(true)
    setRefreshing(true)
    try {
      const token = await Auth.getToken();
      const res: any = await apiFetchBooks(token || undefined);
      if (!mounted) return;
      if (Array.isArray(res)) {
        setBooks(res.map((b: any) => {
          const views = Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0)
          const likes = Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0)
          return {
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            views,
            likes,
            stats: `${fmtNum(views)} lượt xem · ${fmtNum(likes)} lượt thích`,
            genre: b.genre || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
          }
        }));
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
  }, [])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    // When returning from Book Detail (like/view changes), refresh to show updated stats.
    // Avoid showing the full-screen spinner on focus.
    loadBooks(false)
    return () => { active = false }
  }, [loadBooks]))

  useEffect(() => {
    loadBooks(true)
  }, [loadBooks])

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

  const data = books
    .filter((b: any) => {
      if (filter === 'Tất cả') return true;
      return b.genre && b.genre.toLowerCase().includes(filter.toLowerCase());
    })
    // Sắp xếp theo lượt xem (giảm dần)
    .sort((a: any, b: any) => Number(b.views || 0) - Number(a.views || 0));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.filtersRow}>
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, active && styles.filterChipActive]}>
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={data}
          keyExtractor={(it) => it.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>loadBooks(false)} />}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => handleOpenBook(item.id)} style={styles.item}>
                {item.cover ? (
                  <Image source={{ uri: item.cover }} style={styles.cover} />
                ) : (
                  <View style={styles.cover} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.meta}>{item.stats}</Text>
                </View>
              </Pressable>
          )}
        />
      )}
      <AdInterstitial visible={interstitialVisible} onFinish={() => { setInterstitialVisible(false); if (targetBookId) openBookNow(targetBookId); setTargetBookId(null) }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  filtersRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 16 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#f2f4f7" },
  filterChipActive: { backgroundColor: "#1088ff22" },
  filterText: { fontSize: 12, color: "#374151" },
  filterTextActive: { color: "#1088ff", fontWeight: "700" },

  list: { paddingHorizontal: 16, paddingBottom: 24 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eef2f7" },
  cover: { width: 48, height: 64, borderRadius: 8, backgroundColor: "#e5e7eb" },
  title: { fontSize: 15, fontWeight: "700", color: "#111827" },
  meta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
});
