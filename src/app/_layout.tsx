import { Stack } from "expo-router";
import { StyleSheet, View, Platform } from "react-native";
import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AppThemeProvider, useAppTheme } from '../components/AppTheme'
import { KeyboardPush } from '../components/KeyboardSafe'
import { syncAuthorizedPushToken } from '../lib/pushNotifications'

export default function RootLayout() {
  return <AppThemeProvider><AppStack /></AppThemeProvider>
}

function AppStack() {
  const { colors, mode } = useAppTheme()
  const router = useRouter()
  useEffect(() => {
    if (Platform.OS !== 'android') return
    let stopOpen: (() => void) | undefined
    let stopRefresh: (() => void) | undefined
    let active = true
    const openChapter = (message: any) => {
      const data = message?.data || {}
      const storyId = data.storyId || data.story_id
      const chapterNo = data.chapterNo || data.chapter_no
      if (data.type !== 'new_chapter' || !storyId || !chapterNo) return
      router.push({ pathname: '/reader/[id]', params: { id: String(storyId), ch: String(chapterNo) } } as any)
    }
    import('@react-native-firebase/messaging').then(async firebaseMessaging => {
      if (!active) return
      const client = firebaseMessaging.default()
      stopOpen = client.onNotificationOpenedApp(openChapter)
      stopRefresh = client.onTokenRefresh(() => { void syncAuthorizedPushToken() })
      const initial = await client.getInitialNotification()
      if (active && initial) openChapter(initial)
    }).catch(error => console.warn('[push] Unable to attach notification handlers:', error))
    return () => {
      active = false
      stopOpen?.()
      stopRefresh?.()
    }
  }, [router])
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <KeyboardPush style={{ backgroundColor: colors.bg }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="home" />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="search" />
          <Stack.Screen name="book/[id]" />
          <Stack.Screen name="reader/[id]" />
          <Stack.Screen name="chatbot" />
        </Stack>
      </KeyboardPush>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
