import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View, ScrollView, ActivityIndicator, Pressable, Image, RefreshControl } from "react-native";
import { useRouter } from 'expo-router';
import { useDebouncedNavigation } from '../../lib/navigation'
import { apiFetchBooks, API_BASE } from '../../lib/api';
import * as Auth from '../../lib/auth';
import AdInterstitial from '../../components/AdInterstitial'
import { shouldShowAds } from '../../lib/ads'
import { getReadingList } from '../../lib/reading'
import { useFocusEffect } from '@react-navigation/native'
import { listOfflineBooks, removeOfflineBook, formatBytes, type OfflineBookMeta } from '../../lib/offline'

export default function LibraryScreen() {
  const [reading, setReading] = useState<any[]>([]);
  const [liked, setLiked] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [downloaded, setDownloaded] = useState<OfflineBookMeta[]>([])
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [interstitialVisible, setInterstitialVisible] = useState(false)
  const [targetBookId, setTargetBookId] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const router = useRouter()
  const { navigate } = useDebouncedNavigation()

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    return () => { active = false }
  }, []))

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

      const res: any = await apiFetchBooks(token || undefined);
      if (Array.isArray(res)) {
        const likedList = res.filter((b: any) => b.liked).map((b: any) => {
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
                setSuggestions(filtered.map((b: any) => {
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
          }
        } else {
          setReading([])
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

  useEffect(() => {
    loadAll(true);
  }, [loadAll]);

  const openBookNow = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

  const openReaderNow = useCallback((id: string) => {
    navigate('/reader/[id]', { id, ch: '1' })
  }, [navigate])

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
          <ActivityIndicator size="large" color="#1088ff" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>loadAll(false)} />}
      >
        <Text style={styles.sectionTitle}>Đã tải về</Text>
        {downloaded.length === 0 ? (
          <Empty title="Chưa có truyện đã tải" subtitle="Vào Chi tiết truyện và nhấn Tải về để đọc offline." />
        ) : (
          <View style={styles.card}>
            {downloaded.map((d, idx) => (
              <View key={String(d.bookId)} style={[styles.row, idx !== 0 && styles.rowDivider]}>
                <Pressable onPress={() => openReaderNow(String(d.bookId))} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  {d.cover ? (
                    <Image source={{ uri: String(d.cover).startsWith('http') ? String(d.cover) : `${API_BASE}${d.cover}` }} style={styles.coverSm} />
                  ) : (
                    <View style={styles.coverSm} />
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.title} numberOfLines={1}>{d.title || `Truyện #${d.bookId}`}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {d.chaptersCount ? `${d.chaptersCount} chương` : 'Offline'}{d.bytes ? ` · ${formatBytes(d.bytes)}` : ''}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => handleRemoveDownloaded(String(d.bookId))} style={[styles.smallBtn]}>
                  <Text style={styles.smallBtnText}>Xóa</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

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

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Đã thích</Text>
        {liked.length === 0 ? (
          <Empty title="Chưa có truyện đã thích" subtitle="Nhấn Yêu thích tại chi tiết truyện để thêm vào đây." />
        ) : (
          <View style={styles.card}>
            {liked.map((it, idx) => (
                <Pressable key={it.id} onPress={() => handleOpenBook(it.id)} style={[styles.row, idx !== 0 && styles.rowDivider]}>
                  {it.cover ? (
                    <Image source={{ uri: it.cover }} style={styles.coverSm} />
                  ) : (
                    <View style={styles.coverSm} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.meta}>{it.stats || 'Đã thích'}</Text>
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
                    <Text style={styles.meta}>{it.stats || 'Thể loại tương tự'}</Text>
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
  ,
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#fee2e2', marginLeft: 10 },
  smallBtnText: { color: '#b91c1c', fontWeight: '800', fontSize: 12 }
});
