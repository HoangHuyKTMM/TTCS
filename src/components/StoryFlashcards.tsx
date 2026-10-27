import { useThemeStyles } from './AppTheme'
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { API_BASE } from '../lib/api'
import { cardShadow, radius, type AppColors } from '../theme'

export type SuggestionBook = {
  id: string | number
  title?: string
  genre?: string | null
  cover_url?: string | null
  chapters_count?: number
  description?: string | null
}

type Props = {
  books: SuggestionBook[]
  onOpen: (id: string) => void
  compact?: boolean
}

export function recommendationLead(content: string) {
  return String(content || '')
    .split('\n')
    .filter((line) => !/^\s*[-*]\s+/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function coverUri(url?: string | null) {
  const value = String(url || '').trim()
  if (!value) return null
  if (value.startsWith('http')) return value
  return `${API_BASE}${value.startsWith('/') ? '' : '/'}${value}`
}

export default function StoryFlashcards({ books, onOpen, compact }: Props) {
  const { colors, styles } = useThemeStyles(createStyles)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const spin = useRef(new Animated.Value(0)).current
  const safeIndex = Math.min(index, Math.max(0, books.length - 1))
  const book = books[safeIndex]

  useEffect(() => {
    spin.setValue(0)
    setFlipped(false)
  }, [safeIndex, spin])

  if (!book) return null

  const flip = () => {
    const next = !flipped
    setFlipped(next)
    Animated.timing(spin, {
      toValue: next ? 1 : 0,
      duration: 320,
      useNativeDriver: true,
    }).start()
  }

  const frontRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const backRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })
  const uri = coverUri(book.cover_url)
  const title = book.title || 'Truyện'
  const genre = book.genre || 'Truyện'
  const chapters = Number(book.chapters_count || 0)
  const description = String(book.description || '').trim() || 'Chưa có mô tả. Mở truyện để xem nội dung.'
  const cardHeight = compact ? 156 : 188

  return (
    <View style={styles.wrap}>
      <View style={[styles.stage, { height: cardHeight }]}>
        <Animated.View
          pointerEvents={flipped ? 'none' : 'auto'}
          style={[styles.face, styles.front, { transform: [{ perspective: 900 }, { rotateY: frontRotate }] }]}
        >
          <Pressable style={styles.frontBody} onPress={flip} accessibilityRole="button" accessibilityLabel={`Lật thẻ ${title}`}>
            {uri ? (
              <Image source={{ uri }} style={compact ? styles.coverSm : styles.cover} />
            ) : (
              <View style={[compact ? styles.coverSm : styles.cover, styles.coverFallback]}>
                <Ionicons name="book" size={22} color={colors.accentText} />
              </View>
            )}
            <View style={styles.frontCopy}>
              <Text style={styles.kicker}>Gợi ý {safeIndex + 1}</Text>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {genre}{chapters > 0 ? ` · ${chapters} chương` : ''}
              </Text>
              <View style={styles.hintRow}>
                <Ionicons name="sync-outline" size={13} color={colors.accentText} />
                <Text style={styles.hint}>Chạm để xem mô tả</Text>
              </View>
            </View>
          </Pressable>
        </Animated.View>

        <Animated.View
          pointerEvents={flipped ? 'auto' : 'none'}
          style={[styles.face, styles.back, { transform: [{ perspective: 900 }, { rotateY: backRotate }] }]}
        >
          <Pressable style={styles.backCopy} onPress={flip} accessibilityRole="button" accessibilityLabel="Lật lại mặt trước">
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.description} numberOfLines={compact ? 3 : 4}>{description}</Text>
          </Pressable>
          <Pressable
            style={styles.readBtn}
            onPress={() => onOpen(String(book.id))}
            accessibilityRole="button"
            accessibilityLabel={`Đọc ${title}`}
          >
            <Text style={styles.readText}>Đọc truyện</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.onAccent} />
          </Pressable>
        </Animated.View>
      </View>

      {books.length > 1 ? (
        <View style={styles.nav}>
          <Pressable
            onPress={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={safeIndex === 0}
            hitSlop={8}
            accessibilityLabel="Thẻ trước"
            style={[styles.navBtn, safeIndex === 0 && styles.navBtnOff]}
          >
            <Ionicons name="chevron-back" size={16} color={colors.text} />
          </Pressable>
          <View style={styles.dots}>
            {books.map((item, dot) => (
              <Pressable key={String(item.id)} onPress={() => setIndex(dot)} hitSlop={6} accessibilityLabel={`Thẻ ${dot + 1}`}>
                <View style={[styles.dot, dot === safeIndex && styles.dotOn]} />
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setIndex((value) => Math.min(books.length - 1, value + 1))}
            disabled={safeIndex === books.length - 1}
            hitSlop={8}
            accessibilityLabel="Thẻ sau"
            style={[styles.navBtn, safeIndex === books.length - 1 && styles.navBtnOff]}
          >
            <Ionicons name="chevron-forward" size={16} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  wrap: { marginTop: 10, width: '100%' },
  stage: { width: '100%' },
  face: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.lg,
    backfaceVisibility: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...cardShadow,
  },
  front: { backgroundColor: colors.surface },
  back: { backgroundColor: colors.accentSoft, padding: 12, justifyContent: 'space-between' },
  frontBody: { flex: 1, flexDirection: 'row', gap: 12, padding: 12 },
  cover: { width: 78, height: 108, borderRadius: radius.sm, backgroundColor: colors.coverBg },
  coverSm: { width: 64, height: 90, borderRadius: radius.sm, backgroundColor: colors.coverBg },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSubtle },
  frontCopy: { flex: 1, justifyContent: 'center' },
  kicker: { fontSize: 11, fontWeight: '800', color: colors.accentText, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '800', color: colors.text, lineHeight: 20 },
  meta: { marginTop: 4, fontSize: 12, color: colors.textSecondary },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  hint: { fontSize: 12, fontWeight: '700', color: colors.accentText },
  backCopy: { flex: 1 },
  description: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  readBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  readText: { color: colors.onAccent, fontWeight: '800', fontSize: 13 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  navBtnOff: { opacity: 0.35 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 16, backgroundColor: colors.accent },
})
