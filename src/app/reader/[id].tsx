import React, { useMemo, useState, useEffect, useRef } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Animated, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetchChapterByNumber, apiFetchBook, apiFetchChapters } from '../../lib/api'
import { nextFabVisible } from '../../lib/readerAgentScroll'
import { saveReadingProgress, getReadingProgress } from '../../lib/reading'
import ReaderAgentSheet from '../../components/ReaderAgentSheet'
import * as Auth from '../../lib/auth'
import { shouldShowAds } from '../../lib/ads'
import AdInterstitial from '../../components/AdInterstitial'
import { getOfflineChapter } from '../../lib/offline'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { AppColors, ReaderPreset, readerThemes } from '../../theme'
import { useThemeStyles } from '../../components/AppTheme'
import { noteSuccessfulChapterRead } from '../../lib/pushNotifications'

function translateErrorMessage(msg: any): string | null {
  const text = msg ? String(msg) : ''
  if (!text) return null
  const guest = text.match(/guests can read (\d+) chapters per day/i)
  if (guest) {
    return `Khách chỉ được đọc ${guest[1]} chương mỗi ngày. Vui lòng đăng nhập để đọc thêm.`
  }
  if (/daily limit of \d+ chapters/i.test(text)) {
    return 'Bạn đã đọc đủ 10 chương trong hôm nay. Hãy quay lại vào ngày mai hoặc nâng VIP.'
  }
  return text
}

