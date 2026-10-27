import React from 'react'
import { View } from 'react-native'

export type GiftItem = {
  code: string
  name: string
  emoji: string
  coins: number
}

export const FALLBACK_GIFTS: GiftItem[] = [
  { code: 'rose', name: 'Hoa hồng', emoji: '🌹', coins: 10 },
  { code: 'milktea', name: 'Trà sữa', emoji: '🧋', coins: 50 },
  { code: 'lion', name: 'Sư tử', emoji: '🦁', coins: 100 },
  { code: 'rocket', name: 'Tên lửa', emoji: '🚀', coins: 200 },
  { code: 'crown', name: 'Vương miện', emoji: '👑', coins: 500 },
]

const THEMES: Record<string, { accent: string; soft: string; deep: string }> = {
  rose: { accent: '#e11d48', soft: '#ffe4e6', deep: '#fb7185' },
  milktea: { accent: '#d97706', soft: '#fef3c7', deep: '#fbbf24' },
  lion: { accent: '#ea580c', soft: '#ffedd5', deep: '#fb923c' },
  rocket: { accent: '#4f46e5', soft: '#e0e7ff', deep: '#818cf8' },
  crown: { accent: '#ca8a04', soft: '#fef9c3', deep: '#facc15' },
}

export function themeFor(code: string) {
  return THEMES[code] || { accent: '#1088ff', soft: '#e0f2fe', deep: '#7dd3fc' }
}

let gradientImpl: any = undefined

function loadGradient() {
  if (gradientImpl !== undefined) return gradientImpl
  try {
    gradientImpl = require('expo-linear-gradient').LinearGradient
  } catch {
    gradientImpl = null
  }
  return gradientImpl
}

export function GradientFill({ colors, style, children }: { colors: string[]; style?: any; children?: React.ReactNode }) {
  const Gradient = loadGradient()
  if (!Gradient) return <View style={[style, { backgroundColor: colors[0] }]}>{children}</View>
  return <Gradient colors={colors} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={style}>{children}</Gradient>
}

export function haptic(kind: 'select' | 'success') {
  try {
    const Haptics = require('expo-haptics')
    if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    else void Haptics.selectionAsync()
  } catch {
    // Native module is absent until the Android dev client is rebuilt.
  }
}
