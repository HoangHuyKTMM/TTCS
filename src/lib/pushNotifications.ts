import AsyncStorage from '@react-native-async-storage/async-storage'
import { PermissionsAndroid, Platform } from 'react-native'
import messaging from '@react-native-firebase/messaging'
import * as Auth from './auth'
import { apiRegisterPushToken } from './api'

const READ_COUNT_KEY = 'reader_push_read_count_v1'
const PERMISSION_ASKED_KEY = 'reader_push_permission_asked_v1'

export async function syncAuthorizedPushToken() {
  if (Platform.OS !== 'android') return
  const sessionToken = await Auth.getToken()
  if (!sessionToken) return
  if (Platform.Version >= 33) {
    const granted = await PermissionsAndroid.check('android.permission.POST_NOTIFICATIONS' as any)
    if (!granted) return
  }
  const token = await messaging().getToken()
  if (token) await apiRegisterPushToken(sessionToken, token)
}

export async function noteSuccessfulChapterRead() {
  if (Platform.OS !== 'android') return
  try {
    const previousCount = Number(await AsyncStorage.getItem(READ_COUNT_KEY)) || 0
    const readCount = previousCount + 1
    await AsyncStorage.setItem(READ_COUNT_KEY, String(readCount))
    if (readCount < 2) return

    if (Platform.Version >= 33) {
      const permission = 'android.permission.POST_NOTIFICATIONS' as any
      let granted = await PermissionsAndroid.check(permission)
      if (!granted && (await AsyncStorage.getItem(PERMISSION_ASKED_KEY)) !== 'yes') {
        await AsyncStorage.setItem(PERMISSION_ASKED_KEY, 'yes')
        granted = (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED
      }
      if (!granted) return
    }
    await syncAuthorizedPushToken()
  } catch (error) {
    console.warn('[push] Unable to register this device for chapter alerts:', error)
  }
}
