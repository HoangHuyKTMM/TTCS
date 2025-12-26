import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Modal, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av'
import { apiFetchAds, type VideoAd } from '../lib/api'
import * as Linking from 'expo-linking'

type Props = {
  visible: boolean
  onFinish: () => void
  seconds?: number
  placement?: string
  /** Minimum seconds before allowing user to close (shows X) */
  minSecondsToSkip?: number
}

export default function AdInterstitial({ visible, onFinish, seconds = 0, placement = 'interstitial', minSecondsToSkip = 15 }: Props) {
  const [loading, setLoading] = useState(false)
  const [ad, setAd] = useState<VideoAd | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Global requirement: ALL interstitials must be unskippable for at least 15 seconds.
  const enforcedMinSeconds = Math.max(15, Math.floor(minSecondsToSkip || 0))
  const [skipRemaining, setSkipRemaining] = useState<number>(enforcedMinSeconds)

  const videoRef = useRef<Video | null>(null)
  const finishedRef = useRef(false)

  const finish = useCallback(() => {
    if (finishedRef.current) return
    // Enforce minimum watch time (can't be bypassed).
    if (skipRemaining > 0) return
    finishedRef.current = true
    onFinish()
  }, [onFinish, skipRemaining])

  const adTitle = useMemo(() => ad?.title || 'Quảng cáo', [ad])

  useEffect(() => {
    if (!visible) return
    finishedRef.current = false
    setSkipRemaining(enforcedMinSeconds)
    const i = setInterval(() => {
      setSkipRemaining((r) => (r > 0 ? r - 1 : 0))
    }, 1000)
    return () => clearInterval(i)
  }, [visible, enforcedMinSeconds])

  useEffect(() => {
    if (!visible) return
    // Auto-close is optional. If you want it, pass seconds > 0.
    // Never auto-close before the enforced minimum watch time.
    if (!seconds || seconds <= 0) return
    const delay = Math.max(Math.floor(seconds), enforcedMinSeconds, 1) * 1000
    const t = setTimeout(() => {
      // Only auto-close if the min time is satisfied.
      if (skipRemaining <= 0) finish()
    }, delay)
    return () => clearTimeout(t)
  }, [visible, finish, seconds, enforcedMinSeconds, skipRemaining])

  useEffect(() => {
    if (!visible) {
      setLoading(false)
      setAd(null)
      setError(null)
      // Best-effort stop/unload.
      ;(async () => {
        try { await videoRef.current?.stopAsync() } catch {}
        try { await videoRef.current?.unloadAsync() } catch {}
      })()
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res: any = await apiFetchAds(placement)
        if (cancelled) return
        if (!Array.isArray(res) || res.length === 0) {
          setAd(null)
          return
        }
        const pick = res[Math.floor(Math.random() * res.length)] as VideoAd
        if (!pick?.video_url) {
          setAd(null)
          return
        }
        setAd(pick)
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [visible, placement])

  const handleOpenLink = useCallback(async () => {
    const url = ad?.link_url
    if (!url) return
    try {
      await Linking.openURL(url)
    } catch {
      // ignore
    }
  }, [ad])

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return
    if ((status as any).didJustFinish) {
      // If user still can't skip, replay to keep video running until unlock.
      if (skipRemaining > 0) {
        try { videoRef.current?.replayAsync() } catch {}
        return
      }
      finish()
    }
  }, [finish, skipRemaining])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.overlay}>
        <View style={styles.fullscreen}>
          <View style={styles.topRight}>
            {skipRemaining > 0 ? (
              <View style={styles.lockPill}>
                <Text style={styles.lockText}>X sau {skipRemaining}s</Text>
              </View>
            ) : (
              <Pressable style={styles.closeBtn} onPress={finish} hitSlop={10}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.videoWrap}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#1088ff" />
                <Text style={styles.hint}>Đang tải quảng cáo…</Text>
              </View>
            ) : ad?.video_url ? (
              <Pressable style={{ flex: 1 }} onPress={handleOpenLink}>
                <Video
                  ref={(r) => { videoRef.current = r }}
                  style={styles.video}
                  source={{ uri: ad.video_url }}
                  shouldPlay={visible}
                  // If user cannot skip yet, loop/replay to guarantee minimum watch time UX.
                  isLooping={skipRemaining > 0}
                  isMuted={false}
                  resizeMode={ResizeMode.CONTAIN}
                  onPlaybackStatusUpdate={onStatus}
                  onError={() => setError('Không thể phát video quảng cáo')}
                />
              </Pressable>
            ) : (
              <View style={styles.center}>
                <Text style={styles.body}>Không có quảng cáo video — mua VIP để tắt quảng cáo.</Text>
              </View>
            )}
          </View>

          {error ? <Text style={styles.err}>{error}</Text> : null}
          {!!adTitle && false ? <Text /> : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  fullscreen: { flex: 1, width: '100%', backgroundColor: '#000' },
  topRight: { position: 'absolute', top: 44, right: 16, zIndex: 10 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,24,39,0.9)' },
  closeText: { color: '#fff', fontWeight: '900', fontSize: 16, lineHeight: 16 },
  lockPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(17,24,39,0.9)' },
  lockText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  videoWrap: { flex: 1, backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  hint: { marginTop: 10, fontSize: 12, color: '#e5e7eb' },
  body: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  err: { position: 'absolute', left: 16, right: 16, bottom: 24, fontSize: 12, color: '#ef4444', textAlign: 'center' },
})
