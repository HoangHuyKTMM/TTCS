import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Auth from '../lib/auth'
import { apiFetchGifts, apiFetchRecentGifts, apiSendGift } from '../lib/api'
import { FALLBACK_GIFTS, GradientFill, haptic, themeFor, type GiftItem } from './giftVisuals'

type RecentGift = {
  gift_code: string
  gift_name: string
  emoji: string
  quantity: number
  coins: number
  donor_name: string
  created_at?: string
}

type Burst = {
  emoji: string
  name: string
  quantity: number
  color: string
}

type Props = {
  bookId: string
  user: any | null
  userLoaded: boolean
  wallet: any | null
  walletLoading: boolean
  isSelfAuthor: boolean
  onWalletRefresh: () => void
}

type TileProps = {
  gift: GiftItem
  selected: boolean
  disabled: boolean
  onPress: () => void
}

type BurstProps = Burst & { onFinish: () => void }

function giftErrorMessage(res: any) {
  if (!res) return 'Không gửi được quà.'
  if (res.error === 'insufficient_funds') return 'Số xu không đủ để tặng quà này.'
  if (res.error === 'missing authorization') return 'Đăng nhập để tặng quà.'
  if (res.error === 'unknown_gift') return 'Quà không hợp lệ.'
  if (res.error === 'invalid_quantity') return 'Số lượng quà từ 1 đến 20.'
  if (res.error === 'cannot_donate_to_self') return 'Bạn không thể tự tặng quà cho mình.'
  if (res.error === 'network') return 'Không kết nối được máy chủ.'
  if (res.message) return String(res.message)
  return 'Không gửi được quà.'
}

function StaticTile({ gift, selected, disabled, onPress }: TileProps) {
  const theme = themeFor(gift.code)
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        haptic('select')
        onPress()
      }}
      style={[styles.tile, selected && { borderColor: theme.accent, backgroundColor: theme.soft }, disabled && styles.tileOff]}
    >
      <GradientFill colors={[theme.soft, '#fff']} style={styles.medallion}>
        <Text style={styles.emoji}>{gift.emoji}</Text>
      </GradientFill>
      <Text style={styles.name} numberOfLines={1}>{gift.name}</Text>
      <Text style={[styles.price, { color: theme.accent }]}>{gift.coins} xu</Text>
    </Pressable>
  )
}

function PlainBurst({ emoji, name, quantity, color, onFinish }: BurstProps) {
  const scale = useMemo(() => new Animated.Value(0.4), [])
  const ty = useMemo(() => new Animated.Value(40), [])
  const opacity = useMemo(() => new Animated.Value(0), [])

  useEffect(() => {
    haptic('success')
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(ty, { toValue: 0, friction: 7, tension: 70, useNativeDriver: true }),
        Animated.timing(ty, { toValue: -120, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start()
    const done = setTimeout(onFinish, 1500)
    return () => clearTimeout(done)
  }, [onFinish, opacity, scale, ty])

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onFinish}>
      <View style={styles.burstWrap}>
        <Animated.View style={{ alignItems: 'center', opacity, transform: [{ translateY: ty }, { scale }] }}>
          <GradientFill colors={[color, '#fff']} style={styles.heroDisc}>
            <Text style={styles.heroEmoji}>{emoji}</Text>
          </GradientFill>
          <Text style={styles.heroLabel}>Đã tặng {name} ×{quantity}</Text>
        </Animated.View>
      </View>
    </Modal>
  )
}

class MotionBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function GiftCardBody({
  bookId,
  user,
  userLoaded,
  wallet,
  walletLoading,
  isSelfAuthor,
  onWalletRefresh,
  Tile,
  BurstView,
}: Props & { Tile: React.ComponentType<TileProps>; BurstView: React.ComponentType<BurstProps> }) {
  const router = useRouter()
  const [gifts, setGifts] = useState<GiftItem[]>(FALLBACK_GIFTS)
  const [recent, setRecent] = useState<RecentGift[]>([])
  const [selectedCode, setSelectedCode] = useState<string | null>(FALLBACK_GIFTS[0].code)
  const [quantity, setQuantity] = useState(1)
  const [sending, setSending] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)

  const loggedIn = !!(user && (user.id || user.user_id))
  const balanceKnown = !!(wallet && (wallet.coins !== undefined && wallet.coins !== null || wallet.balance !== undefined))
  const coins = balanceKnown ? Number(wallet.coins ?? wallet.balance ?? 0) || 0 : 0
  const canSpend = loggedIn && balanceKnown && coins > 0 && !isSelfAuthor

  const loadRecent = useCallback(async () => {
    if (!bookId) return
    const res: any = await apiFetchRecentGifts(bookId, 8)
    if (Array.isArray(res)) setRecent(res)
  }, [bookId])

  useEffect(() => {
    let active = true
    apiFetchGifts().then((list) => {
      if (!active || !Array.isArray(list) || !list.length) return
      setGifts(list)
    }).catch(() => {})
    loadRecent()
    return () => { active = false }
  }, [loadRecent])

  const selected = gifts.find((gift) => gift.code === selectedCode) || null
  const maxQty = selected && canSpend ? Math.min(20, Math.floor(coins / selected.coins)) : 1
  const total = selected ? selected.coins * quantity : 0

  useEffect(() => {
    if (!canSpend) return
    setSelectedCode((prev) => {
      const current = gifts.find((gift) => gift.code === prev)
      if (current && current.coins <= coins) return prev
      const affordable = gifts.find((gift) => gift.coins <= coins)
      return affordable ? affordable.code : null
    })
  }, [canSpend, coins, gifts])

  useEffect(() => {
    if (quantity > maxQty) setQuantity(Math.max(1, maxQty))
    if (quantity < 1) setQuantity(1)
  }, [maxQty, quantity])

  function goLogin() {
    router.push('/(auth)/login' as any)
  }

  function goTopup() {
    router.push('/(tabs)/profile' as any)
  }

  async function sendGift() {
    if (sending || !selected || !bookId) return
    const token = await Auth.getToken()
    if (!token) {
      Alert.alert('Cần đăng nhập', 'Đăng nhập và có xu trong ví mới tặng được quà.', [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Đăng nhập', onPress: goLogin },
      ])
      return
    }
    if (!balanceKnown || coins <= 0) {
      Alert.alert('Chưa có xu', 'Nạp xu vào ví rồi mới tặng quà cho tác giả.', [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Nạp xu', onPress: goTopup },
      ])
      return
    }
    if (coins < total || maxQty < 1) {
      Alert.alert('Không đủ xu', 'Số xu trong ví không đủ cho món quà này.')
      return
    }
    Alert.alert(
      'Xác nhận tặng quà',
      `Tặng ${quantity} ${selected.emoji} ${selected.name} (${total} xu)?`,
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Tặng', onPress: () => submit(token, selected, quantity, total) },
      ]
    )
  }

  async function submit(token: string, gift: GiftItem, qty: number, spent: number) {
    setSending(true)
    try {
      const res: any = await apiSendGift(bookId, gift.code, qty, token)
      if (!res || res.error || res.success !== true) {
        Alert.alert('Không tặng được', giftErrorMessage(res))
        return
      }
      const sent = res.gift || {}
      setBurst({
        emoji: sent.emoji || gift.emoji,
        name: sent.name || gift.name,
        quantity: Number(sent.quantity || qty),
        color: themeFor(sent.code || gift.code).deep,
      })
      setQuantity(1)
      onWalletRefresh()
      loadRecent()
      if (coins - spent <= 0) setSelectedCode(null)
    } catch (e: any) {
      Alert.alert('Không tặng được', e && e.message ? e.message : 'Không gửi được quà.')
    } finally {
      setSending(false)
    }
  }

  let note = 'Chọn một món quà. Xu trong ví sẽ chuyển cho tác giả.'
  let actionLabel = 'Tặng quà'
  let action: () => void = sendGift
  let actionDisabled = sending || !selected || maxQty < 1
  if (!userLoaded || (loggedIn && walletLoading && !balanceKnown)) {
    note = 'Đang kiểm tra tài khoản...'
    actionDisabled = true
  } else if (!loggedIn) {
    note = 'Đăng nhập và có xu trong ví mới tặng được quà.'
    actionLabel = 'Đăng nhập'
    action = goLogin
    actionDisabled = false
  } else if (isSelfAuthor) {
    note = 'Bạn không thể tặng quà cho truyện của chính mình.'
    actionDisabled = true
  } else if (!balanceKnown) {
    note = 'Chưa kiểm tra được số xu. Thử lại trước khi tặng.'
    actionLabel = 'Thử lại'
    action = onWalletRefresh
    actionDisabled = false
  } else if (coins <= 0) {
    note = 'Ví chưa có xu. Nạp xu rồi mới tặng quà được.'
    actionLabel = 'Nạp xu'
    action = goTopup
    actionDisabled = false
  } else if (selected) {
    note = `Đang chọn ${selected.emoji} ${selected.name} ×${quantity} · ${total} xu · Số dư ${coins} xu`
    actionDisabled = sending || total > coins || total <= 0
  }

  const locked = !canSpend

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Ủng hộ tác giả</Text>
      <Text style={styles.meta}>{note}</Text>
      <View style={styles.grid}>
        {gifts.map((gift) => {
          const tooPricey = canSpend && gift.coins > coins
          return (
            <Tile
              key={gift.code}
              gift={gift}
              selected={!locked && selectedCode === gift.code}
              disabled={locked || tooPricey || sending}
              onPress={() => {
                setSelectedCode(gift.code)
                setQuantity(1)
              }}
            />
          )
        })}
      </View>

      {canSpend && selected ? (
        <View style={styles.qtyRow}>
          <Text style={styles.meta}>Số lượng</Text>
          <View style={styles.stepper}>
            <Pressable
              disabled={quantity <= 1 || sending}
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              style={[styles.stepBtn, quantity <= 1 && styles.tileOff]}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.qtyValue}>{quantity}</Text>
            <Pressable
              disabled={quantity >= maxQty || sending}
              onPress={() => setQuantity((q) => Math.min(maxQty, q + 1))}
              style={[styles.stepBtn, quantity >= maxQty && styles.tileOff]}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Pressable
        disabled={actionDisabled}
        onPress={action}
        style={[styles.sendBtn, actionDisabled && styles.sendBtnOff]}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{actionLabel}</Text>}
      </Pressable>

      <Text style={styles.recentTitle}>Quà gần đây</Text>
      {recent.length === 0 ? (
        <Text style={styles.meta}>Chưa có quà nào cho truyện này.</Text>
      ) : recent.map((item, index) => (
        <Text key={`${item.gift_code}-${item.created_at}-${index}`} style={styles.recentLine} numberOfLines={1}>
          {item.donor_name} đã tặng {item.emoji} {item.gift_name} ×{item.quantity}
        </Text>
      ))}

      {burst ? <BurstView {...burst} onFinish={() => setBurst(null)} /> : null}
    </View>
  )
}

