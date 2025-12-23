import * as SecureStore from 'expo-secure-store'
import { apiLogin, apiRegister } from './api'

const TOKEN_KEY = 'reader_app_token'

const USER_KEY = 'reader_app_user'

export async function saveToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function saveUser(user: any) {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
  } catch (e) {
    // ignore
  }
}

export async function getUser(): Promise<any | null> {
  try {
    const s = await SecureStore.getItemAsync(USER_KEY)
    if (!s) return null
    return JSON.parse(s)
  } catch (e) {
    return null
  }
}

export async function removeUser() {
  return SecureStore.deleteItemAsync(USER_KEY)
}

export async function removeToken() {
  return SecureStore.deleteItemAsync(TOKEN_KEY)
}

export async function login(email: string, password: string) {
  const res: any = await apiLogin(email, password)
  if (res && res.error) {
    throw new Error(res.error || 'Đăng nhập thất bại')
  }
  if (res && res.token) {
    await saveToken(res.token)
    // if server returned user info, persist it too for UI
    if (res.user) await saveUser(res.user)
    return res
  }
  throw new Error('Đăng nhập thất bại - không nhận được token')
}

export async function register(name: string, email: string, password: string) {
  return apiRegister(name, email, password)
}

export default { saveToken, getToken, removeToken, login, register }
