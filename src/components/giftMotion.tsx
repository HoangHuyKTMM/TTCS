import React, { useEffect } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { GradientFill, haptic, themeFor, type GiftItem } from './giftVisuals'

const bloom = require('../assets/lottie/gift-bloom.json')

let LottieView: any = null
try {
  LottieView = require('lottie-react-native').default
} catch {
  LottieView = null
}

class QuietBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const SPARKS = [
  { x: -78, y: -24, delay: 40 },
  { x: 82, y: -16, delay: 80 },
  { x: -36, y: 72, delay: 20 },
  { x: 48, y: 64, delay: 110 },
  { x: 4, y: -86, delay: 60 },
  { x: -96, y: 28, delay: 140 },
]

export function MotionTile({
  gift,
  selected,
  disabled,
  onPress,
}: {
  gift: GiftItem
  selected: boolean
  disabled: boolean
  onPress: () => void
}) {
  const theme = themeFor(gift.code)
  const scale = useSharedValue(1)
  const bob = useSharedValue(0)

  useEffect(() => {
    if (selected && !disabled) {
      bob.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: 780, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 780, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
      scale.value = withSpring(1.04, { damping: 12, stiffness: 180 })
    } else {
      bob.value = withTiming(0, { duration: 180 })
      scale.value = withTiming(1, { duration: 180 })
    }
  }, [selected, disabled, bob, scale])

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { scale: scale.value }],
  }))

  return (
    <Animated.View style={[styles.tile, selected && { borderColor: theme.accent, backgroundColor: theme.soft }, disabled && styles.tileOff, anim]}>
      <Pressable
        disabled={disabled}
        onPress={() => {
          haptic('select')
          onPress()
        }}
        onPressIn={() => {
          if (!disabled) scale.value = withSpring(0.94, { damping: 16, stiffness: 320 })
        }}
        onPressOut={() => {
          if (!disabled) scale.value = withSpring(selected ? 1.04 : 1, { damping: 12, stiffness: 220 })
        }}
        style={styles.tilePress}
      >
        <GradientFill colors={[theme.soft, '#fff']} style={styles.medallion}>
          <Text style={styles.emoji}>{gift.emoji}</Text>
        </GradientFill>
        <Text style={styles.name} numberOfLines={1}>{gift.name}</Text>
        <Text style={[styles.price, { color: theme.accent }]}>{gift.coins} xu</Text>
      </Pressable>
    </Animated.View>
  )
}

function Spark({ x, y, delay, color }: { x: number; y: number; delay: number; color: string }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 980, easing: Easing.out(Easing.cubic) }))
  }, [delay, p])
  const style = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [
      { translateX: x * p.value },
      { translateY: y * p.value },
      { scale: 0.35 + (1 - p.value) * 0.9 },
    ],
  }))
  return <Animated.View style={[styles.spark, { backgroundColor: color }, style]} />
}

export function MotionBurst({
  emoji,
  name,
  quantity,
  color,
  onFinish,
}: {
  emoji: string
  name: string
  quantity: number
  color: string
  onFinish: () => void
}) {
  const scale = useSharedValue(0.25)
  const ty = useSharedValue(70)
  const opacity = useSharedValue(0)
  const scrim = useSharedValue(0)

  useEffect(() => {
    haptic('success')
    scrim.value = withTiming(1, { duration: 180 })
    opacity.value = withTiming(1, { duration: 160 })
    scale.value = withSpring(1, { damping: 11, stiffness: 160, mass: 0.7 })
    ty.value = withSequence(
      withSpring(0, { damping: 13, stiffness: 140 }),
      withDelay(460, withTiming(-150, { duration: 760, easing: Easing.in(Easing.cubic) }))
    )
    const hide = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 220 })
      scrim.value = withTiming(0, { duration: 220 })
    }, 1280)
    const done = setTimeout(onFinish, 1560)
    return () => {
      clearTimeout(hide)
      clearTimeout(done)
    }
  }, [onFinish, opacity, scale, scrim, ty])

  const hero = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }, { scale: scale.value }],
  }))
  const dim = useAnimatedStyle(() => ({ opacity: scrim.value }))

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onFinish}>
      <View style={styles.overlay}>
      <Animated.View style={[styles.scrim, dim]} />
      <View style={styles.stage}>
        {LottieView ? (
          <QuietBoundary>
            <LottieView source={bloom} autoPlay loop={false} style={styles.lottie} />
          </QuietBoundary>
        ) : null}
        {SPARKS.map((spark, i) => (
          <Spark key={i} x={spark.x} y={spark.y} delay={spark.delay} color={i % 2 ? color : '#fff'} />
        ))}
        <Animated.View style={[styles.hero, hero]}>
          <GradientFill colors={[color, '#fff']} style={styles.heroDisc}>
            <Text style={styles.heroEmoji}>{emoji}</Text>
          </GradientFill>
          <Text style={styles.heroLabel}>Đã tặng {name} ×{quantity}</Text>
        </Animated.View>
      </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  tile: {
    width: '31.5%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#eef2f7',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  tileOff: { opacity: 0.4 },
  tilePress: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6 },
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
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  stage: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center' },
  lottie: { position: 'absolute', width: 320, height: 320 },
  spark: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  hero: { alignItems: 'center' },
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
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
})
