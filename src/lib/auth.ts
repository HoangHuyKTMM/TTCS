import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { apiLogin, apiRegister, API_BASE } from './api'

const TOKEN_KEY = 'reader_app_token'
const USER_KEY = 'reader_app_user'
const AUTH_METHOD_KEY = 'reader_app_auth_method'

// Dynamic imports for native modules (only available in development builds)
let firebaseAuth: any = null
let GoogleSignin: any = null
let FacebookLogin: any = null

// Initialize native modules
async function initNativeModules() {
  if (Platform.OS !== 'web') {
    try {
      const firebaseAuthModule = await import('@react-native-firebase/auth')
      firebaseAuth = firebaseAuthModule.default

      const googleSigninModule = await import('@react-native-google-signin/google-signin')
      GoogleSignin = googleSigninModule.GoogleSignin

      // Configure Google Sign-In
      GoogleSignin.configure({
        webClientId: '220903784873-rn1gdgqifur44r8am7a0h8mb0meh11v5.apps.googleusercontent.com',
        offlineAccess: true,
      })

      const fbsdkModule = await import('react-native-fbsdk-next')
      FacebookLogin = fbsdkModule

      console.log('[Auth] Native modules initialized successfully')
    } catch (err) {
      console.log('[Auth] Native modules not available (running in Expo Go)')
    }
  }
}

// Initialize on module load
initNativeModules()

// Web Firebase imports
let webAuth: any = null
let webSignInWithPopup: any = null
let webGoogleAuthProvider: any = null
let webFacebookAuthProvider: any = null

if (Platform.OS === 'web') {
  import('./firebase').then(module => {
    webAuth = module.auth
  })
  import('firebase/auth').then(module => {
    webSignInWithPopup = module.signInWithPopup
    webGoogleAuthProvider = module.GoogleAuthProvider
    webFacebookAuthProvider = module.FacebookAuthProvider
  })
}

// Secure store wrapper for web compatibility
async function setSecureItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value)
  } else {
    await SecureStore.setItemAsync(key, value)
  }
}

async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key)
  }
  return SecureStore.getItemAsync(key)
}

async function deleteSecureItem(key: string) {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key)
  } else {
    await SecureStore.deleteItemAsync(key)
  }
}

export async function saveToken(token: string) {
  await setSecureItem(TOKEN_KEY, token)
}

export async function getToken(): Promise<string | null> {
  return getSecureItem(TOKEN_KEY)
}

export async function saveUser(user: any) {
  try {
    await setSecureItem(USER_KEY, JSON.stringify(user))
  } catch (e) {
    // ignore
  }
}

export async function getUser(): Promise<any | null> {
  try {
    const s = await getSecureItem(USER_KEY)
    if (!s) return null
    return JSON.parse(s)
  } catch (e) {
    return null
  }
}

export async function removeUser() {
  return deleteSecureItem(USER_KEY)
}

export async function removeToken() {
  return deleteSecureItem(TOKEN_KEY)
}

