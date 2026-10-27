import React, { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'

export default function TypingDots({ color }: { color: string }) {
  const dot0 = useRef(new Animated.Value(0.25)).current
  const dot1 = useRef(new Animated.Value(0.25)).current
  const dot2 = useRef(new Animated.Value(0.25)).current
  const dots = [dot0, dot1, dot2]

  useEffect(() => {
    const loops = dots.map((dot, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 160),
      Animated.timing(dot, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0.25, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.delay(320),
    ])))
    loops.forEach((loop) => loop.start())
    return () => loops.forEach((loop) => loop.stop())
  }, [dot0, dot1, dot2])

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 18 }}>
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity: dot }}
        />
      ))}
    </View>
  )
}
