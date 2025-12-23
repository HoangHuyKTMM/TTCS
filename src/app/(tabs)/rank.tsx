import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, Pressable, FlatList, ActivityIndicator, Image } from "react-native";
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
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const router = useRouter()

  useFocusEffect(useCallback(() => {
    let active = true
    Auth.getUser().then(u => { if (active) setUser(u) })
    return () => { active = false }
  }, []))

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const token = await Auth.getToken();
        const res: any = await apiFetchBooks(token || undefined);
        if (!mounted) return;
        if (Array.isArray(res)) {
          setBooks(res.map((b: any) => ({
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            stats: `${(b.chapters_count || 0)} chương`,
            genre: b.genre || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
          })));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  function openBookNow(id: string) {
    router.push({ pathname: '/book/[id]', params: { id } } as any)
  }

  function handleOpenBook(id: string) {
    if (shouldShowAds(user)) {
      setTargetBookId(id)
      setInterstitialVisible(true)
    } else {
      openBookNow(id)
    }
  }

  const data = books.filter((b: any) => {
    if (filter === 'Tất cả') return true;
    return b.genre && b.genre.toLowerCase().includes(filter.toLowerCase());
  });

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
          renderItem={({ item, index }) => (
            <Pressable onPress={() => handleOpenBook(item.id)} style={styles.item}>
              
                <View style={[styles.rankBadge, index === 0 && styles.gold, index === 1 && styles.silver, index === 2 && styles.bronze]}>
                  <Text style={styles.rankText}>{index + 1}</Text>
                </View>
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
  rankBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#9ca3af", alignItems: "center", justifyContent: "center" },
  rankText: { color: "#fff", fontWeight: "700" },
  gold: { backgroundColor: "#f59e0b" },
  silver: { backgroundColor: "#9ca3af" },
  bronze: { backgroundColor: "#d97706" },
  cover: { width: 48, height: 64, borderRadius: 8, backgroundColor: "#e5e7eb" },
  title: { fontSize: 15, fontWeight: "700", color: "#111827" },
  meta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
});