// Sync Firebase user with backend
async function syncFirebaseUserWithBackend(firebaseUser: any, authMethod: string) {
  try {
    let idToken: string
    if (typeof firebaseUser.getIdToken === 'function') {
      idToken = await firebaseUser.getIdToken()
    } else {
      idToken = firebaseUser.idToken || ''
    }

    const response = await fetch(`${API_BASE}/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.name || firebaseUser.email?.split('@')[0],
        avatar_url: firebaseUser.photoURL || firebaseUser.photo,
        firebase_uid: firebaseUser.uid,
        auth_method: authMethod
      })
    })

    const data = await response.json()

    if (data.token) {
      await saveToken(data.token)
      if (data.user) await saveUser(data.user)
      return data
    }

    await saveToken(idToken)
    await saveUser({
      id: firebaseUser.uid,
      email: firebaseUser.email,
      name: firebaseUser.displayName || firebaseUser.name,
      avatar_url: firebaseUser.photoURL || firebaseUser.photo
    })

    return { token: idToken, user: firebaseUser }
  } catch (err) {
    console.error('Error syncing with backend:', err)
    throw err
  }
}

// Email/Password login (using backend API)
export async function login(email: string, password: string) {
  const res: any = await apiLogin(email, password)
  if (res && res.error) {
    throw new Error(res.error || 'Đăng nhập thất bại')
  }
  if (res && res.token) {
    await saveToken(res.token)
    await setSecureItem(AUTH_METHOD_KEY, 'email')
    if (res.user) await saveUser(res.user)
    return res
  }
  throw new Error('Đăng nhập thất bại - không nhận được token')
}

// Google Sign In
export async function loginWithGoogle() {
  console.log('[Auth] Starting Google Sign In, Platform:', Platform.OS)

  if (Platform.OS === 'web') {
    // Web: use Firebase popup
    try {
      const provider = new webGoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')
      const result = await webSignInWithPopup(webAuth, provider)
      await setSecureItem(AUTH_METHOD_KEY, 'google')
      return await syncFirebaseUserWithBackend(result.user, 'google')
    } catch (err: any) {
      console.error('[Auth] Web Google Sign In error:', err)
      if (err.code === 'auth/popup-closed-by-user') {
        throw new Error('Bạn đã đóng cửa sổ đăng nhập')
      }
      throw new Error(err.message || 'Đăng nhập Google thất bại')
    }
  } else {
    // Mobile: use native Google Sign-In
    if (!GoogleSignin || !firebaseAuth) {
      throw new Error('Đang chạy trên Expo Go - Google Sign-In cần development build. Vui lòng dùng email/password.')
    }

    try {
      // Check if Google Play Services are available
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })

      // Sign in with Google
      const userInfo = await GoogleSignin.signIn()
      console.log('[Auth] Google Sign In success:', userInfo.user?.email)

      // Get ID token
      const { idToken } = await GoogleSignin.getTokens()

      // Sign in to Firebase with the Google credential
      const googleCredential = firebaseAuth.GoogleAuthProvider.credential(idToken)
      const firebaseUserCredential = await firebaseAuth().signInWithCredential(googleCredential)

      await setSecureItem(AUTH_METHOD_KEY, 'google')
      return await syncFirebaseUserWithBackend(firebaseUserCredential.user, 'google')
    } catch (err: any) {
      console.error('[Auth] Native Google Sign In error:', err)

      if (err.code === 'SIGN_IN_CANCELLED') {
        throw new Error('Bạn đã hủy đăng nhập')
      }
      if (err.code === 'IN_PROGRESS') {
        throw new Error('Đang đăng nhập...')
      }
      if (err.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
        throw new Error('Google Play Services không khả dụng')
      }

      throw new Error(err.message || 'Đăng nhập Google thất bại')
    }
  }
}

// Facebook Sign In
export async function loginWithFacebook() {
  console.log('[Auth] Starting Facebook Sign In, Platform:', Platform.OS)

  if (Platform.OS === 'web') {
    try {
      const provider = new webFacebookAuthProvider()
      provider.addScope('email')
      provider.addScope('public_profile')
      const result = await webSignInWithPopup(webAuth, provider)
      await setSecureItem(AUTH_METHOD_KEY, 'facebook')
      return await syncFirebaseUserWithBackend(result.user, 'facebook')
    } catch (err: any) {
      console.error('[Auth] Web Facebook Sign In error:', err)
      if (err.code === 'auth/popup-closed-by-user') {
        throw new Error('Bạn đã đóng cửa sổ đăng nhập')
      }
      throw new Error(err.message || 'Đăng nhập Facebook thất bại')
    }
  } else {
    // Mobile: use native Facebook Login
    if (!FacebookLogin || !firebaseAuth) {
      throw new Error('Đăng nhập Facebook cần development build. Vui lòng dùng email/password.')
    }

    try {
      const { LoginManager, AccessToken } = FacebookLogin

      // Attempt login with permissions
      const result = await LoginManager.logInWithPermissions(['public_profile', 'email'])

      if (result.isCancelled) {
        throw new Error('Bạn đã hủy đăng nhập')
      }

      // Get access token
      const data = await AccessToken.getCurrentAccessToken()
      if (!data) {
        throw new Error('Không lấy được token truy cập Facebook')
      }

      // Sign in to Firebase with the Facebook credential
      const facebookCredential = firebaseAuth.FacebookAuthProvider.credential(data.accessToken)
      const firebaseUserCredential = await firebaseAuth().signInWithCredential(facebookCredential)

      await setSecureItem(AUTH_METHOD_KEY, 'facebook')
      return await syncFirebaseUserWithBackend(firebaseUserCredential.user, 'facebook')
    } catch (err: any) {
      console.error('[Auth] Native Facebook Sign In error:', err)
      throw new Error(err.message || 'Đăng nhập Facebook thất bại')
    }
  }
}

// Register with backend API
export async function register(name: string, email: string, password: string) {
  return apiRegister(name, email, password)
}

// Logout
export async function logout() {
  try {
    if (Platform.OS === 'web') {
      const { firebaseSignOut } = await import('./firebase')
      await firebaseSignOut()
    } else if (GoogleSignin) {
      await GoogleSignin.signOut()
      if (firebaseAuth) {
        await firebaseAuth().signOut()
      }
    }
  } catch (e) {
    console.log('[Auth] Logout error:', e)
  }
  await removeToken()
  await removeUser()
  await deleteSecureItem(AUTH_METHOD_KEY)
}

// Check if user is logged in
export async function isLoggedIn(): Promise<boolean> {
  const token = await getToken()
  return !!token
}

export default {
  saveToken,
  getToken,
  removeToken,
  login,
  loginWithGoogle,
  loginWithFacebook,
  register,
  logout,
  isLoggedIn
}
