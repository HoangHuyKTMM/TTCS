import React, { useMemo, useState, useEffect } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams } from "expo-router";
import { apiFetchChapter, apiFetchBook, apiFetchChapters } from '../../lib/api'
import { saveReadingProgress } from '../../lib/reading'
import * as Auth from '../../lib/auth'

export default function ReaderScreen() {
  const { id, ch } = useLocalSearchParams<{ id: string; ch?: string }>();
  const chapterIndex = Math.max(1, Number(ch ?? 1));

  const [fontSize, setFontSize] = useState(16);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");

  const [content, setContent] = useState<string[]>([])
  const [chaptersTotal, setChaptersTotal] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!id) return
      try {
        const token = await Auth.getToken()
        const res: any = await apiFetchChapter(String(id), String(chapterIndex), token || undefined)
        if (!mounted) return
        if (res && !res.error) {
          // server may return { id, title, content }
          setErrorMsg(null)
          const text = typeof res.content === 'string' ? res.content : (res.body || res.text || '')
          if (text) {
            const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
            setContent(paras.length ? paras : [text])
            // save reading progress (book metadata fetched separately)
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
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
          setErrorMsg(res.message || res.detail || String(res.error))
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
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
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
          const idx = chapterIndex - 1
          const chObj = Array.isArray(bookRes.chapters) ? bookRes.chapters[idx] : null
          const text = chObj && (chObj.content || chObj.body || chObj.text)
          if (text && mounted) {
            const paras = String(text).split(/\n\s*\n/).map((p:string) => p.trim()).filter(Boolean)
            setContent(paras.length ? paras : [String(text)])
            try {
              const bookRes: any = await apiFetchBook(String(id), token || undefined)
              const title = bookRes && (bookRes.title || bookRes.name)
              const cover = bookRes && (bookRes.cover_url ? (String(bookRes.cover_url).startsWith('http') ? bookRes.cover_url : `${bookRes.cover_url}`) : null)
              const genre = bookRes && (bookRes.genre || bookRes.category || bookRes.type)
              await saveReadingProgress({ bookId: String(id), chapter: String(chObj && (chObj.id || chapterIndex)), chapterNo: chapterIndex, title, cover, genre })
            } catch (e) {
              // ignore
            }
            return
          }
          // store total chapters so UI can hide "next" on last chap
          if (Array.isArray(bookRes.chapters)) setChaptersTotal(bookRes.chapters.length)
        }
      } catch (ee) {
        console.error('fallback fetch book err', ee)
      }

      // final fallback to mock text
      setContent(mockChapterText(chapterIndex))
    }
    load()
    return () => { mounted = false }
  }, [id, chapterIndex])

  const themeStyle = getTheme(theme);

  const nextCh = String(chapterIndex + 1);
  const prevCh = String(Math.max(1, chapterIndex - 1));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeStyle.bg }]}> 
      <View style={[styles.header, { backgroundColor: themeStyle.headerBg, borderBottomColor: themeStyle.border }]}> 
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
        <View style={[styles.readerCard, { backgroundColor: themeStyle.cardBg, borderColor: themeStyle.border }]}>
          <Text style={[styles.bookTitle, { color: themeStyle.text }]}>Tiểu thuyết #{id}</Text>
          {errorMsg ? (
            <Text style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * 1.6, marginTop: 12 }}>{errorMsg}</Text>
          ) : (
            content.map((p, idx) => (
              <Text key={idx} style={{ color: themeStyle.text, fontSize, lineHeight: fontSize * 1.6, marginTop: idx === 0 ? 8 : 12 }}>
                {p}
              </Text>
            ))
          )}
        </View>
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
          {/* Left button (Prev) - always render to keep widths balanced */}
          {chapterIndex > 1 ? (
            <Link href={{ pathname: "/reader/[id]", params: { id: id ?? "1", ch: prevCh } } as any} asChild>
              <Pressable style={styles.navBtn}>
                <Text style={styles.navText}>Chương trước</Text>
              </Pressable>
            </Link>
          ) : (
            <Pressable style={[styles.navBtn, styles.navBtnDisabled]} disabled>
              <Text style={styles.navText}>Chương trước</Text>
            </Pressable>
          )}

          {/* Right button (Next) - always render to keep widths balanced */}
          {chaptersTotal == null || chapterIndex < chaptersTotal ? (
            <Link href={{ pathname: "/reader/[id]", params: { id: id ?? "1", ch: nextCh } } as any} asChild>
              <Pressable style={[styles.navBtn, styles.navBtnPrimary]}>
                <Text style={[styles.navText, styles.navTextPrimary]}>Chương tiếp</Text>
              </Pressable>
            </Link>
          ) : (
            <Pressable style={[styles.navBtn, styles.navBtnPrimary, styles.navBtnDisabled]} disabled>
              <Text style={[styles.navText, styles.navTextPrimary]}>Chương tiếp</Text>
            </Pressable>
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
  headerTitle: { fontSize: 16, fontWeight: "800" },
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
  navBtn: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f2f4f7", marginHorizontal: 4, paddingHorizontal: 12, paddingVertical: 8 },
  navBtnPrimary: { backgroundColor: "#1088ff" },
  navText: { color: "#374151", fontWeight: "700", fontSize: 14 },
  navTextPrimary: { color: "#ffffff" },
  navBtnDisabled: { opacity: 0.45 },
});