function cleanChapterHtml(raw: any): string[] {
  if (!raw) return []
  let text = String(raw)
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<div class=["']ads-holder["'][\s\S]*?<\/div>/gi, '')
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&hellip;/gi, '...')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export default function ReaderScreen() {
  const {
    colors, styles, readerPreset: theme, setReaderPreset: setTheme,
    readerFontSize: fontSize, setReaderFontSize: setFontSize,
    readerLineSpacing, setReaderLineSpacing,
  } = useThemeStyles(createStyles)
  const { id, ch, recap } = useLocalSearchParams<{ id: string; ch?: string; recap?: string }>();
  const router = useRouter();
  const chapterIndex = Math.max(1, Number(ch ?? 1));

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevChapterRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const contentHeightRef = useRef(0);
  const viewHeightRef = useRef(0);
  const restorePctRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaRef = useRef<{ title?: string; cover?: string; genre?: string; chapterId?: string }>({});

  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)

  const [bookTitle, setBookTitle] = useState<string | null>(null)

  const [content, setContent] = useState<string[]>([])
  const [chapterTitle, setChapterTitle] = useState('')
  const [chaptersTotal, setChaptersTotal] = useState<number | null>(null)
  const [availableChapterNumbers, setAvailableChapterNumbers] = useState<number[]>([])
  const updateChapterNumbers = (rows: any[]) => {
    setChaptersTotal(rows.length)
    setAvailableChapterNumbers(rows.map((c, i) => Number(c.chapter_no || c.chapterNo || i + 1)).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b))
  }
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [readerAdVisible, setReaderAdVisible] = useState(false)
  const pendingReadRef = useRef<null | (() => Promise<void>)>(null)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  const finishReaderAd = async () => {
    setReaderAdVisible(false)
    const run = pendingReadRef.current
    pendingReadRef.current = null
    if (run) await run()
  }
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [agentOpen, setAgentOpen] = useState(false)
  useEffect(() => {
    if (String(recap || '') !== '1') return
    setAgentOpen(true)
  }, [recap, id, chapterIndex])
  const [fabVisible, setFabVisible] = useState(true)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [readPct, setReadPct] = useState(0)
  const lastScrollY = useRef(0)
  const fabVisibleRef = useRef(true)

  useEffect(() => {
    let active = true
    setUserLoaded(false)
    Auth.getUser().then(u => {
      if (!active) return
      setUser(u)
      setUserLoaded(true)
    })
    return () => { active = false }
  }, [])

  const tryRestoreScroll = () => {
    if (restoredRef.current) return
    const pct = restorePctRef.current
    if (pct == null || pct <= 0) return
    const max = contentHeightRef.current - viewHeightRef.current
    if (max <= 0) return
    restoredRef.current = true
    const y = Math.max(0, (pct / 100) * max)
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false })
    })
  }

  const persistOpenedChapter = async (opts: { chapterId?: string; title?: string; cover?: any; genre?: any; chapterNo?: number }) => {
    if (!id) return
    const chapterNo = Number(opts.chapterNo || chapterIndex) || chapterIndex
    metaRef.current = {
      title: opts.title ? String(opts.title) : metaRef.current.title,
      cover: opts.cover ? String(opts.cover) : metaRef.current.cover,
      genre: opts.genre ? String(opts.genre) : metaRef.current.genre,
      chapterId: opts.chapterId ? String(opts.chapterId) : metaRef.current.chapterId,
    }
    try {
      const existing = await getReadingProgress(String(id))
      const sameChapter = existing && Number(existing.chapterNo) === chapterNo
      const pct = sameChapter && existing && existing.progressPct != null ? Number(existing.progressPct) : 0
      restorePctRef.current = sameChapter && pct > 0 ? pct : null
      restoredRef.current = false
      await saveReadingProgress({
        bookId: String(id),
        chapter: metaRef.current.chapterId || String(chapterNo),
        chapterNo,
        title: metaRef.current.title,
        cover: metaRef.current.cover,
        genre: metaRef.current.genre,
        progressPct: pct,
      })
      tryRestoreScroll()
    } catch (e) {
      // ignore
    }
  }

  const handleReaderScroll = (y: number) => {
    const nextVisible = nextFabVisible(lastScrollY.current, y, fabVisibleRef.current)
    lastScrollY.current = y
    if (nextVisible !== fabVisibleRef.current) {
      fabVisibleRef.current = nextVisible
      setFabVisible(nextVisible)
    }
    const max = contentHeightRef.current - viewHeightRef.current
    if (!id || max <= 0) return
    const pct = Math.max(0, Math.min(100, (y / max) * 100))
    setReadPct(pct)
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      saveReadingProgress({
        bookId: String(id),
        chapter: metaRef.current.chapterId || String(chapterIndex),
        chapterNo: chapterIndex,
        title: metaRef.current.title || bookTitle || undefined,
        cover: metaRef.current.cover,
        genre: metaRef.current.genre,
        progressPct: pct,
      }).catch(() => {})
    }, 800)
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!id) return
      setReaderAdVisible(false)
      pendingReadRef.current = null
      restorePctRef.current = null
      restoredRef.current = false
      contentHeightRef.current = 0
      setIsLoading(true)
      setChapterTitle('')

      // Animate slide based on direction
      const previousChapter = prevChapterRef.current;
      if (previousChapter !== 0 && previousChapter !== chapterIndex) {
        const isForward = chapterIndex > previousChapter;
        const startValue = isForward ? 400 : -400;
        
        fadeAnim.setValue(0);
        slideAnim.setValue(startValue);
        
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          })
        ]).start();
      } else {
        slideAnim.setValue(0);
        fadeAnim.setValue(1);
      }
      prevChapterRef.current = chapterIndex;

      // OFFLINE first: if downloaded, read from local file.
      try {
        const offline = await getOfflineChapter(String(id), chapterIndex)
        if (offline && offline.content) {
          if (!mounted) return
          setErrorMsg(null)
          if (offline.bookTitle) setBookTitle(String(offline.bookTitle))
          setChapterTitle(String(offline.title || `Chương ${chapterIndex}`))
          const paras = chapterParagraphs(offline.content, true)
          setContent(paras.length ? paras : [String(offline.content)])
          if (typeof offline.chaptersTotal === 'number') setChaptersTotal(offline.chaptersTotal)
          if (Array.isArray(offline.chapterNumbers)) setAvailableChapterNumbers(offline.chapterNumbers)
          setIsLoading(false)
          void noteSuccessfulChapterRead()
          await persistOpenedChapter({
            chapterId: String(chapterIndex),
            title: offline.bookTitle,
            cover: offline.cover,
            genre: offline.genre,
            chapterNo: chapterIndex,
          })
          return
        }
      } catch {
        // ignore offline errors and continue to online
      }

      const revealChapter = async (paras: string[], title: string, adRequired: boolean, persist: () => Promise<void>) => {
        if (!mounted) return
        const account = await Auth.getUser()
        if (adRequired && shouldShowAds(account)) {
          setContent([])
          setChapterTitle(title)
          setErrorMsg(null)
          setIsLoading(false)
          pendingReadRef.current = async () => {
            if (!aliveRef.current) return
            setContent(paras)
            void noteSuccessfulChapterRead()
            await persist()
          }
          setReaderAdVisible(true)
          return
        }
        setErrorMsg(null)
        setChapterTitle(title)
        setContent(paras)
        setIsLoading(false)
        void noteSuccessfulChapterRead()
        await persist()
      }

      try {
        const token = await Auth.getToken()
        const res: any = await apiFetchChapterByNumber(String(id), chapterIndex, token || undefined)
        if (!mounted) return
        if (res && !res.error) {
          // server may return { id, title, content }
          setErrorMsg(null)
          const text = typeof res.content === 'string' ? res.content : (res.body || res.text || '')
          if (text) {
            const paras = chapterParagraphs(text, res.content_format === 'plain_text')
            const shown = paras.length ? paras : [text]
            let bookTitleValue: string | undefined
            let cover: string | undefined
            let genre: any
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              bookTitleValue = bookRes && (bookRes.title || bookRes.name) ? String(bookRes.title || bookRes.name) : undefined
              if (bookTitleValue) setBookTitle(bookTitleValue)
              if (Array.isArray(bookRes.chapters)) updateChapterNumbers(bookRes.chapters)
              cover = bookRes && bookRes.cover_url ? String(bookRes.cover_url) : undefined
              genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
            } catch (e) { /* book meta is optional */ }
            await revealChapter(
              shown,
              String(res.title || `Chương ${res.chapter_no || chapterIndex}`),
              !!res.ad_required,
              async () => {
                await persistOpenedChapter({
                  chapterId: String(res.id || res.chapter_id || chapterIndex),
                  title: bookTitleValue,
                  cover,
                  genre,
                  chapterNo: Number(res.chapter_no || chapterIndex),
                })
              },
            )
            return
          }
        }
        // if server returned an error payload, surface it
        if (res && res.error) {
          setContent([])
          setErrorMsg(translateErrorMessage(res.message || res.detail || String(res.error)))
          setIsLoading(false)
          return
        }
      } catch (e) {
        console.error('fetch chapter err', e)
      }
      // fallback A: try fetching chapters list and use chapter content if available
      try {
        const token = await Auth.getToken()
        const chaptersRes: any = await apiFetchChapters(String(id), token || undefined)
        if (chaptersRes && !chaptersRes.error && Array.isArray(chaptersRes) && chaptersRes.length) {
          // store total
          updateChapterNumbers(chaptersRes)
          const chObj = chaptersRes.find((c:any, i:number) => Number(c.chapter_no || c.chapterNo || i + 1) === chapterIndex)
          const text = chObj && (chObj.content || chObj.body || chObj.text)
          if (text && mounted) {
            setChapterTitle(String(chObj.title || `Chương ${chObj.chapter_no || chapterIndex}`))
            const paras = chapterParagraphs(text, chObj.content_format === 'plain_text')
            setContent(paras.length ? paras : [String(text)])
            setIsLoading(false)
            void noteSuccessfulChapterRead()
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
              if (title) setBookTitle(String(title))
              const cover = bookRes && bookRes.cover_url ? String(bookRes.cover_url) : undefined
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await persistOpenedChapter({
                chapterId: String(chObj && (chObj.id || chObj.chapter_id) || chapterIndex),
                title,
                cover,
                genre,
                chapterNo: Number((chObj && (chObj.chapter_no || chObj.chapterNo)) || chapterIndex),
              })
            } catch (e) {
              await persistOpenedChapter({ chapterId: String(chObj && (chObj.id || chObj.chapter_id) || chapterIndex) })
            }
            return
          }
        }
      } catch (eee) {
        console.error('fallback fetch chapters err', eee)
      }

      // fallback B: try fetching the whole book and read chapter content from book.chapters (file-mode)
      try {
        const token = await Auth.getToken()
        const bookRes: any = await apiFetchBook(String(id), token || undefined)
        if (bookRes && !bookRes.error) {
          const title = bookRes && (bookRes.title || bookRes.name)
          if (title) setBookTitle(String(title))
          // Always store total chapters so UI can hide "next" on last chapter
          if (Array.isArray(bookRes.chapters)) updateChapterNumbers(bookRes.chapters)
          const chObj = Array.isArray(bookRes.chapters) ? bookRes.chapters.find((c:any, i:number) => Number(c.chapter_no || c.chapterNo || i + 1) === chapterIndex) : null
          const text = chObj && (chObj.content || chObj.body || chObj.text)
          if (text && mounted) {
            setChapterTitle(String(chObj.title || `Chương ${chObj.chapter_no || chapterIndex}`))
            const paras = chapterParagraphs(text, chObj.content_format === 'plain_text')
            setContent(paras.length ? paras : [String(text)])
            setIsLoading(false)
            void noteSuccessfulChapterRead()
            try {
              const cover = bookRes && bookRes.cover_url ? String(bookRes.cover_url) : undefined
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await persistOpenedChapter({
                chapterId: String(chObj && (chObj.id || chObj.chapter_id) || chapterIndex),
                title,
                cover,
                genre,
              })
            } catch (e) {
              await persistOpenedChapter({ chapterId: String(chObj && (chObj.id || chapterIndex)) })
            }
            return
          }
        }
      } catch (ee) {
        console.error('fallback fetch book err', ee)
      }

      if (mounted) {
        setContent([])
        setErrorMsg('Không tải được nội dung chương này.')
        setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    }
  }, [id, chapterIndex])

  const themeStyle = getTheme(theme);

  const nextNumber = availableChapterNumbers.length ? availableChapterNumbers.find(n => n > chapterIndex) : chapterIndex + 1
  const prevNumber = availableChapterNumbers.length ? [...availableChapterNumbers].reverse().find(n => n < chapterIndex) : chapterIndex - 1
  const nextCh = String(nextNumber);
  const prevCh = String(prevNumber);
  const hasPrev = prevNumber != null && prevNumber > 0;
  // Only show next button if we know there are more chapters
  const hasNext = availableChapterNumbers.length ? nextNumber != null : chaptersTotal != null && chapterIndex < chaptersTotal;

  const handlePrev = () => {
    if (!hasPrev) return;
    router.replace({ pathname: "/reader/[id]", params: { id: id ?? "1", ch: prevCh } } as any);
  };

  const handleNext = () => {
    if (!hasNext) return;
    router.replace({ pathname: "/reader/[id]", params: { id: id ?? "1", ch: nextCh } } as any);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeStyle.bg }]} edges={chromeVisible ? ['top', 'bottom'] : []}>
      <StatusBar hidden={!chromeVisible} barStyle={theme === 'night' || theme === 'oled' ? 'light-content' : 'dark-content'} />
      {chromeVisible ? (
      <View style={[styles.header, { backgroundColor: themeStyle.headerBg, borderBottomColor: themeStyle.border }]}> 
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: themeStyle.btnBg }]}>
          <Ionicons name="chevron-back" size={22} color={themeStyle.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: themeStyle.text }]} numberOfLines={1}>{bookTitle || `Truyện #${id}`}</Text>
          <Text style={{ color: themeStyle.meta, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{chapterTitle || `Chương ${chapterIndex}`}{chaptersTotal ? ` · ${chaptersTotal} chương có thể đọc` : ''}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setFontSize(fontSize - 1)} style={[styles.iconBtn, { backgroundColor: themeStyle.btnBg }]}>
            <Text style={{ color: themeStyle.text, fontWeight: '800' }}>A-</Text>
          </Pressable>
          <Pressable onPress={() => setFontSize(fontSize + 1)} style={[styles.iconBtn, { backgroundColor: themeStyle.btnBg }]}>
            <Text style={{ color: themeStyle.text, fontWeight: '800' }}>A+</Text>
          </Pressable>
        </View>
      </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={200}
        onLayout={(e) => {
          viewHeightRef.current = e.nativeEvent.layout.height
          tryRestoreScroll()
        }}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h
          tryRestoreScroll()
        }}
        onScroll={(e) => handleReaderScroll(e.nativeEvent.contentOffset.y)}
      >
        {isLoading ? (
          <View style={[styles.readerCard, { backgroundColor: themeStyle.cardBg, borderColor: themeStyle.border }]}>
            <SkeletonLoader width="80%" height={24} style={{ marginBottom: 20 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="95%" height={16} style={{ marginBottom: 20 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="88%" height={16} style={{ marginBottom: 20 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="100%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonLoader width="92%" height={16} />
          </View>
        ) : (
          <Pressable onPress={() => setChromeVisible((v) => !v)}>
          <Animated.View style={[styles.readerCard, { 
            backgroundColor: themeStyle.cardBg, 
            borderColor: themeStyle.border, 
            transform: [{ translateX: slideAnim }],
            opacity: fadeAnim
          }]}>
            <Text style={[styles.bookTitle, { color: themeStyle.text }]}>{chapterTitle || `Chương ${chapterIndex}`}</Text>
            {errorMsg ? (
              <Text style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * readerLineSpacing, marginTop: 12 }}>{errorMsg}</Text>
            ) : (
              content.map((p, idx) => (
                <Text key={idx} style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * readerLineSpacing, marginTop: idx === 0 ? 8 : 16 }}>
                  {p}
                </Text>
              ))
            )}
          </Animated.View>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.progressWrap}>
        <View style={[styles.progressFill, { width: `${readPct}%`, backgroundColor: colors.accent }]} />
      </View>

      {chromeVisible ? (
      <View style={[styles.bottomBar, { backgroundColor: themeStyle.headerBg, borderTopColor: themeStyle.border }]}> 
        <View style={styles.themeRow}>
          {(Object.keys(readerThemes) as ReaderPreset[]).map(preset => (
            <Pressable key={preset} accessibilityRole="button" accessibilityState={{ selected: theme === preset }} onPress={() => setTheme(preset)}
              style={[styles.themeChip, { backgroundColor: readerThemes[preset].bg, borderColor: theme === preset ? colors.accent : themeStyle.border }]}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: readerThemes[preset].text }} />
              <Text style={[styles.themeText, { color: readerThemes[preset].text, fontWeight: theme === preset ? '700' : '500' }]}>{readerThemes[preset].label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.lineSpacingRow}>
          <Text style={[styles.lineSpacingLabel, { color: themeStyle.meta }]}>Giãn dòng</Text>
          {([1.6, 1.75, 2] as const).map(spacing => (
            <Pressable key={spacing} accessibilityRole="button" accessibilityState={{ selected: readerLineSpacing === spacing }} onPress={() => setReaderLineSpacing(spacing)}
              style={[styles.spacingChip, { backgroundColor: themeStyle.btnBg, borderColor: readerLineSpacing === spacing ? colors.accent : themeStyle.border }]}>
              <Text style={[styles.spacingText, { color: themeStyle.text, fontWeight: readerLineSpacing === spacing ? '800' : '500' }]}>{spacing.toFixed(2).replace(/0$/, '')}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.navRow}>
          {hasPrev ? (
            <Pressable style={[styles.navBtn, { backgroundColor: themeStyle.btnBg, borderColor: themeStyle.border }]} onPress={handlePrev}>
              <Text style={[styles.navText, { color: themeStyle.text }]}>Chương trước</Text>
            </Pressable>
          ) : (
            <View style={styles.navBtnPlaceholder} />
          )}

          {hasNext ? (
            <Pressable style={[styles.navBtn, styles.navBtnPrimary]} onPress={handleNext}>
              <Text style={[styles.navText, styles.navTextPrimary]}>Chương tiếp</Text>
            </Pressable>
          ) : (
            <View style={styles.navBtnPlaceholder} />
          )}
        </View>
      </View>
      ) : null}

      <Pressable
        onPress={() => setAgentOpen(true)}
        style={[styles.fab, !fabVisible && styles.fabHidden]}
        pointerEvents={fabVisible ? 'auto' : 'none'}
      >
        <Ionicons name="sparkles" size={22} color={colors.onAccent} />
      </Pressable>
      <ReaderAgentSheet
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        bookId={String(id || '')}
        chapterNo={chapterIndex}
        bookTitle={bookTitle}
        autoRecap={String(recap || '') === '1'}
      />
      <AdInterstitial visible={readerAdVisible} placement="reader" onFinish={() => { void finishReaderAd() }} />

    </SafeAreaView>
  );
}

function chapterParagraphs(raw: any, isPlainText: boolean): string[] {
  if (isPlainText) {
    const text = String(raw || '').replace(/\r\n?/g, '\n')
    return text.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean)
  }
  return cleanChapterHtml(raw)
}

function getTheme(t: ReaderPreset) {
  const preset = readerThemes[t]
  return { bg: preset.bg, headerBg: preset.overlay, cardBg: preset.bg, text: preset.text, meta: preset.meta, btnBg: preset.control, border: preset.border }
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginRight: 12 },
  headerTitle: { fontSize: 16, fontWeight: "800", flex: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },

  scroll: { padding: 16, paddingBottom: 120 },
  readerCard: { borderWidth: 0, borderRadius: 0, padding: 8 },
  bookTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  progressWrap: { height: 3, backgroundColor: 'rgba(148,163,184,0.35)' },
  progressFill: { height: '100%' },

  bottomBar: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  themeRow: { flexDirection: "row", justifyContent: "center", alignItems: 'center', gap: 6 },
  lineSpacingRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6 },
  lineSpacingLabel: { fontSize: 12, fontWeight: '600', marginRight: 2 },
  spacingChip: { minWidth: 48, minHeight: 32, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  spacingText: { fontSize: 12 },
  themeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  themeChipActive: { backgroundColor: "#1088ff22" },
  themeText: { fontSize: 12, color: "#374151" },
  themeTextActive: { color: "#1088ff", fontWeight: "700" },

  navRow: { flexDirection: "row", marginTop: 10, alignItems: 'center' },
  navBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e5e7eb", marginHorizontal: 5, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "#cbd5e1", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  navBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accentDark },
  navBtnPlaceholder: { flex: 1, marginHorizontal: 5 },
  navText: { color: "#0f172a", fontWeight: "800", fontSize: 14, letterSpacing: 0.1 },
  navTextPrimary: { color: colors.onAccent },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 188,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabHidden: { opacity: 0 },
});
