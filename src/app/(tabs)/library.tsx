import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, Pressable, Image } from "react-native";
import { useRouter } from 'expo-router';
import { apiFetchBooks, API_BASE } from '../../lib/api';
import * as Auth from '../../lib/auth';
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import { getReadingList } from '../../lib/reading'
import { useFocusEffect } from '@react-navigation/native'

export default function LibraryScreen() {
  const [reading, setReading] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([])
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
          setSaved(res.slice(2, 6).map((b: any) => ({
            id: String(b.id || b.story_id),
            title: b.title || b.name,
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
          })));
        }

        // load local reading progress and suggestions
        try {
          const list = await getReadingList()
          if (Array.isArray(list) && list.length) {
            setReading(list.map((r: any) => ({
              id: String(r.bookId),
              title: r.title || `Truyện #${r.bookId}`,
              cover: r.cover || null,
              progress: r.chapterNo ? `Ch. ${r.chapterNo}` : (r.chapter ? `Ch. ${r.chapter}` : ''),
              genre: r.genre,
            })));

            // fetch suggestions by genre for first reading item
            const first = list[0]
            if (first && first.genre) {
              try {
                const all: any = await apiFetchBooks(token || undefined)
                if (Array.isArray(all)) {
                  const filtered = all.filter((b: any) => {
                    const g = b.genre || b.category || b.type
                    return g && String(g).toLowerCase() === String(first.genre).toLowerCase() && String(b.id || b.story_id) !== String(first.bookId)
                  }).slice(0, 6)
                  setSuggestions(filtered.map((b: any) => ({ id: String(b.id || b.story_id), title: b.title || b.name, cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null })))
                }
              } catch (e) {
                // ignore
              }
            }
          }
        } catch (e) {
          // ignore
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Đang đọc</Text>
        {reading.length === 0 ? (
          <Empty title="Chưa có truyện đang đọc" subtitle="Bắt đầu từ Khám phá để thêm truyện." />
        ) : (
          <View style={styles.card}>
            {reading.map((it, idx) => (
                <Pressable key={it.id} onPress={() => handleOpenBook(it.id)} style={[styles.row, idx !== 0 && styles.rowDivider]}>
                  {it.cover ? (
                    <Image source={{ uri: it.cover }} style={styles.coverSm} />
                  ) : (
                    <View style={styles.coverSm} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.meta}>{it.progress}</Text>
                  </View>
                </Pressable>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Đã lưu</Text>
        {saved.length === 0 ? (
          <Empty title="Chưa lưu truyện nào" subtitle="Nhấn Lưu ở chi tiết truyện để thêm vào đây." />
        ) : (
          <View style={styles.card}>
            {saved.map((it, idx) => (
                <Pressable key={it.id} onPress={() => handleOpenBook(it.id)} style={[styles.row, idx !== 0 && styles.rowDivider]}>
                  {it.cover ? (
                    <Image source={{ uri: it.cover }} style={styles.coverSm} />
                  ) : (
                    <View style={styles.coverSm} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.meta}>Đã lưu</Text>
                  </View>
                </Pressable>
            ))}
          </View>
        )}

        {suggestions.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Gợi ý cho bạn</Text>
            <View style={styles.card}>
              {suggestions.map((it:any, idx:number) => (
                <Pressable key={it.id} onPress={() => handleOpenBook(it.id)} style={[styles.row, idx !== 0 && styles.rowDivider]}>
                  {it.cover ? (
                    <Image source={{ uri: it.cover }} style={styles.coverSm} />
                  ) : (
                    <View style={styles.coverSm} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.meta}>Thể loại tương tự</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <AdInterstitial visible={interstitialVisible} onFinish={() => { setInterstitialVisible(false); if (targetBookId) openBookNow(targetBookId); setTargetBookId(null) }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 16, paddingBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "#eef2f7" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#eef2f7" },
  coverSm: { width: 44, height: 60, borderRadius: 8, backgroundColor: "#e5e7eb" },
  title: { fontSize: 15, fontWeight: "700", color: "#111827" },
  meta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  empty: { padding: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc", borderRadius: 12 },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#e5e7eb", marginBottom: 8 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  emptySub: { fontSize: 12, color: "#6b7280", marginTop: 4, textAlign: "center" },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 }
});
