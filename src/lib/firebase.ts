// Firebase configuration for Reader App
import { initializeApp, getApps, getApp } from 'firebase/app'
import {
    getAuth,
    signInWithCredential,
    GoogleAuthProvider,
    FacebookAuthProvider,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    User
} from 'firebase/auth'

// Firebase config from google-services.json
const firebaseConfig = {
    apiKey: "AIzaSyBFjdHM34hzfSfrKw66eJjHc8ucds0xAwE",
    authDomain: "newsai-793dc.firebaseapp.com",
    projectId: "newsai-793dc",
    storageBucket: "newsai-793dc.firebasestorage.app",
    messagingSenderId: "220903784873",
    appId: "1:220903784873:android:bbbbdaa24c8268f4c784b8"
}

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
const auth = getAuth(app)

// Google OAuth Client IDs
export const GOOGLE_WEB_CLIENT_ID = "220903784873-rn1gdgqifur44r8am7a0h8mb0meh11v5.apps.googleusercontent.com"
export const GOOGLE_ANDROID_CLIENT_ID = "220903784873-e97pe3tvjpab7cd8r3acg3fipe7e1412.apps.googleusercontent.com"

// Sign in with email/password
export async function firebaseLoginWithEmail(email: string, password: string) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password)
    return userCredential.user
}

// Register with email/password
export async function firebaseRegisterWithEmail(email: string, password: string) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password)
    return userCredential.user
}

// Sign in with Google credential (from expo-auth-session)
export async function firebaseLoginWithGoogle(idToken: string) {
    const credential = GoogleAuthProvider.credential(idToken)
    const userCredential = await signInWithCredential(auth, credential)
    return userCredential.user
}

// Sign in with Facebook credential
export async function firebaseLoginWithFacebook(accessToken: string) {
    const credential = FacebookAuthProvider.credential(accessToken)
    const userCredential = await signInWithCredential(auth, credential)
    return userCredential.user
}

// Sign out
export async function firebaseSignOut() {
    return signOut(auth)
}

// Get current user
export function getCurrentUser(): User | null {
    return auth.currentUser
}

// Get ID token for backend authentication
export async function getFirebaseIdToken(): Promise<string | null> {
    const user = auth.currentUser
    if (!user) return null
    return user.getIdToken()
}

// Listen to auth state changes
export function onAuthChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback)
}

export { auth, app }
