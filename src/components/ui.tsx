import { useThemeStyles } from './AppTheme'
import React from 'react'
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { radius, cardShadow, cardShadowSm, type AppColors } from '../theme'

export function Cover({
  uri,
  width,
  height,
  radius: r = 12,
  style,
}: {
  uri?: string | null
  width: number
  height: number
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: r,
          backgroundColor: colors.coverBg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(15, 23, 42, 0.06)',
        },
        style,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.coverImg} resizeMode="cover" />
      ) : (
        <View style={styles.coverFallback}>
          <Ionicons name="book" size={Math.min(width, height) * 0.36} color={colors.accentText} />
        </View>
      )}
    </View>
  )
}

export function GenreChip({
  label,
  active,
  onPress,
}: {
  label: string
  active?: boolean
  onPress?: () => void
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionAccentBar} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} style={styles.sectionActionBtn}>
          <Text style={styles.sectionAction}>{action}</Text>
          <Ionicons name="arrow-forward" size={12} color={colors.accentText} />
        </Pressable>
      ) : null}
    </View>
  )
}

export function RankBadge({ index }: { index: number }) {
  const { colors, styles } = useThemeStyles(createStyles)

  const isFirst = index === 0
  const isSecond = index === 1
  const isThird = index === 2

  const bg = isFirst ? colors.gold : isSecond ? colors.silver : isThird ? colors.bronze : 'rgba(15, 23, 42, 0.65)'

  return (
    <View style={[styles.rankBadge, { backgroundColor: bg }]}>
      {isFirst ? (
        <Ionicons name="trophy" size={10} color={colors.onVip} style={{ marginRight: 2 }} />
      ) : null}
      <Text style={[styles.rankBadgeText, { color: index < 3 ? colors.onVip : colors.onDark }]}>{index + 1}</Text>
    </View>
  )
}

export function StoryPoster({
  cover,
  title,
  subtitle,
  onPress,
  width = 118,
  rank,
}: {
  cover?: string | null
  title: string
  subtitle?: string
  onPress?: () => void
  width?: number
  rank?: number
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  const height = Math.round(width * 1.38)
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width },
        styles.posterContainer,
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.posterCoverWrapper}>
        <Cover uri={cover} width={width} height={height} radius={14} />
        {typeof rank === 'number' ? <RankBadge index={rank} /> : null}
      </View>
      <Text style={styles.posterTitle} numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <View style={styles.posterMetaRow}>
          <Ionicons name="eye-outline" size={12} color={colors.textMuted} />
          <Text style={styles.posterSub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function StoryRow({
  cover,
  title,
  subtitle,
  meta,
  onPress,
  rank,
  right,
}: {
  cover?: string | null
  title: string
  subtitle?: string
  meta?: string
  onPress?: () => void
  rank?: number
  right?: React.ReactNode
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: 'rgba(0,0,0,0.02)' },
      ]}
    >
      <View style={styles.rowCoverWrapper}>
        <Cover uri={cover} width={58} height={78} radius={10} />
        {typeof rank === 'number' ? <RankBadge index={rank} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <View style={styles.rowSubContainer}>
            <View style={styles.genreTag}>
              <Text style={styles.genreTagText} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          </View>
        ) : null}
        {meta ? (
          <View style={styles.rowMetaRow}>
            <Ionicons name="sparkles-outline" size={11} color={colors.textMuted} />
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        ) : null}
      </View>
      {right ? right : <Ionicons name="chevron-forward" size={18} color={colors.border} />}
    </Pressable>
  )
}

export function ProgressBar({ value }: { value?: number | null }) {
  const { colors, styles } = useThemeStyles(createStyles)

  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  )
}

export function ContinueCard({
  cover,
  title,
  chapterLabel,
  progress,
  onPress,
}: {
  cover?: string | null
  title: string
  chapterLabel?: string
  progress?: number | null
  onPress?: () => void
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.continueCard,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Cover uri={cover} width={58} height={78} radius={10} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {chapterLabel ? (
          <View style={styles.continueChBadge}>
            <Ionicons name="book-outline" size={12} color={colors.accentText} />
            <Text style={styles.continueCh} numberOfLines={1}>
              {chapterLabel}
            </Text>
          </View>
        ) : null}
        <ProgressBar value={progress} />
      </View>
      <View style={styles.playIconCircle}>
        <Ionicons name="play" size={16} color={colors.accentText} />
      </View>
    </Pressable>
  )
}

export function EmptyState({
  icon = 'library-outline',
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.accentText} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.emptyBtn}>
          <Text style={styles.emptyBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function SegmentedControl({
  tabs,
  value,
  onChange,
}: {
  tabs: string[]
  value: string
  onChange: (tab: string) => void
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <View style={styles.segment}>
      {tabs.map((tab) => {
        const active = tab === value
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{tab}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ScreenBack({
  title,
  onBack,
  right,
}: {
  title: string
  onBack: () => void
  right?: React.ReactNode
}) {
  const { colors, styles } = useThemeStyles(createStyles)

  return (
    <View style={styles.backRow}>
      <Pressable onPress={onBack} style={styles.backBtn} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.backTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.backRight}>{right}</View>
    </View>
  )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  coverImg: { width: '100%', height: '100%' },
  coverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },

  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  chipInactive: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  chipActive: {
    backgroundColor: colors.accent,
    ...cardShadowSm,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.onAccent,
    fontWeight: '700',
  },

  sectionRow: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionAccentBar: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  sectionActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  sectionAction: {
    fontSize: 12,
    color: colors.accentText,
    fontWeight: '700',
  },

  rankBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadowSm,
  },
  rankBadgeText: {
    color: colors.onDark,
    fontWeight: '800',
    fontSize: 11,
  },

  posterContainer: {
    marginBottom: 4,
  },
  posterCoverWrapper: {
    borderRadius: 14,
    ...cardShadowSm,
  },
  posterTitle: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 18,
  },
  posterMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  posterSub: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowCoverWrapper: {
    borderRadius: 10,
    ...cardShadowSm,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 20,
  },
  rowSubContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  genreTag: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  genreTagText: {
    fontSize: 11,
    color: colors.accentDark,
    fontWeight: '600',
  },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },

  progressTrack: {
    height: 5,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },

  continueCard: {
    width: 270,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  continueChBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  continueCh: {
    fontSize: 12,
    color: colors.accentText,
    fontWeight: '600',
  },
  playIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadowSm,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptySub: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.full,
    ...cardShadowSm,
  },
  emptyBtnText: {
    color: colors.onAccent,
    fontWeight: '700',
    fontSize: 13,
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.full,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.surface,
    ...cardShadowSm,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '700',
  },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadowSm,
  },
  backTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  backRight: {
    width: 38,
    alignItems: 'flex-end',
  },
})
