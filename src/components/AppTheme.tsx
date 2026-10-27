import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppColors, AppMode, darkColors, lightColors, ReaderPreset, readerThemes } from '../theme'

export type AppearancePreference = 'system' | AppMode
export type ReaderLineSpacing = 1.6 | 1.75 | 2
type Settings = { appearance: AppearancePreference; reader: ReaderPreset; readerFontSize: number; readerLineSpacing: ReaderLineSpacing }
const STORAGE_KEY = 'reader_appearance_v1'
const defaults: Settings = { appearance: 'system', reader: 'day', readerFontSize: 18, readerLineSpacing: 1.75 }

type ThemeContextValue = {
  colors: AppColors
  mode: AppMode
  preference: AppearancePreference
  setPreference: (preference: AppearancePreference) => void
  readerPreset: ReaderPreset
  setReaderPreset: (preset: ReaderPreset) => void
  readerFontSize: number
  setReaderFontSize: (size: number) => void
  readerLineSpacing: ReaderLineSpacing
  setReaderLineSpacing: (spacing: ReaderLineSpacing) => void
}
const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors, mode: 'light', preference: 'system', setPreference: () => {},
  readerPreset: 'day', setReaderPreset: () => {}, readerFontSize: 18, setReaderFontSize: () => {},
  readerLineSpacing: 1.75, setReaderLineSpacing: () => {},
})

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme()
  const [settings, setSettings] = useState<Settings>(defaults)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!active || !raw) return
      try {
        const saved = JSON.parse(raw)
        setSettings({
          appearance: ['light', 'dark', 'system'].includes(saved.appearance) ? saved.appearance : defaults.appearance,
          reader: Object.prototype.hasOwnProperty.call(readerThemes, saved.reader) ? saved.reader : defaults.reader,
          readerFontSize: Number.isFinite(Number(saved.readerFontSize)) ? Math.max(14, Math.min(28, Number(saved.readerFontSize))) : defaults.readerFontSize,
          readerLineSpacing: [1.6, 1.75, 2].includes(Number(saved.readerLineSpacing)) ? Number(saved.readerLineSpacing) as ReaderLineSpacing : defaults.readerLineSpacing,
        })
      } catch { /* Ignore older or invalid preferences. */ }
    }).catch(() => {}).finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {})
  }, [settings, loaded])

  const mode: AppMode = settings.appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : settings.appearance
  const value = useMemo<ThemeContextValue>(() => ({
    colors: mode === 'dark' ? darkColors : lightColors,
    mode,
    preference: settings.appearance,
    setPreference: appearance => setSettings(previous => ({ ...previous, appearance })),
    readerPreset: settings.reader,
    setReaderPreset: reader => setSettings(previous => ({ ...previous, reader })),
    readerFontSize: settings.readerFontSize,
    setReaderFontSize: size => setSettings(previous => ({ ...previous, readerFontSize: Math.max(14, Math.min(28, Math.round(size))) })),
    readerLineSpacing: settings.readerLineSpacing,
    setReaderLineSpacing: spacing => setSettings(previous => ({ ...previous, readerLineSpacing: spacing })),
  }), [mode, settings])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme() { return useContext(ThemeContext) }

export function useThemeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors: AppColors) => T) {
  const theme = useAppTheme()
  const styles = useMemo(() => factory(theme.colors), [factory, theme.colors])
  return { ...theme, styles }
}
