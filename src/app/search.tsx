import React, { useState, useEffect, useCallback, useRef } from "react";
import { StyleSheet, Text, View, TextInput, FlatList, Pressable, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { apiFetchBooks, API_BASE } from '../lib/api';
import * as Auth from '../lib/auth';
import { useFocusEffect } from '@react-navigation/native'
import { BookCardSkeleton } from '../components/SkeletonLoader'

const GENRES = ["Tất cả", "Ngôn tình", "Hiện đại", "Cổ đại", "Huyền huyễn", "Xuyên không", "Đam mỹ"];

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState("Tất cả");
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const router = useRouter()

  const fmtNum = useCallback((n: number) => Number.isFinite(n) ? n.toLocaleString('vi-VN') : String(n || 0), [])

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedQ(q)
    }, 300)
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [q])

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
            title: b.title || b.name || '',
            author: typeof b.author === 'string' ? b.author : (typeof b.pen_name === 'string' ? b.pen_name : ''),
            genre: b.genre || '',
            cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
            chapters_count: b.chapters_count || (Array.isArray(b.chapters) ? b.chapters.length : 0) || 0,
            views: Number(b.views || b.view_count || b.reads || b.view || b.total_views || 0),
            likes: Number(b.likes_count || b.likes || b.favorites || b.followers_count || 0),
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
  }, [fmtNum]);

  function openBookNow(id: string) {
    router.push({ pathname: '/book/[id]', params: { id } } as any)
  }

  function handleOpenBook(id: string) {
    openBookNow(id)
  }

  const filtered = React.useMemo(() => {
    const query = debouncedQ.trim().toLowerCase();
    let result = books;
    
    // If no search query and "Tất cả" selected, show only first 5 books as suggestions
    if (!query && selectedGenre === "Tất cả") {
      return books.slice(0, 5);
    }
    
    // Filter by genre
    if (selectedGenre !== "Tất cả") {
      result = result.filter((b) => 
        b.genre && b.genre.toLowerCase().includes(selectedGenre.toLowerCase())
      );
    }
    
    // Filter by search query
    if (query) {
      result = result.filter((b) => {
        const titleLc = (b.title || '').toLowerCase();
        const authorLc = typeof b.author === 'string' ? b.author.toLowerCase() : '';
        return titleLc.includes(query) || authorLc.includes(query);
      });
    }
    
    return result;
  }, [debouncedQ, books, selectedGenre]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          placeholder="Tìm truyện, tác giả…"
          placeholderTextColor="#9aa3af"
          value={q}
          onChangeText={setQ}
          style={styles.input}
        />
      </View>

      {/* Genre filters */}
      <View style={styles.genreRow}>
        {GENRES.map((genre) => {
          const active = genre === selectedGenre;
          return (
            <Pressable
              key={genre}
              onPress={() => setSelectedGenre(genre)}
              style={[styles.genreChip, active && styles.genreChipActive]}
            >
              <Text style={[styles.genreText, active && styles.genreTextActive]}>
                {genre}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 16 }}>
          {[0, 1, 2, 3, 4].map((idx) => (
            <View key={idx} style={{ marginBottom: 12 }}>
              <BookCardSkeleton variant="horizontal" />
            </View>
          ))}
        </View>
      ) : (
        <>
          {!q && selectedGenre === "Tất cả" && (
            <View style={styles.hintContainer}>
              <Text style={styles.hintText}>Gợi ý truyện hot</Text>
            </View>
          )}
          <FlatList
            data={filtered}
            keyExtractor={(it) => it.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
                  <Pressable onPress={() => handleOpenBook(item.id)} style={styles.item}>
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={styles.cover} />
                  ) : (
                    <View style={styles.cover} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                    {item.author ? (
                      <Text style={styles.author} numberOfLines={1}>{item.author}</Text>
                    ) : null}
                    <Text style={styles.meta}>
                      {fmtNum(Number(item.views || 0))} lượt xem · {fmtNum(Number(item.likes || 0))} lượt thích
                    </Text>
                    <Text style={styles.meta}>{item.chapters_count} chương</Text>
                  </View>
                </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.divider} />}
            ListEmptyComponent={() => (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Không tìm thấy truyện nào</Text>
              </View>
            )}
          />
        </>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  searchRow: { padding: 16, paddingBottom: 8 },
  input: {
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f2f4f7",
    paddingHorizontal: 12,
    color: "#0f172a",
    fontSize: 14,
  },
  genreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  genreChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f2f4f7",
  },
  genreChipActive: {
    backgroundColor: "#1088ff",
  },
  genreText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "500",
  },
  genreTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  cover: { width: 48, height: 64, borderRadius: 8, backgroundColor: "#e5e7eb" },
  title: { fontSize: 15, color: "#0f172a", fontWeight: "700" },
  author: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  meta: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#eef2f7" },
  empty: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#9ca3af",
  },
  hintContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eef2f7",
  },
  hintText: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "600",
  },
});
