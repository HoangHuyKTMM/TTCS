import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { Video, ResizeMode } from 'expo-av'
import * as Linking from 'expo-linking'
import { apiFetchAds, type VideoAd } from '../lib/api'

type Props = { size?: 'small' | 'medium' | 'large' }

export default function AdBanner({ size = 'medium' }: Props) {
  const height = size === 'small' ? 60 : size === 'large' ? 160 : 90
  const [loading, setLoading] = useState(false)
  const [ad, setAd] = useState<VideoAd | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res: any = await apiFetchAds('banner')
        if (cancelled) return
        if (Array.isArray(res) && res.length > 0) {
          const pick = res[Math.floor(Math.random() * res.length)] as VideoAd
          setAd(pick?.video_url ? pick : null)
        } else {
          setAd(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const title = useMemo(() => ad?.title || 'Quảng cáo', [ad])
  const link = ad?.link_url

  return (
    <View style={[styles.container, { height }]}>
      <Pressable
        style={[styles.adBox, { height }]}
        disabled={!link}
        onPress={() => { if (link) Linking.openURL(link).catch(() => {}) }}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color="#1088ff" />
          </View>
        ) : ad?.video_url ? (
          <>
            <Video
              style={styles.video}
              source={{ uri: ad.video_url }}
              shouldPlay
              isLooping
              isMuted
              resizeMode={ResizeMode.COVER}
            />
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>{title}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.adText}>Quảng cáo</Text>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  adBox: { width: '94%', borderRadius: 10, borderWidth: 1, borderColor: '#e6e6e6', backgroundColor: '#111827', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  adText: { color: '#b9770e', fontWeight: '700' },
  video: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  badge: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, maxWidth: '90%' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
