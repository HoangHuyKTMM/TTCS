import React, { useMemo, useEffect, useState, useCallback } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, ActivityIndicator, Image, Alert, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from '@react-navigation/native'

import { apiFetchBook, API_BASE, apiDonateCoins, apiLikeBook, apiUnlikeBook, apiFetchAuthors, apiFollowAuthor, apiUnfollowAuthor, apiFetchComments, apiPostComment, apiDeleteComment, apiGetWallet } from '../../lib/api'
import * as Auth from '../../lib/auth'
import { shouldShowAds } from '../../lib/ads'
import AdInterstitial from '../../components/AdInterstitial'
import { downloadBookOffline, isBookDownloaded, removeOfflineBook } from '../../lib/offline'

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [entryAdVisible, setEntryAdVisible] = useState(false)
  const [offlineDownloaded, setOfflineDownloaded] = useState(false)
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineProgress, setOfflineProgress] = useState<{ done: number; total: number } | null>(null)
  const [donateAmount, setDonateAmount] = useState<number>(50)
  const [likesCount, setLikesCount] = useState<number>(0)
  const [liked, setLiked] = useState<boolean>(false)
  const [comments, setComments] = useState<any[]>([])
  const [commentText, setCommentText] = useState<string>('')
  const [revealedNegative, setRevealedNegative] = useState<Set<string>>(new Set())
  const [wallet, setWallet] = useState<any | null>(null)
  const [walletLoading, setWalletLoading] = useState<boolean>(false)

  const [authorId, setAuthorId] = useState<string | null>(null)
  const [authorName, setAuthorName] = useState<string>('')
  const [authorUserId, setAuthorUserId] = useState<string | null>(null)
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState<string | null>(null)
  const [authorFollowers, setAuthorFollowers] = useState<number>(0)
  const [authorFollowing, setAuthorFollowing] = useState<boolean>(false)

  const loadAuthorMeta = useCallback(async (aId: string) => {
    try {
      const token = await Auth.getToken()
      const res: any = await apiFetchAuthors(token || undefined)
      if (Array.isArray(res)) {
        const hit: any = res.find((a: any) => String(a.id || a.author_id) === String(aId))
        if (hit) {
          setAuthorName(String(hit.pen_name || hit.name || hit.author_name || hit.author || 'Tác giả'))
          setAuthorUserId(hit.user_id ? String(hit.user_id) : null)
          setAuthorAvatarUrl(hit.avatar_url
            ? (String(hit.avatar_url).startsWith('http')
              ? String(hit.avatar_url)
              : (String(hit.avatar_url).startsWith('/')
                ? `${API_BASE}${String(hit.avatar_url)}`
                : `${API_BASE}/${String(hit.avatar_url)}`))
            : null)
          setAuthorFollowers(Number(hit.followers_count || 0))
          setAuthorFollowing(!!hit.is_following)
          return
        }
      }
    } catch (e) {
      // ignore
    }
  }, [])

  const refreshWallet = useCallback(async () => {
    setWalletLoading(true)
    try {
      const token = await Auth.getToken()
      if (!token) {
        setWallet(null)
        return
      }
      const res: any = await apiGetWallet(token)
      if (res && !res.error) {
        const coins = res.coins ?? res.balance ?? res.coin_balance ?? 0
        setWallet({ ...res, coins })
      }
    } catch (e) {
      // ignore wallet errors
    } finally {
      setWalletLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    refreshWallet()
    return () => { active = false }
  }, [refreshWallet]))

  // Full-screen ad when entering book detail page.
  useEffect(() => {
    if (!id) return
    if (!userLoaded) return
    if (shouldShowAds(user)) setEntryAdVisible(true)
  }, [id, user, userLoaded])

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
          const aId = res.author_id ? String(res.author_id) : null
          setAuthorId(aId)
          // best-effort: show something immediately while we fetch full author meta
          setAuthorName(String(res.author_name || res.author || res.pen_name || ''))
          setAuthorUserId(res.author_user_id ? String(res.author_user_id) : null)
          if (aId) loadAuthorMeta(aId)

          // normalize to Book shape
          const b: Book = {
            id: String(res.id || res.story_id || id),
            title: res.title || res.name || 'Tiểu thuyết chưa rõ',
            tags: res.tags || (res.genre ? [res.genre] : []),
            stats: `${((res.chapters && res.chapters.length) || res.chapters_count || 0)} chương`,
            desc: res.description || res.desc || res.content || '',
            cover: res.cover_url ? (String(res.cover_url).startsWith('http') ? res.cover_url : `${API_BASE}${res.cover_url}`) : null,
            chapters: Array.isArray(res.chapters) ? res.chapters.map((c: any, idx: number) => ({ id: String(c.id || c.chapter_id || `${id}-c${idx + 1}`), title: c.title || `Chương ${idx + 1}`, content: c.content || c.body || c.text || '' })) : []
          }
          setBook(b)
          setLikesCount(Number(res.likes_count || 0))
          setLiked(!!res.liked)
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
  }, [id, loadAuthorMeta])

  const isSelfAuthor = useMemo(() => {
    if (!user || !authorUserId) return false
    return String(user.id || user.user_id) === String(authorUserId)
  }, [authorUserId, user])

  const handleToggleAuthorFollow = useCallback(async () => {
    if (!authorId) return
    try {
      const token = await Auth.getToken()
      if (!token) {
        Alert.alert('Cần đăng nhập', 'Vui lòng đăng nhập để theo dõi tác giả.')
        return
      }

      if (isSelfAuthor) {
        Alert.alert('Không thể theo dõi', 'Bạn không thể tự theo dõi chính mình.')
        return
      }

      const next = !authorFollowing
      setAuthorFollowing(next)
      setAuthorFollowers((prev) => Math.max(0, prev + (next ? 1 : -1)))

      if (next) {
        const r: any = await apiFollowAuthor(authorId, token)
        if (r && r.error) {
          Alert.alert('Không thể theo dõi', r.message || 'Không thể theo dõi tác giả này.')
          loadAuthorMeta(authorId)
          return
        }
      } else {
        const r: any = await apiUnfollowAuthor(authorId, token)
        if (r && r.error) {
          Alert.alert('Không thể bỏ theo dõi', r.message || 'Không thể bỏ theo dõi tác giả này.')
          loadAuthorMeta(authorId)
          return
        }
      }

      loadAuthorMeta(authorId)
    } catch (e: any) {
      console.error(e)
      if (authorId) loadAuthorMeta(authorId)
    }
  }, [authorFollowing, authorId, isSelfAuthor, loadAuthorMeta])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!id) return
      const ok = await isBookDownloaded(String(id))
      if (active) setOfflineDownloaded(ok)
    })()
    return () => { active = false }
  }, [id])

  const handleDownloadOffline = useCallback(async () => {
    if (!id) return
    if (offlineBusy) return
    setOfflineBusy(true)
    setOfflineProgress({ done: 0, total: 1 })
    try {
      const token = await Auth.getToken()
      await downloadBookOffline(String(id), {
        token: token || undefined,
        onProgress: (p) => setOfflineProgress(p)
      })
      setOfflineDownloaded(true)
      Alert.alert('Thành công', 'Đã tải truyện để đọc offline.')
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    } finally {
      setOfflineBusy(false)
      setOfflineProgress(null)
    }
  }, [id, offlineBusy])

  const handleRemoveOffline = useCallback(async () => {
    if (!id) return
    if (offlineBusy) return
    Alert.alert('Xóa truyện đã tải?', 'Bạn muốn xóa dữ liệu offline của truyện này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive',
        onPress: async () => {
          setOfflineBusy(true)
          try {
            await removeOfflineBook(String(id))
            setOfflineDownloaded(false)
          } finally {
            setOfflineBusy(false)
          }
        }
      }
    ])
  }, [id, offlineBusy])

  const walletCoins = useMemo(() => {
    if (!wallet) return 0
    return Number(wallet.coins ?? wallet.balance ?? wallet.coin_balance ?? 0) || 0
  }, [wallet])

  function handleSelectDonate(amount: number) {
    setDonateAmount(amount)
  }

  async function performDonate(amount: number) {
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
        refreshWallet()
      } else {
        Alert.alert('Lỗi', String(res && (res.error || res.message) || 'Không rõ lỗi'))
      }
    } catch (e: any) {
      console.error('donate err', e)
      Alert.alert('Lỗi', e && e.message ? e.message : String(e))
    }
  }

  async function handleConfirmDonate() {
    const amount = donateAmount || 0
    if (amount <= 0) {
      Alert.alert('Thông báo', 'Chọn số xu muốn tặng trước khi xác nhận.')
      return
    }

    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Hãy đăng nhập để tặng xu cho tác giả.')
      return
    }

    if (wallet && walletCoins < amount) {
      Alert.alert('Không đủ số dư', 'Số xu trong ví không đủ, vui lòng nạp thêm hoặc chọn mức tặng nhỏ hơn.')
      return
    }

    Alert.alert(
      'Xác nhận tặng quà',
      `Bạn muốn tặng ${amount} xu cho tác giả?`,
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Tặng quà', onPress: () => performDonate(amount) }
      ]
    )
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
        // optimistic update: show immediately
        setComments((prev) => [res, ...(prev || [])])
        // also refresh from server to sync status/order
        refreshComments(String(id))
      } else {
        Alert.alert('Lỗi', String(res?.error || 'Không gửi được bình luận'))
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  async function handleDeleteComment(commentId: string) {
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập để xóa bình luận.')
      return
    }

    Alert.alert('Xóa bình luận?', 'Bạn có chắc muốn xóa bình luận này không?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            const res: any = await apiDeleteComment(commentId, token)
            if (res && res.error) {
              Alert.alert('Không thể xóa', String(res.message || res.error || 'Không thể xóa bình luận'))
              return
            }
            // optimistic remove
            setComments(prev => (prev || []).filter((c: any) => String(c.id) !== String(commentId)))
          } catch (e: any) {
            Alert.alert('Lỗi', e?.message ? e.message : String(e))
          }
        }
      }
    ])
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
            <Text style={styles.meta2}>{`${(book?.chapters || []).length} chương · ${likesCount} yêu thích`}</Text>

            {!!authorId && (
              <View style={styles.authorRow}>
                <Pressable
                  onPress={() => router.push({ pathname: '/author/[id]', params: { id: authorId, name: authorName || undefined } } as any)}
                  style={({ pressed }) => [styles.authorLeft, pressed && { opacity: 0.75 }]}
                >
                  <View style={styles.authorAvatar}>
                    {authorAvatarUrl ? (
                      <Image source={{ uri: authorAvatarUrl }} style={styles.authorAvatarImg} />
                    ) : (
                      <Text style={styles.authorAvatarText}>{(authorName || 'T').trim().slice(0, 1).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.authorName} numberOfLines={1}>{authorName || 'Tác giả'}</Text>
                    <Text style={styles.authorMeta} numberOfLines={1}>{authorFollowers} người theo dõi</Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={handleToggleAuthorFollow}
                  disabled={isSelfAuthor}
                  style={[styles.authorFollowBtn, authorFollowing ? styles.authorFollowingBtn : styles.authorFollowBtnOn, isSelfAuthor && { opacity: 0.6 }]}
                >
                  <Text style={[styles.authorFollowText, authorFollowing ? styles.authorFollowingText : styles.authorFollowTextOn]}>
                    {isSelfAuthor ? 'Bạn' : (authorFollowing ? 'Đang theo dõi' : 'Theo dõi')}
                  </Text>
                </Pressable>
              </View>
            )}

            <View style={styles.actionRow}>
              {offlineDownloaded ? (
                <Pressable disabled={offlineBusy} onPress={handleRemoveOffline} style={[styles.btnSecondary, { paddingHorizontal: 10 }]}>
                  <Text style={styles.btnSecondaryText}>{offlineBusy ? '...' : 'Đã tải'}</Text>
                </Pressable>
              ) : (
                <Pressable disabled={offlineBusy} onPress={handleDownloadOffline} style={[styles.btnSecondary, { paddingHorizontal: 10 }]}>
                  <Text style={styles.btnSecondaryText}>{offlineBusy ? `Tải (${offlineProgress?.done || 0}/${offlineProgress?.total || 0})` : 'Tải về'}</Text>
                </Pressable>
              )}

              <Link href={{ pathname: "/reader/[id]", params: { id: id || (book ? book.id : ''), ch: "1" } } as any} asChild>
                <Pressable style={styles.btnPrimary}><Text style={styles.btnPrimaryText}>Đọc từ đầu</Text></Pressable>
              </Link>
              <Pressable onPress={handleToggleLike} style={[styles.btnSecondary, liked && styles.btnSecondaryActive, { paddingHorizontal: 10 }]}>
                <Text style={[styles.btnSecondaryText, liked && styles.btnSecondaryTextActive]}>{liked ? 'Đã thích' : 'Yêu thích'}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Giới thiệu</Text>
          <Text style={styles.desc}>{book ? book.desc : ''}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ủng hộ tác giả</Text>
          <Text style={styles.meta}>Dùng xu để động viên tác giả tiếp tục ra chương mới.</Text>
          <View style={styles.donateRow}>
            {[50, 100, 200].map((amt) => (
              <Pressable key={amt} onPress={() => handleSelectDonate(amt)} style={[styles.donateBtn, donateAmount === amt && styles.donateBtnActive]}>
                <Text style={[styles.donateText, donateAmount === amt && styles.donateTextActive]}>{amt} xu</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.donateActionRow}>
            <Text style={styles.meta}>
              {walletLoading ? 'Đang lấy số dư...' : `Đang chọn: ${donateAmount} xu${wallet ? ` · Số dư: ${walletCoins} xu` : ''}`}
            </Text>
            <Pressable onPress={handleConfirmDonate} style={[styles.btnPrimary, styles.donateConfirmBtn]}>
              <Text style={styles.btnPrimaryText}>Tặng quà</Text>
            </Pressable>
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
            comments.map((c, idx) => {
              const isHidden = c.is_negative && !revealedNegative.has(c.id)
              const myId = user ? String(user.id || user.user_id) : null
              const isMine = !!(myId && c && c.user_id && String(c.user_id) === String(myId))
              return (
                <View key={c.id || idx} style={[styles.commentRow, idx !== 0 && styles.rowDivider]}>
                  {c.user_avatar ? (
                    <Image source={{ uri: c.user_avatar.startsWith('http') ? c.user_avatar : `${API_BASE}${c.user_avatar}` }} style={styles.avatarStub} />
                  ) : (
                    <View style={styles.avatarStub} />
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={styles.commentHeaderRow}>
                      <Text style={styles.commentAuthor}>{c.user_name || `Người dùng ${c.user_id}`}</Text>
                      {isMine && c.id ? (
                        <Pressable onPress={() => handleDeleteComment(String(c.id))} style={({ pressed }) => [styles.commentDeleteBtn, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.commentDeleteText}>Xóa</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {isHidden ? (
                      <Pressable onPress={() => setRevealedNegative(prev => new Set(prev).add(c.id))}>
                        <View style={styles.hiddenComment}>
                          <Text style={styles.hiddenCommentText}>⚠️ Bình luận tiêu cực - Nhấn để xem</Text>
                        </View>
                      </Pressable>
                    ) : (
                      <Text style={[styles.commentText, c.is_negative && styles.negativeComment]}>{c.content}</Text>
                    )}
                  </View>
                </View>
              )
            })
          )}
        </View>
      </ScrollView>

      <AdInterstitial
        visible={entryAdVisible}
        placement="interstitial"
        onFinish={() => setEntryAdVisible(false)}
      />
    </SafeAreaView>
  );
}

function defaultBook(id: string) {
  return {
    id,
    title: "Tiểu thuyết chưa rõ",
    tags: ["Ngôn tình", "Hiện đại"],
    stats: "0 chương",
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
    stats: "120 chương",
    desc: "Một câu chuyện tình yêu nhiều thử thách...",
    chapters: Array.from({ length: 30 }).map((_, i) => ({ id: `1-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  "2": {
    id: "2",
    title: "Ba Năm Rồi Bắt Đầu Yêu",
    tags: ["Tổng tài", "Cưới trước yêu sau"],
    stats: "98 chương",
    desc: "Từ hôn nhân hợp đồng đến tình yêu đích thực...",
    chapters: Array.from({ length: 25 }).map((_, i) => ({ id: `2-c${i + 1}`, title: `Chương ${i + 1}` })),
  },
  r1: {
    id: "r1",
    title: "[Văn Nghiêm Văn] Xuyên Thành Bạn T…",
    tags: ["Chuyển ver", "Giải trí"],
    stats: "60 chương",
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

  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  authorLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  authorAvatar: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', backgroundColor: '#e9f2ff', alignItems: 'center', justifyContent: 'center' },
  authorAvatarImg: { width: '100%', height: '100%' },
  authorAvatarText: { color: '#0f172a', fontWeight: '800' },
  authorName: { color: '#0f172a', fontWeight: '800', fontSize: 13 },
  authorMeta: { color: '#64748b', fontSize: 11, marginTop: 1 },
  authorFollowBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  authorFollowBtnOn: { backgroundColor: '#1088ff' },
  authorFollowingBtn: { backgroundColor: '#f2f4f7', borderWidth: StyleSheet.hairlineWidth, borderColor: '#1088ff' },
  authorFollowText: { fontWeight: '800', fontSize: 12 },
  authorFollowTextOn: { color: '#fff' },
  authorFollowingText: { color: '#1088ff' },
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
  donateActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  donateConfirmBtn: { alignSelf: 'flex-start', paddingHorizontal: 16 },

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
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  commentAuthor: { fontWeight: '700', color: '#0f172a' },
  commentDeleteBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fef2f2', borderWidth: StyleSheet.hairlineWidth, borderColor: '#fecaca' },
  commentDeleteText: { color: '#dc2626', fontWeight: '800', fontSize: 12 },
  commentText: { color: '#111827', marginTop: 2 },
  hiddenComment: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 10, marginTop: 4 },
  hiddenCommentText: { color: '#dc2626', fontSize: 13 },
  negativeComment: { color: '#6b7280', fontStyle: 'italic' },
});
