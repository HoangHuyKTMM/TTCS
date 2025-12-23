import React, { useMemo, useEffect, useState, useCallback } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, ActivityIndicator, Image, Alert, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from '@react-navigation/native'

import { apiFetchBook, API_BASE, apiDonateCoins, apiLikeBook, apiUnlikeBook, apiFollowBook, apiUnfollowBook, apiFetchComments, apiPostComment } from '../../lib/api'
import * as Auth from '../../lib/auth'
import AdBanner from '../../components/AdBanner'
import { shouldShowAds } from '../../lib/ads'

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any | null>(null)
  const [donateAmount, setDonateAmount] = useState<number>(50)
  const [likesCount, setLikesCount] = useState<number>(0)
  const [followersCount, setFollowersCount] = useState<number>(0)
  const [liked, setLiked] = useState<boolean>(false)
  const [following, setFollowing] = useState<boolean>(false)
  const [comments, setComments] = useState<any[]>([])
  const [commentText, setCommentText] = useState<string>('')

  useFocusEffect(useCallback(() => {
    let active = true
    Auth.getUser().then(u => { if (active) setUser(u) })
    return () => { active = false }
  }, []))

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!id) return
      setLoading(true)
      try {
        const token = await Auth.getToken()
        const res: any = await apiFetchBook(String(id), token || undefined)
        if (!mounted) return
        if (res && !res.error) {
          // normalize to Book shape
          const b: Book = {
            id: String(res.id || res.story_id || id),
            title: res.title || res.name || 'Tiểu thuyết chưa rõ',
            tags: res.tags || (res.genre ? [res.genre] : []),
            stats: `${(res.followers_count || 0)} theo dõi · ${((res.chapters && res.chapters.length) || res.chapters_count || 0)} chương`,
            desc: res.description || res.desc || res.content || '',
            cover: res.cover_url ? (String(res.cover_url).startsWith('http') ? res.cover_url : `${API_BASE}${res.cover_url}`) : null,
            chapters: Array.isArray(res.chapters) ? res.chapters.map((c: any, idx: number) => ({ id: String(c.id || c.chapter_id || `${id}-c${idx+1}`), title: c.title || `Chương ${idx+1}`, content: c.content || c.body || c.text || '' })) : []
          }
          setBook(b)
          setLikesCount(Number(res.likes_count || 0))
          setFollowersCount(Number(res.followers_count || 0))
          setLiked(!!res.liked)
          setFollowing(!!(res.follow && res.follow.id))
          refreshComments(String(res.id || res.story_id || id))
          return
        }
      } catch (e) {
        console.error('fetch book err', e)
      } finally {
        if (mounted) setLoading(false)
      }
      // fallback to mock/default
      setBook(defaultBook(id || 'unknown'))
    }
    load()
    return () => { mounted = false }
  }, [id])

  async function handleDonate(amount: number) {
    setDonateAmount(amount)
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Hãy đăng nhập để tặng xu cho tác giả.')
      return
    }
    if (!id) return
    try {
      const res: any = await apiDonateCoins(String(id), amount, undefined, token)
      if (res && !res.error) {
        Alert.alert('Cảm ơn bạn!', `Đã tặng ${amount} xu cho tác giả.`)
      } else {
        Alert.alert('Lỗi', String(res && (res.error || res.message) || 'Không rõ lỗi'))
      }
    } catch (e: any) {
      console.error('donate err', e)
      Alert.alert('Lỗi', e && e.message ? e.message : String(e))
    }
  }

  async function handleToggleLike() {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để yêu thích truyện.')
      return
    }
    if (!id) return
    try {
      if (liked) {
        await apiUnlikeBook(String(id), token)
        setLiked(false)
        setLikesCount((c) => Math.max(0, c - 1))
      } else {
        await apiLikeBook(String(id), token)
        setLiked(true)
        setLikesCount((c) => c + 1)
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  async function handleToggleFollow() {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để theo dõi truyện.')
      return
    }
    if (!id) return
    try {
      if (following) {
        await apiUnfollowBook(String(id), token)
        setFollowing(false)
        setFollowersCount((c) => Math.max(0, c - 1))
      } else {
        await apiFollowBook(String(id), token)
        setFollowing(true)
        setFollowersCount((c) => c + 1)
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  async function refreshComments(bookId: string) {
    try {
      const list = await apiFetchComments(bookId)
      if (Array.isArray(list)) setComments(list)
    } catch (e) {
      // ignore
    }
  }

  async function handleSubmitComment() {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để bình luận.')
      return
    }
    if (!id) return
    if (!commentText.trim()) return
    try {
      const res: any = await apiPostComment(String(id), commentText.trim(), null, token)
      if (res && !res.error) {
        setCommentText('')
        refreshComments(String(id))
      } else {
        Alert.alert('Lỗi', String(res?.error || 'Không gửi được bình luận'))
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  // Defensive render: don't attempt to render full UI until we have a book object.
  if (!book) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ padding: 16 }}>
          <Text style={styles.title}>{id ? 'Đang tải...' : 'Tiểu thuyết'}</Text>
          <View style={{ marginTop: 12 }}>
            <ActivityIndicator size="large" color="#1088ff" />
          </View>
        </View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          {book.cover ? (
            <Image source={{ uri: book.cover }} style={styles.coverLg} />
          ) : (
            <View style={styles.coverLg} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>{book ? book.title : '...'}</Text>
              <Text style={styles.meta} numberOfLines={1}>{book ? book.tags.join(" / ") : ''}</Text>
              <Text style={styles.meta2}>{`${followersCount} theo dõi · ${(book?.chapters || []).length} chương · ${likesCount} yêu thích`}</Text>
            <View style={styles.actionRow}>
              <Pressable onPress={handleToggleFollow} style={[styles.btnSecondary, following && styles.btnSecondaryActive]}>
                <Text style={[styles.btnSecondaryText, following && styles.btnSecondaryTextActive]}>{following ? 'Đang theo dõi' : 'Theo dõi'}</Text>
              </Pressable>
              <Link href={{ pathname: "/reader/[id]", params: { id: id || (book ? book.id : ''), ch: "1" } } as any} asChild>
                <Pressable style={styles.btnPrimary}><Text style={styles.btnPrimaryText}>Đọc từ đầu</Text></Pressable>
              </Link>
              <Pressable onPress={handleToggleLike} style={[styles.btnSecondary, liked && styles.btnSecondaryActive, { paddingHorizontal: 10 }]}>
                <Text style={[styles.btnSecondaryText, liked && styles.btnSecondaryTextActive]}>{liked ? 'Đã thích' : 'Yêu thích'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        
        {shouldShowAds(user) ? <AdBanner size="small" /> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Giới thiệu</Text>
          <Text style={styles.desc}>{book ? book.desc : ''}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ủng hộ tác giả</Text>
          <Text style={styles.meta}>Dùng xu để động viên tác giả tiếp tục ra chương mới.</Text>
          <View style={styles.donateRow}>
            {[50, 100, 200].map((amt) => (
              <Pressable key={amt} onPress={() => handleDonate(amt)} style={[styles.donateBtn, donateAmount === amt && styles.donateBtnActive]}>
                <Text style={[styles.donateText, donateAmount === amt && styles.donateTextActive]}>{amt} xu</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Danh sách chương</Text>
          {(book ? book.chapters : []).map((ch, idx) => (
            <Link key={ch.id} href={{ pathname: "/reader/[id]", params: { id: id || (book ? book.id : ''), ch: String(idx + 1) } } as any} asChild>
              <Pressable style={[styles.chapterRow, idx !== 0 && styles.rowDivider]}>
                <Text style={styles.chapterText} numberOfLines={1}>Ch. {idx + 1} · {ch.title}</Text>
              </Pressable>
            </Link>
          ))}
        </View>

        <View style={[styles.card, { marginBottom: 24 }]}>
          <Text style={styles.cardTitle}>Bình luận</Text>
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Viết bình luận..."
              value={commentText}
              onChangeText={setCommentText}
              multiline
            />
            <Pressable onPress={handleSubmitComment} style={styles.sendBtn}><Text style={styles.sendBtnText}>Gửi</Text></Pressable>
          </View>
          {comments.length === 0 ? (
            <View style={styles.emptyBox}><Text style={styles.meta}>Chưa có bình luận</Text></View>
          ) : (
            comments.map((c, idx) => (
              <View key={c.id || idx} style={[styles.commentRow, idx !== 0 && styles.rowDivider]}>
                <View style={styles.avatarStub} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.commentAuthor}>Người dùng {c.user_id}</Text>
                  <Text style={styles.commentText}>{c.content}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function defaultBook(id: string) {
  return {
    id,
    title: "Tiểu thuyết chưa rõ",
    tags: ["Ngôn tình", "Hiện đại"],
    stats: "0 theo dõi · 0 chương",
    desc: "Mô tả đang cập nhật.",
    chapters: Array.from({ length: 10 }).map((_, i) => ({ id: `${id}-c${i + 1}`, title: `Chương ${i + 1}` })),
  } as Book;
}

type Book = {
  id: string;
  title: string;
  tags: string[];
  stats: string;
  desc: string;
  cover?: string | null;
  chapters: { id: string; title: string }[];
};

const mockBooks: Record<string, Book> = {
  "1": {
    id: "1",
    title: "Muôn Đời Muôn Kiếp Một Mình Em",
    tags: ["Nữ cường", "Gương vỡ lại lành"],
    stats: "269.0K theo dõi · 120 chương",
    desc: "Một câu chuyện tình yêu nhiều thử thách...",
    chapters: Array.from({ length: 30 }).map((_, i) => ({ id: `1-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  "2": {
    id: "2",
    title: "Ba Năm Rồi Bắt Đầu Yêu",
    tags: ["Tổng tài", "Cưới trước yêu sau"],
    stats: "529.6K theo dõi · 98 chương",
    desc: "Từ hôn nhân hợp đồng đến tình yêu đích thực...",
    chapters: Array.from({ length: 25 }).map((_, i) => ({ id: `2-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  r1: {
    id: "r1",
    title: "[Văn Nghiêm Văn] Xuyên Thành Bạn T…",
    tags: ["Chuyển ver", "Giải trí"],
    stats: "10.5K theo dõi · 60 chương",
    desc: "Truyện chuyển ver chưa có sự cho phép của tác giả.",
    chapters: Array.from({ length: 20 }).map((_, i) => ({ id: `r1-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 16 },
  headerRow: { flexDirection: "row", gap: 12 },
  coverLg: { width: 96, height: 128, borderRadius: 12, backgroundColor: "#e5e7eb" },
  title: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  meta: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  meta2: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  btnPrimary: { backgroundColor: "#1088ff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnPrimaryText: { color: "#fff", fontWeight: "700" },
  btnSecondary: { backgroundColor: "#f2f4f7", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  btnSecondaryText: { color: "#1088ff", fontWeight: "700" },
  btnSecondaryActive: { backgroundColor: '#1088ff11', borderWidth: StyleSheet.hairlineWidth, borderColor: '#1088ff' },
  btnSecondaryTextActive: { color: '#1088ff' },
  donateRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  donateBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb", backgroundColor: "#f8fafc" },
  donateBtnActive: { backgroundColor: "#1088ff11", borderColor: "#1088ff" },
  donateText: { color: "#0f172a", fontWeight: "700" },
  donateTextActive: { color: "#1088ff" },

  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginTop: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: "#eef2f7" },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  desc: { fontSize: 14, color: "#374151", lineHeight: 20 },

  chapterRow: { paddingVertical: 12 },
  chapterText: { fontSize: 14, color: "#0f172a" },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#eef2f7" },

  emptyBox: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 16, alignItems: "center" },

  commentInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 12 },
  commentInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, minHeight: 40 },
  sendBtn: { backgroundColor: '#1088ff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  sendBtnText: { color: '#fff', fontWeight: '700' },
  commentRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  avatarStub: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb' },
  commentAuthor: { fontWeight: '700', color: '#0f172a' },
  commentText: { color: '#111827', marginTop: 2 },
});
