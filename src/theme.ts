export const brand = {
  primary: '#F97316',
  primaryHover: '#EA580C',
  secondary: '#0D9488',
  vip: '#EAB308',
  vipSurface: '#FEF3C7',
}

export const appTokens = {
  light: {
    canvas: '#F8F9FA', surface: '#FFFFFF', surfaceSubtle: '#F1F3F5',
    textPrimary: '#1A1D20', textSecondary: '#59636E', textTertiary: '#8C95A0',
    borderSubtle: '#E9ECEF', borderStrong: '#CED4DA',
  },
  dark: {
    canvas: '#0F1115', surface: '#181B20', surfaceSubtle: '#22262E',
    textPrimary: '#ECEFF4', textSecondary: '#9AA0A6', textTertiary: '#636C76',
    borderSubtle: '#262B33', borderStrong: '#39414D',
  },
}

export const semantic = {
  success: '#16A34A', warning: '#D97706', danger: '#DC2626', info: '#2563EB',
  highlight: '#FEF08A', highlightDark: '#713F12',
}

export const readerThemes = {
  day: { label: 'Sáng', bg: '#F7F8FA', text: '#24292F', meta: '#6E7781', overlay: 'rgba(247, 248, 250, 0.94)', control: '#E9ECEF', border: '#CED4DA' },
  sepia: { label: 'Giấy', bg: '#F5EEDC', text: '#40301F', meta: '#806E5E', overlay: 'rgba(245, 238, 220, 0.94)', control: '#EBDFC7', border: '#D8CBB2' },
  night: { label: 'Tối', bg: '#14171A', text: '#BAC2CB', meta: '#68737D', overlay: 'rgba(20, 23, 26, 0.92)', control: '#22262E', border: '#39414D' },
  oled: { label: 'OLED', bg: '#000000', text: '#9DA7B3', meta: '#545D68', overlay: 'rgba(0, 0, 0, 0.94)', control: '#14171A', border: '#262B33' },
}
export type ReaderPreset = keyof typeof readerThemes
export type AppMode = keyof typeof appTokens

function palette(mode: AppMode) {
  const t = appTokens[mode]
  const dark = mode === 'dark'
  return {
  bg: t.canvas,
  surface: t.surface,
  surfaceSubtle: t.surfaceSubtle,
  text: t.textPrimary,
  textSecondary: t.textSecondary,
  textMuted: t.textTertiary,
  accent: brand.primary,
  accentDark: brand.primaryHover,
  accentLight: '#FB923C',
  accentSoft: dark ? '#382317' : '#FFF1E8',
  accentText: dark ? '#FDBA74' : '#C2410C',
  onAccent: '#1A1D20',
  secondary: brand.secondary,
  secondaryText: dark ? '#5EEAD4' : '#0F766E',
  secondarySoft: dark ? '#133330' : '#E7F5F2',
  onSecondary: '#03201C',
  onDark: '#FFFFFF',
  onVip: '#40301F',
  inputBorder: t.borderStrong,
  info: semantic.info,
  infoSoft: dark ? '#172B4D' : '#EFF6FF',
  purple: '#7C3AED',
  purpleSoft: dark ? '#2D2047' : '#F5F3FF',
  orange: '#EA580C',
  orangeSoft: dark ? '#382317' : '#FFF7ED',
  border: t.borderStrong,
  borderLight: t.borderSubtle,
  danger: dark ? '#F87171' : semantic.danger,
  dangerSoft: dark ? '#3D1D21' : '#FEE2E2',
  dangerText: dark ? '#FCA5A5' : '#B91C1C',
  gold: brand.vip,
  goldSoft: dark ? '#3D3217' : brand.vipSurface,
  silver: '#94A3B8',
  silverSoft: t.surfaceSubtle,
  bronze: '#D97706',
  bronzeSoft: dark ? '#382317' : '#FFEDD5',
  coverBg: t.borderSubtle,
  success: dark ? '#4ADE80' : semantic.success,
  successSoft: dark ? '#193325' : '#ECFDF5',
  successText: dark ? '#86EFAC' : '#166534',
  warning: dark ? '#FBBF24' : semantic.warning,
  warningSoft: dark ? '#3D3217' : '#FEF3C7',
  warningText: dark ? '#FCD34D' : '#92400E',
  highlight: dark ? semantic.highlightDark : semantic.highlight,
  shadow: '#1A1D20',
  heroGlow: dark ? '#382317' : '#FBE9D9',
  }
}

export const lightColors = palette('light')
export const darkColors = palette('dark')
export const colors = lightColors
export type AppColors = typeof lightColors

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  '2xl': 28,
  full: 9999,
}

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
}

export const cardShadow = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 2,
}

export const cardShadowSm = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 5,
  elevation: 1,
}

export const cardShadowLg = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.08,
  shadowRadius: 20,
  elevation: 5,
}

export const GENRES = [
  'Tất cả',
  'Ngôn tình',
  'Hiện đại',
  'Cổ đại',
  'Huyền huyễn',
  'Xuyên không',
  'Đam mỹ',
] as const

export type Genre = (typeof GENRES)[number]
