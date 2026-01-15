import React, { useMemo, useState, useEffect, useRef } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Animated, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { apiFetchChapter, apiFetchBook, apiFetchChapters } from '../../lib/api'
import { saveReadingProgress } from '../../lib/reading'
import * as Auth from '../../lib/auth'
import { shouldShowAds } from '../../lib/ads'
import { getOfflineChapter } from '../../lib/offline'
import { SkeletonLoader } from '../../components/SkeletonLoader'

function translateErrorMessage(msg: any): string | null {
  const text = msg ? String(msg) : ''
  if (!text) return null
  if (text.toLowerCase().includes('guests can read 3 chapters per day')) {
    return 'Khách chỉ được đọc 3 chương mỗi ngày. Vui lòng đăng nhập để đọc thêm.'
  }
  return text
}

export default function ReaderScreen() {
  const { id, ch } = useLocalSearchParams<{ id: string; ch?: string }>();
  const router = useRouter();
  const chapterIndex = Math.max(1, Number(ch ?? 1));

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevChapterRef = useRef(0);

  const [user, setUser] = useState<any | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)

  const [bookTitle, setBookTitle] = useState<string | null>(null)

  const [fontSize, setFontSize] = useState(16);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");

  const [content, setContent] = useState<string[]>([])
  const [chaptersTotal, setChaptersTotal] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

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

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!id) return
      
      setIsLoading(true)

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
          const offlineTitle = offline.title || offline.name || offline.bookTitle
          if (offlineTitle) setBookTitle(String(offlineTitle))
          const text = offline.content
          const paras = String(text).split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean)
          setContent(paras.length ? paras : [String(text)])
          if (typeof offline.chaptersTotal === 'number') setChaptersTotal(offline.chaptersTotal)
          setIsLoading(false)
          // Save progress (best-effort)
          try {
            await saveReadingProgress({ bookId: String(id), chapter: String(chapterIndex), chapterNo: chapterIndex })
          } catch {}
          return
        }
      } catch {
        // ignore offline errors and continue to online
      }

      try {
        const token = await Auth.getToken()
        const res: any = await apiFetchChapter(String(id), String(chapterIndex), token || undefined)
        if (!mounted) return
        if (res && !res.error) {
          // server may return { id, title, content }
          setErrorMsg(null)
          const text = typeof res.content === 'string' ? res.content : (res.body || res.text || '')
          if (text) {
            const paras = text.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean)
            setContent(paras.length ? paras : [text])
            setIsLoading(false)
            // save reading progress (book metadata fetched separately)
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
              if (title) setBookTitle(String(title))
              // Get total chapters from book data
              if (Array.isArray(bookRes.chapters)) {
                setChaptersTotal(bookRes.chapters.length)
              }
              const cover = bookRes && (bookRes.cover_url ? (String(bookRes.cover_url).startsWith('http') ? bookRes.cover_url : `${bookRes.cover_url}`) : null)
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await saveReadingProgress({ bookId: String(id), chapter: String(res.id || chapterIndex), chapterNo: chapterIndex, title, cover, genre })
            } catch (e) {
              // ignore save errors
            }
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
          setChaptersTotal(chaptersRes.length)
          const chObj = chaptersRes[chapterIndex - 1] || chaptersRes.find((c:any) => (c.chapter_no === chapterIndex || Number(c.chapter_no) === chapterIndex || Number(c.chapterNo) === chapterIndex))
          const text = chObj && (chObj.content || chObj.body || chObj.text)
          if (text && mounted) {
            const paras = String(text).split(/\n\s*\n/).map((p:string) => p.trim()).filter(Boolean)
            setContent(paras.length ? paras : [String(text)])
            setIsLoading(false)
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
              if (title) setBookTitle(String(title))
              const cover = bookRes && (bookRes.cover_url ? (String(bookRes.cover_url).startsWith('http') ? bookRes.cover_url : `${bookRes.cover_url}`) : null)
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await saveReadingProgress({ bookId: String(id), chapter: String(chObj && (chObj.id || chObj.chapter_no) || chapterIndex), chapterNo: chapterIndex, title, cover, genre })
            } catch (e) {
              // ignore
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
          if (Array.isArray(bookRes.chapters)) setChaptersTotal(bookRes.chapters.length)
          const idx = chapterIndex - 1
          const chObj = Array.isArray(bookRes.chapters) ? bookRes.chapters[idx] : null
          const text = chObj && (chObj.content || chObj.body || chObj.text)
          if (text && mounted) {
            const paras = String(text).split(/\n\s*\n/).map((p:string) => p.trim()).filter(Boolean)
            setContent(paras.length ? paras : [String(text)])
            setIsLoading(false)
            try {
              const cover = bookRes && (bookRes.cover_url ? (String(bookRes.cover_url).startsWith('http') ? bookRes.cover_url : `${bookRes.cover_url}`) : null)
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await saveReadingProgress({ bookId: String(id), chapter: String(chObj && (chObj.id || chapterIndex)), chapterNo: chapterIndex, title, cover, genre })
            } catch (e) {
              // ignore
            }
            return
          }
        }
      } catch (ee) {
        console.error('fallback fetch book err', ee)
      }

      // final fallback to mock text
      setContent(mockChapterText(chapterIndex))
      setIsLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [id, chapterIndex])

  const themeStyle = getTheme(theme);

  const nextCh = String(chapterIndex + 1);
  const prevCh = String(Math.max(1, chapterIndex - 1));
  const hasPrev = chapterIndex > 1;
  // Only show next button if we know there are more chapters
  const hasNext = chaptersTotal != null && chapterIndex < chaptersTotal;

  const handlePrev = () => {
    if (!hasPrev) return;
    router.replace({ pathname: "/reader/[id]", params: { id: id ?? "1", ch: prevCh } } as any);
  };

  const handleNext = () => {
    if (!hasNext) return;
    router.replace({ pathname: "/reader/[id]", params: { id: id ?? "1", ch: nextCh } } as any);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeStyle.bg }]}> 
      <View style={[styles.header, { backgroundColor: themeStyle.headerBg, borderBottomColor: themeStyle.border }]}> 
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: themeStyle.btnBg }]}>
          <Text style={{ color: themeStyle.text, fontSize: 18, fontWeight: '700' }}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: themeStyle.text }]}>Chương {chapterIndex}</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setFontSize((s) => Math.max(12, s - 1))} style={[styles.iconBtn, { backgroundColor: themeStyle.btnBg }]}>
            <Text style={{ color: themeStyle.text }}>A-</Text>
          </Pressable>
          <Pressable onPress={() => setFontSize((s) => Math.min(24, s + 1))} style={[styles.iconBtn, { backgroundColor: themeStyle.btnBg }]}>
            <Text style={{ color: themeStyle.text }}>A+</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          <Animated.View style={[styles.readerCard, { 
            backgroundColor: themeStyle.cardBg, 
            borderColor: themeStyle.border, 
            transform: [{ translateX: slideAnim }],
            opacity: fadeAnim
          }]}>
            <Text style={[styles.bookTitle, { color: themeStyle.text }]}>{`${bookTitle || `Truyện #${id}`} · Chương ${chapterIndex}`}</Text>
            {errorMsg ? (
              <Text style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * 1.6, marginTop: 12 }}>{errorMsg}</Text>
            ) : (
              content.map((p, idx) => (
                <Text key={idx} style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * 1.6, marginTop: idx === 0 ? 8 : 12 }}>
                  {p}
                </Text>
              ))
            )}
          </Animated.View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { backgroundColor: themeStyle.headerBg, borderTopColor: themeStyle.border }]}> 
        <View style={styles.themeRow}>
          <Pressable onPress={() => setTheme("light")} style={[styles.themeChip, theme === "light" && styles.themeChipActive]}>
            <Text style={[styles.themeText, theme === "light" && styles.themeTextActive]}>Sáng</Text>
          </Pressable>
          <Pressable onPress={() => setTheme("sepia")} style={[styles.themeChip, theme === "sepia" && styles.themeChipActive]}>
            <Text style={[styles.themeText, theme === "sepia" && styles.themeTextActive]}>Sepia</Text>
          </Pressable>
          <Pressable onPress={() => setTheme("dark")} style={[styles.themeChip, theme === "dark" && styles.themeChipActive]}>
            <Text style={[styles.themeText, theme === "dark" && styles.themeTextActive]}>Tối</Text>
          </Pressable>
        </View>

        <View style={styles.navRow}>
          {/* Left button (Prev) */}
          {hasPrev ? (
            <Pressable style={styles.navBtn} onPress={handlePrev}>
              <Text style={styles.navText}>← Chương trước</Text>
            </Pressable>
          ) : (
            <View style={styles.navBtnPlaceholder} />
          )}

          {/* Right button (Next) */}
          {hasNext ? (
            <Pressable style={[styles.navBtn, styles.navBtnPrimary]} onPress={handleNext}>
              <Text style={[styles.navText, styles.navTextPrimary]}>Chương tiếp →</Text>
            </Pressable>
          ) : (
            <View style={styles.navBtnPlaceholder} />
          )}
        </View>
      </View>

    </SafeAreaView>
  );
}

