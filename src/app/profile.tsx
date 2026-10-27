import { useThemeStyles } from '../components/AppTheme'
import { type AppColors } from '../theme'
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, Pressable, TextInput, Alert, Image, RefreshControl } from "react-native";
import KeyboardSafeScroll from "../components/KeyboardSafe";
import { Link, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useDebouncedNavigation } from '../lib/navigation'
import * as Auth from "../lib/auth";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import QRPaymentModal from "../components/QRPaymentModal";
import ChapterImportModal from "../components/ChapterImportModal";
import {
  apiGetMe,
  apiGetWallet,
  apiCreateTopupRequest,
  apiListTopupRequests,
  apiBuyVipWithCoins,
  apiBuyAuthorWithCoins,
  apiFetchBooks,
  apiCreateChapter,
  apiUpdateAvatar,
  apiHasUnreadNotifications,
  API_BASE,
} from "../lib/api";

type ChapterInput = { title: string; content: string };
type ListItem = { key: string; icon: string; label: string; badge?: string; href?: string };

const LIST_ITEMS: ListItem[] = [
  { key: "account", icon: "👤", label: "Tài khoản", href: "/account" },
  { key: "notifications", icon: "🔔", label: "Thông báo", href: "/notifications" },
];

const VIP_COST = 500;
const AUTHOR_COST_BASE = 800;
const AUTHOR_COST_VIP = 300;