export default function AuthorGiftCard(props: Props) {
  const plain = <GiftCardBody {...props} Tile={StaticTile} BurstView={PlainBurst} />
  let motion: { MotionTile?: React.ComponentType<TileProps>; MotionBurst?: React.ComponentType<BurstProps> } | null = null
  try {
    motion = require('./giftMotion')
  } catch {
    motion = null
  }
  if (!motion || !motion.MotionTile || !motion.MotionBurst) return plain
  const Tile = motion.MotionTile
  const BurstView = motion.MotionBurst
  return (
    <MotionBoundary fallback={plain}>
      <GiftCardBody {...props} Tile={Tile} BurstView={BurstView} />
    </MotionBoundary>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eef2f7',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 12 },
  tile: {
    width: '31.5%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#eef2f7',
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  tileOff: { opacity: 0.4 },
  medallion: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 30 },
  name: { marginTop: 6, fontSize: 12, fontWeight: '800', color: '#0f172a' },
  price: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f2f4f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  qtyValue: { minWidth: 18, textAlign: 'center', fontWeight: '800', color: '#0f172a' },
  sendBtn: {
    marginTop: 12,
    backgroundColor: '#1088ff',
    borderRadius: 12,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.45 },
  sendText: { color: '#fff', fontWeight: '800' },
  recentTitle: { marginTop: 14, fontSize: 13, fontWeight: '800', color: '#0f172a' },
  recentLine: { marginTop: 6, fontSize: 13, color: '#334155' },
  burstWrap: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDisc: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: { fontSize: 62 },
  heroLabel: {
    marginTop: 12,
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
})