function mockChapterText(chapterIndex: number): string[] {
  return [
    `Đây là nội dung mô phỏng của chương ${chapterIndex}.`,
    "Một buổi chiều yên bình, gió nhẹ thổi qua tán cây.",
    "Nhân vật chính khẽ mỉm cười, tiếp tục hành trình của mình...",
    "Bạn có thể thay thế đoạn này bằng nội dung thật khi có API.",
  ];
}

function getTheme(t: "light" | "sepia" | "dark") {
  switch (t) {
    case "sepia":
      return { bg: "#f7efe1", headerBg: "#f2e7d6", cardBg: "#fff6e8", text: "#4a3428", btnBg: "#eadfcf", border: "#e4d7c6" };
    case "dark":
      return { bg: "#0b1220", headerBg: "#111827", cardBg: "#0f172a", text: "#e5e7eb", btnBg: "#111827", border: "#1f2937" };
    default:
      return { bg: "#f8fafc", headerBg: "#ffffff", cardBg: "#ffffff", text: "#0f172a", btnBg: "#f2f4f7", border: "#e5e7eb" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginRight: 12 },
  headerTitle: { fontSize: 16, fontWeight: "800", flex: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },

  scroll: { padding: 16, paddingBottom: 100 },
  readerCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16 },
  bookTitle: { fontSize: 14, fontWeight: "800" },

  bottomBar: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  themeRow: { flexDirection: "row", justifyContent: "center", alignItems: 'center' },
  themeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#f2f4f7" },
  themeChipActive: { backgroundColor: "#1088ff22" },
  themeText: { fontSize: 12, color: "#374151" },
  themeTextActive: { color: "#1088ff", fontWeight: "700" },

  navRow: { flexDirection: "row", marginTop: 10, alignItems: 'center' },
  navBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e5e7eb", marginHorizontal: 5, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "#cbd5e1", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  navBtnPrimary: { backgroundColor: "#1088ff", borderColor: "#0f73d0" },
  navBtnPlaceholder: { flex: 1, marginHorizontal: 5 },
  navText: { color: "#0f172a", fontWeight: "800", fontSize: 14, letterSpacing: 0.1 },
  navTextPrimary: { color: "#ffffff" },
});
