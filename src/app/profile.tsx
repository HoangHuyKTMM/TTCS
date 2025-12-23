import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from "react-native";
import { Link, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as Auth from '../lib/auth';
import { apiGetMe, apiGetWallet, apiCreateTopupRequest, apiListTopupRequests, apiBuyVipWithCoins, apiBuyAuthorWithCoins, apiFetchBooks, apiCreateChapter } from '../lib/api'
import { Alert } from 'react-native'

export default function ProfileScreen() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<any | null>(null)
  const [wallet, setWallet] = useState<any | null>(null)
  const [topupCoins, setTopupCoins] = useState<string>('100')
  const [topupAmount, setTopupAmount] = useState<string>('10000')
  const [topupRequests, setTopupRequests] = useState<any[]>([])
  const [authoredBooks, setAuthoredBooks] = useState<any[]>([])
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [chapterTitle, setChapterTitle] = useState<string>('Chương 1')
  const [chapterContent, setChapterContent] = useState<string>('')

  const VIP_COST = 500
  const AUTHOR_COST_BASE = 800
  const AUTHOR_COST_VIP = 300

  function computePriceForCoins(coins: number) {
    if (!coins || coins <= 0) return 0
    // Greedy apply bundles (1000, 500, 300, 100), remainder at base rate 10 xu = 1k (1 xu = 100 VND)
    let remaining = Math.floor(coins)
    let cost = 0
    const bundles = [
      { size: 1000, price: 88000 },
      { size: 500, price: 45000 },
      { size: 300, price: 28000 },
      { size: 100, price: 10000 },
    ]
    for (const b of bundles) {
      if (remaining >= b.size) {
        const count = Math.floor(remaining / b.size)
        cost += count * b.price
        remaining -= count * b.size
      }
    }
    if (remaining > 0) {
      cost += remaining * 100 // 1 xu = 100 VND
    }
    return cost
  }

  useEffect(() => {
    let mounted = true
    Auth.getToken().then(t => {
      if (!mounted) return
      setToken(t)
    })
    Auth.getUser().then(u => {
      if (!mounted) return
      setUser(u)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!token) return
    refreshUser()
    loadWalletAndTopups(token)
    loadAuthoredBooks(token)
  }, [token])

  // Refresh when returning to this screen
  useFocusEffect(
    React.useCallback(() => {
      refreshUser()
      if (token && user && user.role === 'author') {
        loadAuthoredBooks(token)
      }
      return () => {}
    }, [token, user?.role])
  )

  async function handleLogout() {
    await Auth.removeToken()
    await Auth.removeUser()
    setToken(null)
    setUser(null)
    router.replace('/(auth)/login')
  }

  async function refreshUser() {
    const t = await Auth.getToken()
    if (!t) return
    const res: any = await apiGetMe(t)
    if (res && !res.error) {
      setUser(res)
      await Auth.saveUser(res)
      await loadWalletAndTopups(t)
    }
  }

  async function loadWalletAndTopups(tkn?: string) {
    const t = tkn || token || await Auth.getToken()
    if (!t) return
    // refresh wallet
    try {
      const w: any = await apiGetWallet(t)
      if (w && !w.error) setWallet(w)
    } catch (e) { console.error('fetch wallet err', e) }
    // refresh top-up requests
    try {
      const list: any = await apiListTopupRequests(t)
      if (Array.isArray(list)) setTopupRequests(list)
    } catch (e) { console.error('fetch topup requests err', e) }
  }

  // auto-sync amount when coin input changes
  useEffect(() => {
    const coins = Number(topupCoins || 0)
    if (!isNaN(coins) && coins > 0) {
      const price = computePriceForCoins(coins)
      setTopupAmount(String(price))
    }
  }, [topupCoins])

  useEffect(() => {
    if (user && user.role === 'author' && token) {
      loadAuthoredBooks(token)
    }
  }, [user])

  async function loadAuthoredBooks(tkn?: string) {
    const t = tkn || token || await Auth.getToken()
    if (!t) return
    try {
      const res: any = await apiFetchBooks(t, { mine: true })
      if (Array.isArray(res)) {
        const list = authoredFilter(res)
        setAuthoredBooks(list)
        if (!selectedBookId && list.length > 0) {
          setSelectedBookId(String(list[0].id || list[0].story_id))
        } else if (selectedBookId && !list.find((b: any) => String(b.id || b.story_id) === String(selectedBookId))) {
          // reset selection if current selection no longer exists
          if (list.length > 0) setSelectedBookId(String(list[0].id || list[0].story_id))
          else setSelectedBookId(null)
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const authoredFilter = (arr: any[]) => {
    if (!user) return []
    const uid = String(user.id)
    const authorId = user.author_id ? String(user.author_id) : null
    return arr.filter((b: any) => {
      // preferred: authors.user_id propagated as author_user_id
      if (b.author_user_id && String(b.author_user_id) === uid) return true
      if (b.authorUserId && String(b.authorUserId) === uid) return true
      // match by author_id if backend attached to user
      if (authorId && b.author_id && String(b.author_id) === authorId) return true
      // legacy: some rows may store author_id equal to user_id
      if (b.author_id && String(b.author_id) === uid) return true
      return false
    })
  }

  async function handleCreateChapter() {
    if (!token) return Alert.alert('Cần đăng nhập')
    if (!selectedBookId) return Alert.alert('Chọn truyện để đăng chương')
    if (!chapterTitle.trim() || !chapterContent.trim()) return Alert.alert('Nhập tiêu đề và nội dung chương')
    try {
      const res: any = await apiCreateChapter(selectedBookId, { title: chapterTitle.trim(), content: chapterContent.trim() }, token)
      if (res && !res.error) {
        Alert.alert('Đã đăng chương', res.title || chapterTitle)
        setChapterTitle('Chương 1')
        setChapterContent('')
      } else {
        Alert.alert('Lỗi', String(res?.error || 'Không đăng được chương'))
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message ? e.message : String(e))
    }
  }

  const resolveAuthorCost = () => {
    const role = user && user.role ? String(user.role).toLowerCase() : ''
    if (role === 'vip') return AUTHOR_COST_VIP
    return AUTHOR_COST_BASE
  }

  async function handleSubscribeVip() {
    if (!user || !token) return
    try {
      // ensure we have latest wallet to check balance
      let currentWallet = wallet
      if (!currentWallet) {
        try {
          const w: any = await apiGetWallet(token)
          if (w && !w.error) currentWallet = w
          if (w && !w.error) setWallet(w)
        } catch (e) { /* ignore */ }
      }
      if (currentWallet && typeof currentWallet.balance === 'number' && currentWallet.balance < VIP_COST) {
        Alert.alert(
          'Không đủ xu',
          `Cần ${VIP_COST} xu để mua VIP. Số dư hiện tại: ${currentWallet.balance}. Bạn muốn tạo lệnh nạp xu?`,
          [
            { text: 'Hủy', style: 'cancel' },
            { text: 'Nạp xu', onPress: () => { setTopupCoins(String(VIP_COST)); } }
          ]
        )
        return
      }
      const res: any = await apiBuyVipWithCoins(VIP_COST, { months: 1 }, token)
      if (res && !res.error) {
        if (res.user) { setUser(res.user); await Auth.saveUser(res.user) }
        if (res.wallet) setWallet(res.wallet)
        await loadWalletAndTopups(token)
        alert(`Đã mua VIP bằng ${VIP_COST} xu`)
      } else {
        const msg = res && (res.message || res.error) ? String(res.message || res.error) : 'Không rõ lỗi'
        console.warn('apiBuyVipWithCoins failed', res)
        alert('Mua VIP thất bại: ' + msg)
      }
    } catch (e: any) {
      console.error('handleSubscribeVip err', e)
      alert('Đăng ký VIP thất bại: ' + (e && e.message ? e.message : String(e)))
    }
  }

  async function handleBuyAuthor() {
    if (!user || !token) return
    const cost = resolveAuthorCost()
    try {
      // ensure we have latest wallet to check balance
      let currentWallet = wallet
      if (!currentWallet) {
        try {
          const w: any = await apiGetWallet(token)
          if (w && !w.error) currentWallet = w
          if (w && !w.error) setWallet(w)
        } catch (e) { /* ignore */ }
      }
      if (currentWallet && typeof currentWallet.balance === 'number' && currentWallet.balance < cost) {
        Alert.alert(
          'Không đủ xu',
          `Cần ${cost} xu để mua quyền tác giả. Số dư hiện tại: ${currentWallet.balance}. Bạn muốn tạo lệnh nạp xu?`,
          [
            { text: 'Hủy', style: 'cancel' },
            { text: 'Nạp xu', onPress: () => { setTopupCoins(String(cost)); } }
          ]
        )
        return
      }
      const res: any = await apiBuyAuthorWithCoins(cost, token)
      if (res && !res.error) {
        if (res.user) { setUser(res.user); await Auth.saveUser(res.user) }
        if (res.wallet) setWallet(res.wallet)
        await loadWalletAndTopups(token)
        alert(`Đã mua quyền tác giả bằng ${cost} xu`)
      } else {
        const msg = res && (res.message || res.error) ? String(res.message || res.error) : 'Không rõ lỗi'
        console.warn('apiBuyAuthorWithCoins failed', res)
        alert('Mua quyền tác giả thất bại: ' + msg)
      }
    } catch (e: any) {
      console.error('handleBuyAuthor err', e)
      alert('Mua quyền tác giả thất bại: ' + (e && e.message ? e.message : String(e)))
    }
  }
  
  async function handleCreateTopupRequest() {
    if (!token) return Alert.alert('Vui lòng đăng nhập')
    const coins = Number(topupCoins || 0)
    if (!coins || coins <= 0) return Alert.alert('Số xu không hợp lệ')
    const amountNumber = topupAmount ? Number(topupAmount) : undefined
    try {
      const res: any = await apiCreateTopupRequest({ coins, amount: amountNumber, method: 'bank', note: 'Yêu cầu nạp từ app' }, token)
      if (res && !res.error) {
        Alert.alert('Đã tạo yêu cầu', 'Admin sẽ duyệt và cộng xu cho bạn')
        await loadWalletAndTopups(token)
      } else {
        Alert.alert('Lỗi', String(res && (res.error || res.message) || 'Không rõ lỗi'))
      }
    } catch (e) {
      console.error('create topup req err', e)
      Alert.alert('Lỗi', String(e && e.message ? e.message : e))
    }
  }

  const isVip = !!(user && (user.role === 'vip' || user.vip_until))
  const isAuthor = !!(user && user.role === 'author')
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.avatar} />
            <View style={{ flex: 1 }}>
              {!token ? (
                <>
                  <Link href={"/(auth)/login" as any} asChild>
                    <Pressable>
                      <Text style={styles.loginPrompt}>Bấm để đăng nhập</Text>
                    </Pressable>
                  </Link>
                  <View style={styles.headerActionsRow}>
                    <Link href={"/(auth)/login" as any} asChild>
                      <Pressable style={styles.badgePrimary}>
                        <Text style={styles.badgePrimaryText}>Điểm danh</Text>
                      </Pressable>
                    </Link>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.loginPrompt}>{user?.name || 'Người dùng'}</Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{user?.email || ''}</Text>
                  {user?.role === 'vip' || user?.vip_until ? (
                    <View style={{ marginTop: 6 }}>
                      <Text style={{ color: '#b9770e', fontWeight: '700' }}>VIP đến: {user?.vip_until ? String(user.vip_until).split('T')[0] : '---'}</Text>
                    </View>
                  ) : null}
                  <Pressable onPress={handleLogout} style={[styles.badgePrimary, { marginTop: 8, backgroundColor: '#ef4444' }]}>
                    <Text style={styles.badgePrimaryText}>Đăng xuất</Text>
                  </Pressable>
                  {isAuthor ? (
                    <View style={[styles.badgePrimary, { marginTop: 8, backgroundColor: '#f59e0b' }] }>
                      <Text style={styles.badgePrimaryText}>Tác giả</Text>
                    </View>
                  ) : (user ? (
                    <>
                      <Pressable onPress={handleBuyAuthor} style={[styles.badgePrimary, { marginTop: 8, backgroundColor: '#f59e0b' }] }>
                        <Text style={styles.badgePrimaryText}>Trở thành tác giả ({resolveAuthorCost()} xu)</Text>
                      </Pressable>
                      {!isVip && (
                        <Pressable onPress={handleSubscribeVip} style={[styles.badgePrimary, { marginTop: 8, backgroundColor: '#8b5cf6' }] }>
                          <Text style={styles.badgePrimaryText}>Mua VIP ({VIP_COST} xu)</Text>
                        </Pressable>
                      )}
                    </>
                  ) : null)}
                </>
              )}
            </View>
            <View style={styles.headerIcon} />
            <View style={styles.headerIcon} />
            <View style={styles.headerIcon} />
          </View>
          {/* Stats */}
          {token && (
            <View style={styles.statsRow}>
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{wallet && typeof wallet.balance === 'number' ? String(wallet.balance) : '-'}</Text>
                <Text style={styles.statLabel}>Xu của tôi</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Text style={styles.statValue}>-</Text>
                <Text style={styles.statLabel}>Điểm của tôi</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Text style={styles.statValue}>-</Text>
                <Text style={styles.statLabel}>Phiếu</Text>
              </View>
            </View>
          )}
        </View>

        {token && (
          <View style={styles.topupCard}>
            <Text style={styles.sectionTitle}>Nạp xu (tạo lệnh chờ duyệt)</Text>
            <Text style={styles.statLabel}>Gói ưu đãi: 100 xu = 10k · 300 xu = 28k · 500 xu = 45k · 1000 xu = 88k. Xu lẻ: 10 xu = 1k.</Text>
            <View style={styles.bundleRow}>
              {[100,300,500,1000].map(c => (
                <Pressable key={c} style={styles.bundleBtn} onPress={() => setTopupCoins(String(c))}>
                  <Text style={styles.bundleBtnText}>{c} xu</Text>
                  <Text style={styles.bundleBtnSub}>{computePriceForCoins(c).toLocaleString('vi-VN')} đ</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.topupRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Xu muốn nạp</Text>
                <TextInput value={topupCoins} onChangeText={setTopupCoins} keyboardType="numeric" style={styles.input} placeholder="100" />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Số tiền (VND)</Text>
                <TextInput value={topupAmount} onChangeText={setTopupAmount} keyboardType="numeric" style={styles.input} placeholder="50000" />
                <Text style={[styles.statLabel, { marginTop: 4 }]}>Tính tự động theo bảng giá.</Text>
              </View>
            </View>
            <Pressable onPress={handleCreateTopupRequest} style={styles.topupButton}>
              <Text style={styles.topupButtonText}>Gửi yêu cầu nạp</Text>
            </Pressable>
            <View style={{ marginTop: 10 }}>
              <Text style={styles.inputLabel}>Yêu cầu gần đây</Text>
              {topupRequests && topupRequests.length > 0 ? (
                topupRequests.slice(0, 3).map((r, idx) => (
                  <View key={r.request_id || idx} style={styles.topupRowItem}>
                    <Text style={{ fontWeight: '700', color: '#0f172a' }}>{r.coins} xu</Text>
                    <Text style={styles.statLabel}>{r.status || 'pending'} · {r.created_at ? String(r.created_at).substring(0, 10) : ''}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.statLabel}>Chưa có yêu cầu.</Text>
              )}
            </View>
          </View>
        )}

        {isAuthor && (
          <>
            <View style={styles.createCard}>
              <Text style={styles.sectionTitle}>✍️  Sáng tác truyện</Text>
              <Text style={styles.statLabel}>Tạo truyện mới hoặc đăng chương cho truyện của bạn.</Text>
              <Link href={{ pathname: '/author/create' } as any} asChild>
                <Pressable style={[styles.topupButton, { marginTop: 10 }]}>
                  <Text style={styles.topupButtonText}>Đi tới trang sáng tác</Text>
                </Pressable>
              </Link>
            </View>

            <View style={styles.createCard}>
              <Text style={styles.sectionTitle}>📚  Truyện của tôi</Text>
              {authoredBooks.length === 0 ? (
                <Text style={styles.statLabel}>Chưa có truyện nào.</Text>
              ) : (
                authoredBooks.map((b, idx) => (
                  <Link key={b.id || idx} href={{ pathname: '/book/[id]', params: { id: String(b.id || b.story_id) } } as any} asChild>
                    <Pressable style={[styles.authoredItem, idx !== 0 && styles.listItemDivider]}>
                      <View style={styles.authoredIconWrap}><Text style={styles.authoredIcon}>📖</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.authoredTitle} numberOfLines={1}>{b.title || 'Không tên'}</Text>
                        <Text style={styles.authoredMeta}>{(b.chapters_count || 0)} chương · {b.genre || '---'}</Text>
                      </View>
                    </Pressable>
                  </Link>
                ))
              )}
            </View>

            <View style={styles.createCard}>
              <Text style={styles.sectionTitle}>📝  Đăng chương mới</Text>
              {authoredBooks.length === 0 ? (
                <Text style={styles.statLabel}>Bạn chưa có truyện để đăng chương. Hãy tạo truyện trước.</Text>
              ) : (
                <>
                  <Text style={styles.inputLabel}>Chọn truyện</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {authoredBooks.map((b) => {
                        const bid = String(b.id || b.story_id)
                        const active = selectedBookId === bid
                        return (
                          <Pressable key={bid} onPress={() => setSelectedBookId(bid)} style={[styles.chip, active && styles.chipActive]}>
                            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{b.title || 'Không tên'}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </ScrollView>
                  <Text style={styles.inputLabel}>Tiêu đề chương</Text>
                  <TextInput value={chapterTitle} onChangeText={setChapterTitle} placeholder="Chương 1" style={styles.input} />
                  <Text style={styles.inputLabel}>Nội dung</Text>
                  <TextInput value={chapterContent} onChangeText={setChapterContent} placeholder="Nội dung chương" style={styles.textArea} multiline />
                  <Pressable style={[styles.topupButton, { marginTop: 10 }]} onPress={handleCreateChapter}>
                    <Text style={styles.topupButtonText}>Đăng chương</Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}

        {/* List Sections */}
        <View style={styles.section}>
          {LIST_ITEMS.map((it, idx) => (
            <View key={it.key} style={[styles.listItem, idx !== 0 && styles.listItemDivider]}>
              <Text style={styles.listItemLeft}>{it.icon}  {it.label}</Text>
              {it.badge ? <Text style={styles.listBadge}>{it.badge}</Text> : <View />}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      {token && (
        <Pressable style={styles.fab}>
          <Text style={styles.fabText}>✎</Text>
        </Pressable>
      )}
    </SafeAreaView>
  )
}

type ListItem = { key: string; icon: string; label: string; badge?: string };

const LIST_ITEMS: ListItem[] = [
  { key: "vip", icon: "👑", label: "VIP" },
  { key: "mall", icon: "🛒", label: "Toon Mall" },
  { key: "search", icon: "🔍", label: "Tìm tiểu thuyết trên Internet", badge: "●" },
  { key: "topup", icon: "💳", label: "Nạp tiền" },
  { key: "tickets", icon: "🎫", label: "Phiếu đọc truyện của tôi" },
  { key: "avatar", icon: "🖼️", label: "Khung avatar của tôi" },
  { key: "sticker", icon: "🎟️", label: "Sticker của tôi" },
  { key: "fan", icon: "🏅", label: "Danh hiệu fan" },
] as const;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f9fc" },
  scroll: { padding: 16, paddingBottom: 48 },

  headerCard: {
    backgroundColor: "#e9f2ff",
    borderRadius: 16,
    padding: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#b3d7ff" },
  loginPrompt: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  headerActionsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  headerIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#d0e6ff", marginLeft: 8 },

  badgePrimary: { backgroundColor: "#1088ff", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  badgePrimaryText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  statsRow: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statCol: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  statLabel: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: "#e5e7eb" },

  topupCard: { marginTop: 12, backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb" },
  createCard: { marginTop: 12, backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  inputLabel: { fontSize: 12, color: "#6b7280", marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fff" },
  topupRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  topupButton: { backgroundColor: "#1088ff", borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  topupButtonText: { color: "#fff", fontWeight: "700" },
  topupRowItem: { paddingVertical: 6 },
  bundleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  bundleBtn: { backgroundColor: "#f8fafc", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb" },
  bundleBtnText: { fontWeight: "700", color: "#0f172a" },
  bundleBtnSub: { fontSize: 12, color: "#6b7280" },

  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', maxWidth: 200 },
  chipActive: { backgroundColor: '#1088ff11', borderColor: '#1088ff' },
  chipText: { color: '#0f172a' },
  chipTextActive: { color: '#1088ff', fontWeight: '700' },
  textArea: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#fff', minHeight: 140, textAlignVertical: 'top' },

  section: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 4,
  },
  listItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  listItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#eef2f7" },
  listItemLeft: { fontSize: 15, color: "#0f172a" },
  listBadge: { color: "#ff3b30", fontSize: 12 },

  authoredItem: { paddingVertical: 10 },
  authoredTitle: { fontWeight: '700', color: '#0f172a', fontSize: 15 },
  authoredMeta: { color: '#6b7280', marginTop: 2 },
  authoredIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  authoredIcon: { fontSize: 18 },

  fab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1088ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 20, fontWeight: "800" },
});
