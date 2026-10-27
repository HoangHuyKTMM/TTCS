import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
  type ScrollViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const GAP = 24

type Measurable = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void
}

function keyboardTopFromEvent(event: KeyboardEvent, navBar: number) {
  const windowH = Dimensions.get('window').height
  const reported = Math.max(0, Math.round(event.endCoordinates?.height || 0))
  const screenY = Number(event.endCoordinates?.screenY ?? windowH)
  // iOS screenY is the top of the keyboard. Edge-to-edge Android leaves screenY
  // at the bottom of the window, so the top has to be derived from the IME height.
  if (screenY < windowH - 40) return screenY
  return Math.max(0, windowH - reported - Math.max(0, navBar))
}

export function KeyboardPush({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets()
  const shift = useRef(new Animated.Value(0)).current
  const liftRef = useRef(0)
  const visualLift = useRef(0)
  const keyboardTopRef = useRef(Dimensions.get('window').height)
  const navRef = useRef(insets.bottom)
  navRef.current = insets.bottom
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const placeRef = useRef<() => void>(() => {})
  const session = useRef(0)

  useEffect(() => {
    const id = shift.addListener(({ value }) => {
      visualLift.current = -value
    })
    return () => {
      shift.removeListener(id)
    }
  }, [shift])

  const apply = (lift: number, span: number) => {
    const next = Math.max(0, Math.min(Math.round(span + GAP), Math.round(lift)))
    if (Math.abs(next - liftRef.current) < 8) return
    liftRef.current = next
    Animated.timing(shift, {
      toValue: -next,
      duration: 160,
      // JS driver keeps the translation in the layout tree, so hit targets and
      // measureInWindow follow the form instead of staying under the keyboard.
      useNativeDriver: false,
    }).start()
  }

  const placeFocused = () => {
    const keyboardTop = keyboardTopRef.current
    const windowH = Dimensions.get('window').height
    const span = Math.max(0, windowH - keyboardTop)
    if (span < 1) {
      if (liftRef.current !== 0) {
        liftRef.current = 0
        Animated.timing(shift, { toValue: 0, duration: 140, useNativeDriver: false }).start()
      }
      return
    }
    const token = session.current
    const focused = TextInput.State.currentlyFocusedInput() as Measurable | null
    let settled = false
    const finish = (y: number, height: number, measured: boolean) => {
      if (token !== session.current) return
      if (!measured && settled) return
      settled = true
      if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
        apply(span, span)
        return
      }
      // The measured frame already includes the current translation. Adding the
      // lift back yields the field's resting position, so a later pass does not
      // stack another shift on top of the first one.
      const layoutBottom = y + visualLift.current + height
      apply(layoutBottom + GAP - keyboardTop, span)
    }
    const failTimer = setTimeout(() => finish(Number.NaN, 0, false), 120)
    timers.current.push(failTimer)
    if (!focused?.measureInWindow) {
      finish(Number.NaN, 0, false)
      return
    }
    focused.measureInWindow((_x, y, _w, height) => finish(y, height, true))
  }
  placeRef.current = placeFocused

  useEffect(() => {
    const clearTimers = () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    const schedule = () => {
      timers.current.forEach(clearTimeout)
      timers.current = [60, 280].map((delay) => setTimeout(() => placeRef.current(), delay))
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardTopRef.current = keyboardTopFromEvent(event, navRef.current)
      schedule()
      if (!pollRef.current) pollRef.current = setInterval(() => placeRef.current(), 500)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      session.current += 1
      clearTimers()
      keyboardTopRef.current = Dimensions.get('window').height
      liftRef.current = 0
      Animated.timing(shift, { toValue: 0, duration: 140, useNativeDriver: false }).start()
    })
    return () => {
      clearTimers()
      show.remove()
      hide.remove()
    }
  }, [shift])

  return (
    <Animated.View
      collapsable={false}
      style={[{ flex: 1 }, style, { transform: [{ translateY: shift }] }]}
      onTouchStart={() => {
        if (keyboardTopRef.current < Dimensions.get('window').height - 20) {
          setTimeout(() => placeRef.current(), 80)
        }
      }}
    >
      {children}
    </Animated.View>
  )
}

export default function KeyboardSafeScroll({ children, ...rest }: ScrollViewProps) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" {...rest}>
      {children}
    </ScrollView>
  )
}

export function KeyboardModalFrame({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 16 }}>
      <KeyboardPush style={{ flex: 0, width: '100%', alignSelf: 'stretch' }}>
        {children}
      </KeyboardPush>
    </View>
  )
}
