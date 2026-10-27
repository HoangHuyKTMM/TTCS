import { useThemeStyles } from '../components/AppTheme'
import React, { useState, useEffect, useCallback, useRef } from "react";
import { StyleSheet, Text, View, TextInput, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetchBooks, apiSearchBooks, API_BASE } from '../lib/api';
import * as Auth from '../lib/auth';
import { BookCardSkeleton } from '../components/SkeletonLoader'
import { useDebouncedNavigation } from '../lib/navigation'
import { GENRES, radius, cardShadow, cardShadowSm, type AppColors } from '../theme'
import { EmptyState, GenreChip, ScreenBack, StoryRow } from '../components/ui'

const SearchResultItem = React.memo(({ item, fmtNum, onPress }: { item: any; fmtNum: (n: number) => string; onPress: (id: string) => void }) => (
  <StoryRow
    cover={item.cover}
    title={item.title}
    subtitle={item.author || item.genre}
    meta={`${fmtNum(Number(item.views || 0))} lượt xem · ${item.chapters_count} chương`}
    onPress={() => onPress(item.id)}
  />
));

export default function SearchScreen() {
  const { colors, styles } = useThemeStyles(createStyles)

  const params = useLocalSearchParams<{ genre?: string }>()
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState(params.genre ? String(params.genre) : "Tất cả");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)
  const { navigate, goBack } = useDebouncedNavigation()

  useEffect(() => {
    if (params.genre) setSelectedGenre(String(params.genre))
  }, [params.genre])

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

  const mapResult = useCallback((b: any) => ({
    id: String(b.id || b.story_id),
    title: b.title || b.name || '',
    author: typeof b.author === 'string' ? b.author : '',
    genre: b.genre || '',
    cover: b.cover_url ? (String(b.cover_url).startsWith('http') ? b.cover_url : `${API_BASE}${b.cover_url}`) : null,
    chapters_count: Number(b.chapters_count || 0),
    views: Number(b.views || b.view_count || 0),
    likes: Number(b.likes_count || b.likes || 0),
  }), [])

  const loadPage = useCallback(async (cursor?: string | null, append = false) => {
    const currentRequest = ++requestId.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const token = await Auth.getToken()
      const query = debouncedQ.trim()
      const result: any = query
        ? await apiSearchBooks(query, { genre: selectedGenre, limit: 20, cursor }, token || undefined)
        : await apiFetchBooks(token || undefined, { limit: 10, sort: 'views', genre: selectedGenre, cursor })
      if (currentRequest !== requestId.current) return
      const rows = Array.isArray(result?.books) ? result.books : []
      const mapped = rows.map(mapResult)
      setBooks(current => append ? [...current, ...mapped] : mapped)
      setNextCursor(result?.nextCursor || null)
      setHasMore(!!result?.hasMore)
    } catch (error) {
      console.error('search request err', error)
      if (currentRequest === requestId.current && !append) setBooks([])
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [debouncedQ, selectedGenre, mapResult])

  useEffect(() => { void loadPage() }, [loadPage])

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && nextCursor) void loadPage(nextCursor, true)
  }, [hasMore, loadingMore, nextCursor, loadPage])

  const handleOpenBook = useCallback((id: string) => {
    navigate('/book/[id]', { id })
  }, [navigate])

  const renderItem = useCallback(({ item }: { item: any }) => (
    <SearchResultItem item={item} fmtNum={fmtNum} onPress={handleOpenBook} />
  ), [fmtNum])

  const keyExtractor = useCallback((item: any) => item.id, [])

  const filtered = books

  return (
    <SafeAreaView style={styles.container}>
      <ScreenBack title="Tìm kiếm" onBack={goBack} />
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          placeholder="Tìm theo tên truyện hoặc nội dung…"
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
          style={styles.input}
          autoFocus
        />
        {q ? (
          <Pressable onPress={() => setQ('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.genreScrollWrapper}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={GENRES as unknown as string[]}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.genreRow}
          renderItem={({ item: genre }) => (
            <GenreChip
              label={genre}
              active={genre === selectedGenre}
              onPress={() => setSelectedGenre(genre)}
            />
          )}
        />
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
          {!q && (
            <View style={styles.hintContainer}>
              <Text style={styles.hintText}>
                {selectedGenre === "Tất cả" ? "Gợi ý truyện hot" : `Thể loại: ${selectedGenre}`}
              </Text>
            </View>
          )}
          <FlatList
            data={filtered}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.list}
            renderItem={renderItem}
            onEndReached={loadMore}
            onEndReachedThreshold={0.55}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            ListEmptyComponent={() => (
              <EmptyState icon="search-outline" title="Không tìm thấy truyện" subtitle="Thử từ khóa khác hoặc đổi thể loại." />
            )}
            ListFooterComponent={loadingMore ? <View style={{ padding: 18 }}><BookCardSkeleton variant="horizontal" /></View> : null}
          />
        </>
      )}

    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadowSm,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  genreScrollWrapper: {
    marginBottom: 10,
  },
  genreRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  hintContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  hintText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "700",
  },
});