export default function ProfileScreen() {
  const { colors, styles, preference, setPreference } = useThemeStyles(createStyles)

  const router = useRouter();
  const { navigate } = useDebouncedNavigation()
  const [token, setToken] = useState<string | null>(null);
  const [hasUnreadNotifs, setHasUnreadNotifs] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [wallet, setWallet] = useState<any | null>(null);
  const [topupCoins, setTopupCoins] = useState<string>("100");
  const [topupAmount, setTopupAmount] = useState<string>("10000");
  const [topupRequests, setTopupRequests] = useState<any[]>([]);
  const [authoredBooks, setAuthoredBooks] = useState<any[]>([]);
  const [activeChapterBookId, setActiveChapterBookId] = useState<string | null>(null);
  const [importChapterBookId, setImportChapterBookId] = useState<string | null>(null);
  const [chapterInputs, setChapterInputs] = useState<Record<string, ChapterInput>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [showQRPayment, setShowQRPayment] = useState(false);

  const myAuthoredBooks = useMemo(() => {
    const uid = user?.id || user?.user_id || null;
    const authorId = user?.author_id || user?.authorId || null;
    if (!uid && !authorId) return [];
    return authoredBooks.filter((b) => {
      const authorUid = b.author_user_id || b.authorUserId || b.user_id;
      const bookAuthorId = b.author_id || b.authorId;
      if (authorUid && uid && String(authorUid) === String(uid)) return true;
      if (authorId && bookAuthorId && String(bookAuthorId) === String(authorId)) return true;
      // fallback: if book has author_id but user id is also author id (some schemas reuse user_id)
      if (bookAuthorId && uid && String(bookAuthorId) === String(uid)) return true;
      return false;
    });
  }, [authoredBooks, user]);

  const ensureChapterInput = (bookId: string) => {
    setChapterInputs((prev) => {
      if (prev[bookId]) return prev;
      return { ...prev, [bookId]: { title: "Chương 1", content: "" } };
    });
  };

  function computePriceForCoins(coins: number) {
    if (!coins || coins <= 0) return 0;
    return coins * 100; // simple mapping: 1 xu = 100 VNĐ (example)
  }

  const loadToken = async () => {
    const t = await Auth.getToken();
    setToken(t);
    return t;
  };

  const computeVipDaysLeft = (vipUntil?: string | null) => {
    if (!vipUntil) return null;
    const ts = new Date(vipUntil).getTime();
    if (Number.isNaN(ts)) return null;
    const diff = ts - Date.now();
    if (diff <= 0) return 0;
    const dayMs = 1000 * 60 * 60 * 24;
    return Math.ceil(diff / dayMs);
  };

  const updateUserState = (u: any) => {
    if (!u) return;
    const role = (u.role ? String(u.role) : "").toLowerCase();
    const vipUntil = u.vip_until || u.vip_expired_at || null;
    const vip_days_left = computeVipDaysLeft(vipUntil);
    const vipActive = vip_days_left !== null ? vip_days_left > 0 : !!vipUntil;
    const normalized = {
      ...u,
      name: u.name || u.fullname || u.display_name || "",
      role,
      vip_until: vipUntil,
      vip_days_left,
      is_vip: u.is_vip || role === "vip" || role === "premium" || vipActive,
      is_author: u.is_author || role === "author",
    };
    setUser(normalized);
    Auth.saveUser(normalized);
  };

  const loadMe = async (t: string) => {
    const res: any = await apiGetMe(t);
    if (res && !res.error) {
      updateUserState(res);
    }
  };

  const updateWalletState = (w: any) => {
    if (!w) return;
    const coins = w.coins ?? w.balance ?? w.coin_balance ?? 0;
    setWallet({ ...w, coins });
  };

  const loadWallet = async (t: string) => {
    const res: any = await apiGetWallet(t);
    if (res && !res.error) updateWalletState(res);
  };

  const refreshWalletOnly = async () => {
    const t = token || (await Auth.getToken());
    if (!t) return;
    await loadWallet(t);
  };

  const loadTopupRequests = async (t: string) => {
    const res: any = await apiListTopupRequests(t);
    if (res && !res.error && Array.isArray(res)) setTopupRequests(res);
  };

  const loadAuthoredBooks = async (t: string) => {
    const res: any = await apiFetchBooks(t, { mine: true });
    if (res && !res.error && Array.isArray(res)) setAuthoredBooks(res);
  };

  const refreshAll = async () => {
    const t = await loadToken();
    if (!t) {
      setHasUnreadNotifs(false);
      return;
    }
    setRefreshing(true);
    await Promise.all([loadMe(t), loadWallet(t), loadTopupRequests(t), loadAuthoredBooks(t)]);
    try {
      const st: any = await apiHasUnreadNotifications(t);
      setHasUnreadNotifs(!!(st && (st.has_unread === true || st.has_unread === 1)));
    } catch {
      setHasUnreadNotifs(false);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [])
  );

  const handleLogout = async () => {
    try { await Auth.logout(); } catch (e) { console.error(e) }
    setToken(null);
    setHasUnreadNotifs(false);
    setUser(null);
    setWallet(null);
    setTopupRequests([]);
    setAuthoredBooks([]);
    setActiveChapterBookId(null);
    setChapterInputs({});
    router.replace("/");
  };

  const handleShowQRPayment = () => {
    const coins = Number(topupCoins || 0);
    if (!coins || coins <= 0) return Alert.alert("Lỗi", "Vui lòng nhập số xu hợp lệ.");
    if (!token) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");
    setShowQRPayment(true);
  };

  const handleCreateTopupRequest = async () => {
    const coins = Number(topupCoins || 0);
    const amount = Number(topupAmount || 0);
    if (!coins || coins <= 0) return Alert.alert("Lỗi", "Vui lòng nhập số xu hợp lệ.");
    if (!token) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");

    const payload: any = { coins, amount: amount || computePriceForCoins(coins), method: "bank", note: "Nạp xu trên ứng dụng" };
    const res: any = await apiCreateTopupRequest(payload, token);
    if (res && res.error) return Alert.alert("Lỗi", res.message || "Tạo yêu cầu thất bại");
    setShowQRPayment(false);
    Alert.alert("Thành công", "Đã tạo yêu cầu nạp. Vui lòng đợi admin xác nhận.");
    setTopupCoins("100");
    setTopupAmount(String(computePriceForCoins(100)));
    loadTopupRequests(token);
    refreshWalletOnly();
  };

  const handleBuyVip = async () => {
    if (!token || !user) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");
    if (isVip || isAuthor) return Alert.alert("Thông báo", "Bạn đã có quyền VIP.");
    const res: any = await apiBuyVipWithCoins(VIP_COST, { months: 1 }, token);
    if (res && res.error) {
      if (res.error === 'insufficient_funds') {
        return Alert.alert("Lỗi", "Bạn không đủ xu. Vui lòng nạp thêm xu để mua VIP.");
      }
      return Alert.alert("Lỗi", res.message || res.error || "Không thể mua VIP");
    }
    Alert.alert("Thành công", "Bạn đã mua VIP.");
    if (res.wallet) updateWalletState(res.wallet);
    if (res.user) updateUserState(res.user);
    else {
      // optimistic: mark current user as VIP
      setUser((prev: any) => {
        if (!prev) return prev;
        const next = { ...prev, is_vip: true, role: prev.role || "vip" };
        Auth.saveUser(next);
        return next;
      });
    }
    refreshAll();
    refreshWalletOnly();
  };

  const handleChangeAvatar = async () => {
    if (!token) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Lỗi", "Cần quyền truy cập thư viện ảnh.");
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (picked.canceled) return;
    const asset = picked.assets && picked.assets[0];
    if (!asset || !asset.base64) return Alert.alert("Lỗi", "Không thể đọc ảnh đã chọn.");
    const mime = asset.mimeType || "image/jpeg";
    const dataUrl = `data:${mime};base64,${asset.base64}`;
    const res: any = await apiUpdateAvatar(dataUrl, token);
    if (res && res.error) return Alert.alert("Lỗi", res.message || "Đổi avatar thất bại");
    Alert.alert("Thành công", "Đã cập nhật avatar.");
    if (res) updateUserState(res);
  };

  const handleBuyAuthor = async () => {
    if (!token) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");
    if (isAuthor) return Alert.alert("Thông báo", "Bạn đã là tác giả.");
    
    // Check VIP days remaining to determine correct price
    const MIN_VIP_DAYS_FOR_DISCOUNT = 15
    let cost = AUTHOR_COST_BASE
    
    if (isVip && vipDaysLeft !== null && vipDaysLeft >= MIN_VIP_DAYS_FOR_DISCOUNT) {
      cost = AUTHOR_COST_VIP
    }
    
    // Show warning if VIP but not enough days for discount
    if (isVip && vipDaysLeft !== null && vipDaysLeft > 0 && vipDaysLeft < MIN_VIP_DAYS_FOR_DISCOUNT) {
      Alert.alert(
        "Thông báo",
        `VIP của bạn còn ${vipDaysLeft} ngày (cần ít nhất ${MIN_VIP_DAYS_FOR_DISCOUNT} ngày để được giảm giá ${AUTHOR_COST_VIP} xu).\n\nGiá hiện tại: ${AUTHOR_COST_BASE} xu`,
        [
          { text: "Hủy", style: "cancel" },
          { text: "Tiếp tục", onPress: () => executeBuyAuthor(cost) }
        ]
      )
      return
    }
    
    executeBuyAuthor(cost)
  };
  
  const executeBuyAuthor = async (cost: number) => {
    if (!token) return
    const res: any = await apiBuyAuthorWithCoins(cost, token);
    if (res && res.error) {
      if (res.error === 'insufficient_funds') {
        return Alert.alert("Lỗi", "Bạn không đủ xu. Vui lòng nạp thêm xu để mở quyền tác giả.");
      }
      if (res.error === 'invalid_price') {
        return Alert.alert("Lỗi giá", res.message || `Giá không hợp lệ. Giá đúng: ${res.expected_cost} xu`);
      }
      return Alert.alert("Lỗi", res.message || res.error || "Không thể mở quyền tác giả");
    }
    Alert.alert("Thành công", "Bạn đã mở quyền tác giả.");
    if (res.wallet) updateWalletState(res.wallet);
    if (res.user) updateUserState(res.user);
    else {
      // optimistic: mark current user as author
      setUser((prev: any) => {
        if (!prev) return prev;
        const next = { ...prev, is_author: true, role: "author" };
        Auth.saveUser(next);
        return next;
      });
    }
    refreshAll();
    refreshWalletOnly();
  };

  const handleCreateChapter = async (bookId: string) => {
    if (!token) return Alert.alert("Lỗi", "Bạn cần đăng nhập.");
    const input = chapterInputs[bookId];
    if (!input || !input.title || !input.content) return Alert.alert("Lỗi", "Nhập tiêu đề và nội dung chương.");
    const res: any = await apiCreateChapter(bookId, { title: input.title, content: input.content }, token);
    if (res && res.error) return Alert.alert("Lỗi", res.message || "Không thể đăng chương");

    if (res && res.status === "pending_review") {
      Alert.alert(
        "Đã gửi chương (Chờ Admin duyệt)",
        "Chương đã được lưu và đang chờ quản trị viên kiểm duyệt trước khi xuất bản."
      );
    } else {
      Alert.alert("Thành công", "Đăng chương thành công và đã xuất bản.");
    }

    setChapterInputs((prev) => ({ ...prev, [bookId]: { title: "", content: "" } }));
    setActiveChapterBookId(null);
    loadAuthoredBooks(token);
  };

  const role = (user && user.role ? String(user.role).toLowerCase() : "") as string;
  const isVip = !!(user && (user.is_vip || user.vip_expired_at || role === "vip" || role === "premium"));
  const isAuthor = !!(user && (user.is_author || role === "author"));
  const vipDaysLeft = user ? (user.vip_days_left ?? computeVipDaysLeft(user.vip_until)) : null;
  const roleLabelBase = isAuthor ? "Tác giả" : isVip ? "Thành viên VIP" : "Thành viên";
  const roleLabelWithDays = (isVip || isAuthor) && vipDaysLeft !== null ? `${roleLabelBase} (${vipDaysLeft} ngày)` : roleLabelBase;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardSafeScroll
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Pressable onPress={handleChangeAvatar} style={styles.avatarPress}>
              {(() => {
                const uri = user?.avatar_url ? (String(user.avatar_url).startsWith("http") ? user.avatar_url : `${API_BASE}${user.avatar_url}`) : null;
                if (uri) return <Image source={{ uri }} style={styles.avatarImg} />;
                const initial = user?.name?.[0]?.toUpperCase() || "🙂";
                return (
                  <View style={[styles.avatarImg, { justifyContent: "center", alignItems: "center" }]}>
                    <Text style={{ fontSize: 22, color: colors.onSecondary, fontWeight: '800' }}>{initial}</Text>
                  </View>
                );
              })()}
            </Pressable>
            <View style={{ flex: 1 }}>
              {token && user ? (
                <View style={{ gap: 2 }}>
                  <Text style={styles.loginPrompt}>
                    {user.fullname || user.name || (user.email ? user.email.split('@')[0] : "Thành viên")}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>Hội viên từ {user.created_at ? new Date(user.created_at).toLocaleDateString('vi-VN') : '2025'}</Text>
                </View>
              ) : (
                <View>
                  <Text style={styles.loginPrompt}>Khách</Text>
                  <Link href="/(auth)/login" asChild>
                    <Pressable><Text style={{ color: colors.accentText, fontWeight: '600' }}>Đăng nhập ngay</Text></Pressable>
                  </Link>
                </View>
              )}
            </View>
          </View>

          <LinearGradient colors={['#FEF3C7', '#FDE68A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.walletCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletLabel}>Số dư xu</Text>
              <Text style={styles.walletValue}>{wallet ? (wallet.coins ?? 0) : 0}</Text>
              <Text style={styles.walletRank}>{roleLabelWithDays}</Text>
            </View>
            <View style={styles.walletIcon}>
              <Ionicons name="wallet" size={28} color={colors.onVip} />
            </View>
          </LinearGradient>
        </View>

        {token && user && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✨ Ưu đãi</Text>
            {!isVip && !isAuthor && (
              <View style={styles.cardRow}>
                <View>
                  <Text style={styles.cardTitle}>Nâng cấp VIP</Text>
                  <Text style={styles.cardSubtitle}>Chỉ {VIP_COST} xu / tháng</Text>
                </View>
                <Pressable style={styles.chip} onPress={handleBuyVip}><Text style={styles.chipText}>Mua</Text></Pressable>
              </View>
            )}
            {!isAuthor && (
              <View style={styles.cardRow}>
                <View>
                  <Text style={styles.cardTitle}>Mở quyền tác giả</Text>
                  <Text style={styles.cardSubtitle}>
                    {isVip && vipDaysLeft !== null && vipDaysLeft >= 15
                      ? `Giá VIP: ${AUTHOR_COST_VIP} xu`
                      : isVip && vipDaysLeft !== null && vipDaysLeft > 0
                      ? `${AUTHOR_COST_BASE} xu (VIP còn ${vipDaysLeft} ngày, cần ≥15 ngày để giảm giá)`
                      : `${AUTHOR_COST_BASE} xu`}
                  </Text>
                </View>
                <Pressable style={styles.chip} onPress={handleBuyAuthor}><Text style={styles.chipText}>Mua</Text></Pressable>
              </View>
            )}
          </View>
        )}

        {token && (
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.sectionTitle}>⚡ Nạp xu tự động (SePay)</Text>
              <Text style={{ fontSize: 12, color: colors.secondaryText, fontWeight: '700' }}>Cộng xu 1-3s</Text>
            </View>
            <Text style={[styles.statLabel, { marginBottom: 12 }]}>Quét mã VietQR chuyển khoản, hệ thống SePay tự động cộng xu ngay lập tức.</Text>

            {/* Quick Packages */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {[
                { c: 100, a: 10000 },
                { c: 200, a: 20000 },
                { c: 500, a: 50000 },
                { c: 1000, a: 100000 },
              ].map((pkg) => {
                const isSelected = topupCoins === String(pkg.c);
                return (
                  <Pressable
                    key={pkg.c}
                    onPress={() => {
                      setTopupCoins(String(pkg.c));
                      setTopupAmount(String(pkg.a));
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      paddingHorizontal: 4,
                      borderRadius: 10,
                      borderWidth: 1.5,
                      borderColor: isSelected ? colors.accent : colors.borderLight,
                      backgroundColor: isSelected ? colors.accentSoft : colors.surface,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontWeight: '700', fontSize: 13, color: isSelected ? colors.accentDark : colors.text }}>{pkg.c} xu</Text>
                    <Text style={{ fontSize: 11, color: isSelected ? colors.accent : colors.textSecondary, marginTop: 2 }}>{pkg.a.toLocaleString('vi-VN')}đ</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.inputLabel}>Hoặc tùy chỉnh số xu</Text>
            <TextInput
              value={topupCoins}
              onChangeText={(v) => { setTopupCoins(v); setTopupAmount(String(computePriceForCoins(Number(v || 0)))); }}
              keyboardType="numeric"
              style={styles.input}
            />
            <Text style={styles.inputLabel}>Số tiền (VNĐ)</Text>
            <TextInput
              value={topupAmount}
              editable={false}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: colors.surfaceSubtle, color: colors.textSecondary }]}
            />
            <Pressable style={styles.topupButton} onPress={handleShowQRPayment}>
              <Text style={styles.topupButtonText}>⚡ Quét mã QR - Nạp tự động</Text>
            </Pressable>
            <View style={{ marginTop: 12 }}>
              <Text style={styles.inputLabel}>Yêu cầu gần đây</Text>
              {topupRequests && topupRequests.length > 0 ? (
                topupRequests.slice(0, 3).map((r, idx) => (
                  <View key={r.request_id || idx} style={styles.topupRowItem}>
                    <Text style={{ fontWeight: "700", color: colors.text }}>{r.coins} xu</Text>
                    <Text style={styles.statLabel}>{r.status === "approved" ? "đã duyệt" : r.status === "rejected" ? "từ chối" : r.status ? r.status : "đang chờ"} · {r.created_at ? String(r.created_at).substring(0, 10) : ""}</Text>
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
              <Link href={{ pathname: "/author/create" } as any} asChild>
                <Pressable style={StyleSheet.flatten([styles.topupButton, { marginTop: 10 }])}>
                  <Text style={styles.topupButtonText}>Đi tới trang sáng tác</Text>
                </Pressable>
              </Link>
            </View>

            <View style={styles.createCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={styles.sectionTitle}>📚  Truyện của tôi</Text>
                <Pressable onPress={() => navigate('/author/manage')} style={styles.chip}>
                  <Text style={styles.chipText}>Quản lý</Text>
                </Pressable>
              </View>
              {myAuthoredBooks.length === 0 ? (
                <Text style={styles.statLabel}>Chưa có truyện nào.</Text>
              ) : (
                myAuthoredBooks.map((b, idx) => {
                  const bid = String(b.id || b.story_id);
                  const isActive = activeChapterBookId === bid;
                  const input = chapterInputs[bid] || { title: "Chương 1", content: "" };
                  return (
                    <View key={bid} style={[styles.authoredItemWrap, idx !== 0 && styles.listItemDivider]}>
                      <Link href={{ pathname: "/book/[id]", params: { id: bid } } as any} asChild>
                        <Pressable style={styles.authoredItem}>
                          <View style={styles.authoredIconWrap}><Text style={styles.authoredIcon}>📖</Text></View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.authoredTitle} numberOfLines={1}>{b.title || "Không tên"}</Text>
                            <Text style={styles.authoredMeta}>{(b.chapters_count || b.chapters?.length || 0)} chương · {b.genre || "---"}</Text>
                          </View>
                        </Pressable>
                      </Link>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                        <Pressable
                          style={[styles.chip, isActive && styles.chipActive]}
                          onPress={() => {
                            setActiveChapterBookId(isActive ? null : bid);
                            setTimeout(() => ensureChapterInput(bid), 0);
                          }}
                        >
                          <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{isActive ? "Đóng" : "Đăng chương"}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Import chương Word hoặc văn bản cho ${b.title || 'truyện'}`}
                          style={[styles.chip, { backgroundColor: colors.secondarySoft }]}
                          onPress={() => setImportChapterBookId(bid)}
                        >
                          <Text style={[styles.chipText, { color: colors.secondaryText }]}>Import Word / văn bản</Text>
                        </Pressable>
                      </View>
                      {isActive && (
                        <View style={{ marginTop: 8, gap: 6 }}>
                          <Text style={styles.inputLabel}>Tiêu đề chương</Text>
                          <TextInput
                            value={input.title}
                            onChangeText={(v) => {
                              ensureChapterInput(bid);
                              setChapterInputs((prev) => ({ ...prev, [bid]: { ...(prev[bid] || { title: "Chương 1", content: "" }), title: v } }));
                            }}
                            placeholder="Chương 1"
                            style={styles.input}
                          />
                          <Text style={styles.inputLabel}>Nội dung</Text>
                          <TextInput
                            value={input.content}
                            onChangeText={(v) => {
                              ensureChapterInput(bid);
                              setChapterInputs((prev) => ({ ...prev, [bid]: { ...(prev[bid] || { title: "Chương 1", content: "" }), content: v } }));
                            }}
                            placeholder="Nội dung chương"
                            style={styles.textArea}
                            multiline
                          />
                          <Pressable style={[styles.topupButton, { marginTop: 2 }]} onPress={() => handleCreateChapter(bid)}>
                            <Text style={styles.topupButtonText}>Đăng chương</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Giao diện</Text>
          <Text style={[styles.statLabel, { marginBottom: 12 }]}>Chọn không gian đọc phù hợp với bạn.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([
              { value: 'light', label: 'Sáng', icon: 'sunny-outline' },
              { value: 'dark', label: 'Tối', icon: 'moon-outline' },
              { value: 'system', label: 'Hệ thống', icon: 'phone-portrait-outline' },
            ] as const).map(option => (
              <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: preference === option.value }} onPress={() => setPreference(option.value)}
                style={{ flex: 1, minHeight: 64, gap: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                  backgroundColor: preference === option.value ? colors.accentSoft : colors.surfaceSubtle,
                  borderColor: preference === option.value ? colors.accentText : colors.borderLight }}>
                <Ionicons name={option.icon} size={20} color={preference === option.value ? colors.accentText : colors.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: preference === option.value ? colors.accentText : colors.textSecondary }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Cài đặt</Text>
          {LIST_ITEMS.map((it, idx) => (
            <Pressable
              key={it.key}
              onPress={() => {
                if (it.href) return navigate(it.href);
                Alert.alert("Thông báo", "Chức năng đang phát triển.");
              }}
              style={({ pressed }) => [styles.listItem, idx !== 0 && styles.listItemDivider, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={styles.menuIconWrap}><Text style={{ fontSize: 16 }}>{it.icon}</Text></View>
                <Text style={styles.listItemLeft}>{it.label}</Text>
                {it.key === "notifications" && token && hasUnreadNotifs ? <View style={styles.unreadDot} /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.border} />
            </Pressable>
          ))}
        </View>

        {token && (
          <Pressable style={styles.logoutFooterBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logoutFooterText}>Đăng xuất tài khoản</Text>
          </Pressable>
        )}
      </KeyboardSafeScroll>

      {token && importChapterBookId && (
        <ChapterImportModal
          bookId={importChapterBookId}
          token={token}
          onClose={() => setImportChapterBookId(null)}
          onImported={() => { loadAuthoredBooks(token) }}
        />
      )}

      <QRPaymentModal
        visible={showQRPayment}
        onClose={() => {
          setShowQRPayment(false);
        }}
        onPaymentSuccess={(wallet) => {
          if (wallet) {
            updateWalletState(wallet);
          }
          refreshWalletOnly();
          Alert.alert("Thành công", "Xu đã được cộng vào tài khoản!");
        }}
        coins={Number(topupCoins || 0)}
        token={token || undefined}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 120 },

  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatarPress: { width: 64, height: 64 },
  avatarImg: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.secondary, overflow: "hidden" },
  loginPrompt: { fontSize: 18, fontWeight: "800", color: colors.text },
  walletCard: { flexDirection: 'row', alignItems: 'center', marginTop: 20, borderRadius: 18, padding: 16 },
  walletLabel: { color: colors.onVip, fontSize: 12, fontWeight: '600' },
  walletValue: { color: colors.onVip, fontSize: 28, fontWeight: '800', marginTop: 2 },
  walletRank: { color: colors.onVip, fontSize: 13, marginTop: 4, fontWeight: '600' },
  walletIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(64,48,31,0.08)', alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: "row", marginTop: 24, backgroundColor: colors.bg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.surfaceSubtle },
  statItem: { flex: 1, flexDirection: "row", alignItems: "center" },
  statIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.borderLight, marginHorizontal: 12 },

  badgePrimary: { backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  badgePrimaryText: { color: colors.onAccent, fontWeight: "700", fontSize: 12 },
  badgeSecondary: { backgroundColor: colors.secondarySoft, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  badgeSecondaryText: { color: colors.secondaryText, fontWeight: "700", fontSize: 12 },

  statLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "500" },
  statValue: { color: colors.text, fontWeight: "700", fontSize: 16, marginTop: 2 },

  section: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 8 },

  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSubtle, padding: 12, borderRadius: 12, marginTop: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  chip: { backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: colors.onAccent, fontWeight: "700" },
  chipActive: { backgroundColor: colors.secondarySoft, borderWidth: 1, borderColor: colors.secondary },
  chipTextActive: { color: colors.secondaryText },

  inputLabel: { color: colors.text, marginTop: 8, marginBottom: 4, fontWeight: "600", fontSize: 14 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, padding: 12, backgroundColor: colors.surfaceSubtle },
  textArea: { color: colors.text, minHeight: 100, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, padding: 12, backgroundColor: colors.surfaceSubtle, textAlignVertical: "top" },

  menuIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceSubtle, justifyContent: 'center', alignItems: 'center' },

  logoutFooterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 32, marginBottom: 16, paddingVertical: 12 },
  logoutFooterText: { color: colors.dangerText, fontWeight: '700', fontSize: 15 },

  topupButton: { backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 10 },
  topupButtonText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },

  topupRowItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceSubtle },

  createCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginTop: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 3, elevation: 2 },
  authoredItemWrap: { paddingVertical: 10 },
  authoredItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  authoredIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.borderLight, justifyContent: "center", alignItems: "center" },
  authoredIcon: { color: colors.text, fontSize: 18 },
  authoredTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  authoredMeta: { color: colors.textSecondary, marginTop: 2 },

  listItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  listItemDivider: { borderTopWidth: 1, borderTopColor: colors.surfaceSubtle },
  listItemLeft: { fontSize: 15, color: colors.text },
  listBadge: { backgroundColor: colors.accent, color: colors.onAccent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontWeight: "700" },
  unreadDot: { width: 9, height: 9, borderRadius: 9, backgroundColor: colors.danger },

  fab: { position: "absolute", right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.text, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, elevation: 5 },
  fabText: { color: colors.onDark, fontSize: 20, fontWeight: "800" },
});
