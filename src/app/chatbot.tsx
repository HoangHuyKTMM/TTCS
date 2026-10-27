import { useThemeStyles } from '../components/AppTheme'
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    StyleSheet,
    Text,
    View,
    TextInput,
    FlatList,
    Pressable,
    Alert,
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useDebouncedNavigation } from '../lib/navigation'
import { apiChat } from "../lib/api";
import * as Auth from "../lib/auth";
import { getReadingList } from "../lib/reading";
import Markdown from "react-native-markdown-display";
import StoryFlashcards, { recommendationLead, type SuggestionBook } from "../components/StoryFlashcards";
import ChatSessionBar from "../components/ChatSessionBar";
import TypingDots from "../components/TypingDots";
import { Cover } from "../components/ui";
import { radius, cardShadowSm, type AppColors } from "../theme"

type ReadingChoice = { id: string; title: string; cover?: string | null; chapterNo?: number }

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    books?: SuggestionBook[];
    intent?: 'recommend' | 'recap';
    readingChoices?: ReadingChoice[];
};

function wantsRecap(intent: 'recommend' | 'recap' | undefined, text: string) {
    if (intent === 'recommend') return false
    if (intent === 'recap') return true
    const normalized = text.toLowerCase()
    if (/gợi ý|goi y|recommend/.test(normalized)) return false
    return /tóm tắt|tom tat|chương trước|chuong truoc|diễn biến|dien bien|nhắc lại|nhac lai/.test(normalized)
}

const RECAP_LOGIN_MESSAGE = 'Đăng nhập để dùng tóm tắt truyện bằng AI.'

function chatbotWelcome(bookId: string, bookTitle: string, chapterNo: number, signedIn: boolean) {
    if (!signedIn) {
        return bookId
            ? `Xin chào! Tôi là agent đọc truyện.${bookTitle ? ` Bạn đang đọc **${bookTitle}**` : ''}${chapterNo > 0 ? `, chương ${chapterNo}` : ''}.\n\n• Gợi ý truyện khác cùng vibe vẫn dùng được\n• ${RECAP_LOGIN_MESSAGE}`
            : `Xin chào! Tôi là agent gợi ý của Reader App.\n\n• Gợi ý truyện theo thể loại / mood vẫn dùng được\n• ${RECAP_LOGIN_MESSAGE}`
    }
    return bookId
        ? `Xin chào! Mình là trợ lý đọc.${bookTitle ? ` Bạn đang đọc **${bookTitle}**` : ''}${chapterNo > 0 ? `, chương ${chapterNo}` : ''}.\n\nMình trả lời câu hỏi, tóm tắt bất kỳ chương nào bạn đã đọc, và gợi ý truyện khi bạn muốn.\n\nHỏi tự do, hoặc bấm **Tóm tắt chương đã đọc**.`
        : "Xin chào! Mình là trợ lý đọc của Reader App.\n\nHỏi mình là ai, nhờ gợi ý truyện, hoặc nhờ tóm tắt một chương bạn đã đọc.\n\nBạn muốn gì?"
}

export default function ChatbotScreen() {
  const { colors, styles } = useThemeStyles(createStyles)
  const markdownStyles = createMarkdownStyles(colors)

    const router = useRouter();
    const { navigate } = useDebouncedNavigation()
    const params = useLocalSearchParams<{ bookId?: string; ch?: string; title?: string }>()
    const bookId = params.bookId ? String(params.bookId) : ''
    const chapterNo = params.ch ? Number(params.ch) : 0
    const bookTitle = params.title ? String(params.title) : ''

    const conversationIdRef = useRef<string | number | null>(null)
    const conversationTokenRef = useRef<string | undefined>(undefined)
    const [pickedBook, setPickedBook] = useState<ReadingChoice | null>(
        bookId ? { id: bookId, title: bookTitle || 'Truyện đang đọc', chapterNo: chapterNo > 0 ? chapterNo : undefined } : null
    )

    useEffect(() => {
        if (!bookId) return
        setPickedBook({ id: bookId, title: bookTitle || 'Truyện đang đọc', chapterNo: chapterNo > 0 ? chapterNo : undefined })
    }, [bookId, bookTitle, chapterNo])
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content: chatbotWelcome(bookId, bookTitle, chapterNo, true),
        },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    useFocusEffect(useCallback(() => {
        let alive = true
        Auth.getToken().then((token) => {
            if (!alive) return
            setMessages((prev) => {
                if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev
                const content = chatbotWelcome(bookId, bookTitle, chapterNo, Boolean(token))
                if (prev[0].content === content) return prev
                return [{ id: 'welcome', role: 'assistant', content }]
            })
        })
        return () => { alive = false }
    }, [bookId, bookTitle, chapterNo]))

    const askLoginForRecap = () => {
        Alert.alert('Cần đăng nhập', RECAP_LOGIN_MESSAGE, [
            { text: 'Để sau', style: 'cancel' },
            { text: 'Đăng nhập', onPress: () => router.push('/(auth)/login' as any) },
        ])
    }

    const askWhichStory = async (promptText: string) => {
        const token = await Auth.getToken()
        if (!token) {
            askLoginForRecap()
            return
        }
        let choices: ReadingChoice[] = []
        let reply = 'Bạn muốn tóm tắt truyện nào? Chọn một truyện trong danh sách đang đọc.'
        try {
            const list = await getReadingList()
            const seen = new Set<string>()
            for (const item of list) {
                const id = String(item?.bookId || '')
                const title = String(item?.title || '').trim()
                if (!id || !title || seen.has(id)) continue
                seen.add(id)
                choices.push({
                    id,
                    title,
                    cover: item.cover || null,
                    chapterNo: item.chapterNo && item.chapterNo > 0 ? item.chapterNo : undefined,
                })
            }
            if (!choices.length) reply = 'Bạn chưa có truyện đang đọc. Hãy mở một chương rồi quay lại để tóm tắt.'
        } catch {
            choices = []
            reply = 'Không tải được danh sách đang đọc. Thử lại sau.'
        }
        setMessages((prev) => [...prev,
            { id: Date.now().toString(), role: 'user', content: promptText },
            {
                id: `${Date.now()}-pick`,
                role: 'assistant',
                intent: 'recap',
                content: reply,
                readingChoices: choices,
            },
        ])
    }

    const sendToAgent = async (text: string, intent?: 'recommend' | 'recap', book?: ReadingChoice) => {
        const content = String(text || '').trim()
        if (!content || loading) return
        const routeBook = bookId
            ? { id: bookId, title: bookTitle || 'Truyện đang đọc', chapterNo: chapterNo > 0 ? chapterNo : undefined }
            : null
        const target = book || pickedBook || routeBook
        const recap = wantsRecap(intent, content)
        if (recap && !target?.id) {
            await askWhichStory(content)
            return
        }
        const token = await Auth.getToken();
        if (recap && !token) {
            askLoginForRecap()
            return
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content,
        };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setLoading(true);

        try {
            const history = messages
                .filter((m) => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
                .slice(-8)
                .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
            const data: any = await apiChat({
                message: content,
                history,
                intent: recap ? 'recap' : intent,
                book_id: target?.id || undefined,
                chapter_no: target?.chapterNo && target.chapterNo > 0
                    ? target.chapterNo
                    : (chapterNo > 0 ? chapterNo : undefined),
                conversation_id: conversationIdRef.current ?? undefined,
                conversation_token: conversationTokenRef.current,
            }, token || undefined)
            if (data && data.conversation_id) conversationIdRef.current = data.conversation_id
            if (data?.conversation_token) conversationTokenRef.current = data.conversation_token
            if (data?.error === 'conversation_not_found') {
                conversationIdRef.current = null
                conversationTokenRef.current = undefined
            }
            if (data?.error === 'login_required') {
                askLoginForRecap()
                setMessages((prev) => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: data.message || RECAP_LOGIN_MESSAGE,
                }])
                return
            }

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: data.reply || data.message || "Xin lỗi, tôi không thể trả lời lúc này.",
                books: Array.isArray(data.books) ? data.books : [],
                intent: data.intent === 'recap' || data.intent === 'recommend' ? data.intent : undefined,
            };
            setMessages((prev) => [...prev, aiMessage]);
        } catch (e: any) {
            setMessages((prev) => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "Đã có lỗi xảy ra. Vui lòng thử lại sau.",
            }]);
        } finally {
            setLoading(false);
        }
    }

    const sendMessage = async () => {
        await sendToAgent(input)
    }

    const chooseStory = (_messageId: string, choice: ReadingChoice) => {
        if (loading) return
        router.push({
            pathname: '/reader/[id]',
            params: {
                id: choice.id,
                ch: String(choice.chapterNo && choice.chapterNo > 0 ? choice.chapterNo : 1),
                recap: '1',
            },
        } as any)
    }

    const startNewSession = () => {
        conversationIdRef.current = null
        conversationTokenRef.current = undefined
        setInput('')
        if (!bookId) setPickedBook(null)
        setMessages([{
            id: 'welcome',
            role: 'assistant',
            content: chatbotWelcome(bookId, bookTitle, chapterNo, true),
        }])
        Auth.getToken().then((token) => {
            setMessages((prev) => {
                if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev
                return [{ id: 'welcome', role: 'assistant', content: chatbotWelcome(bookId, bookTitle, chapterNo, Boolean(token)) }]
            })
        })
    }

    const openSession = (session: { id: string; messages: { id: string; role: 'user' | 'assistant'; content: string }[] }) => {
        conversationIdRef.current = session.id
        conversationTokenRef.current = undefined
        const restored = session.messages.filter((item) => item.content).map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
        }))
        setMessages(restored.length ? restored : [{
            id: 'welcome',
            role: 'assistant',
            content: chatbotWelcome(bookId, bookTitle, chapterNo, true),
        }])
    }

    useEffect(() => {
        if (flatListRef.current && messages.length > 0) {
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    }, [messages, loading]);

    const renderMessage = ({ item }: { item: Message }) => {
        const isUser = item.role === "user";
        const suggestions = !isUser && item.intent !== 'recap' ? (item.books || []) : []
        const showCards = suggestions.length > 0
        return (
            <View
                style={[
                    styles.messageBubble,
                    isUser ? styles.userBubble : styles.aiBubble,
                    showCards && styles.cardBubble,
                ]}
            >
                {!isUser && (
                    <View style={styles.aiAvatar}>
                        <Ionicons name="sparkles" size={16} color={colors.accentText} />
                    </View>
                )}
                <View style={[styles.messageContent, isUser && styles.userContent, showCards && styles.cardContent]}>
                    {isUser ? (
                        <Text style={[styles.messageText, styles.userText]}>
                            {item.content}
                        </Text>
                    ) : (
                        <Markdown style={markdownStyles}>
                            {showCards ? recommendationLead(item.content) : item.content}
                        </Markdown>
                    )}

                    {showCards ? (
                        <StoryFlashcards
                            books={suggestions.slice(0, 4)}
                            onOpen={(id) => navigate('/book/[id]', { id })}
                        />
                    ) : null}
                    {!isUser && item.readingChoices && item.readingChoices.length > 0 ? (
                        <View style={styles.choiceList}>
                            {item.readingChoices.map((choice) => (
                                <Pressable
                                    key={choice.id}
                                    style={styles.choiceRow}
                                    disabled={loading}
                                    onPress={() => chooseStory(item.id, choice)}
                                >
                                    <Cover uri={choice.cover} width={42} height={56} radius={8} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.choiceTitle} numberOfLines={2}>{choice.title}</Text>
                                        <Text style={styles.choiceMeta}>
                                            {choice.chapterNo ? `Đang đọc chương ${choice.chapterNo}` : 'Đang đọc'}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </Pressable>
                <View style={styles.headerCenter}>
                    <Ionicons name="sparkles" size={20} color={colors.accentText} />
                    <View>
                        <Text style={styles.headerTitle}>Trợ lý đọc</Text>
                        {!!(pickedBook?.title || bookTitle) && (
                            <Text style={styles.headerSub} numberOfLines={1}>
                                {(pickedBook?.title || bookTitle)}{(pickedBook?.chapterNo || chapterNo) > 0 ? ` · ch. ${pickedBook?.chapterNo || chapterNo}` : ''}
                            </Text>
                        )}
                    </View>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <View style={{ flex: 1 }}>
                <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                    <ChatSessionBar disabled={loading} onNewSession={startNewSession} onOpenSession={openSession} />
                </View>
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={styles.messagesList}
                    showsVerticalScrollIndicator={false}
                    ListFooterComponent={loading ? (
                        <View style={[styles.messageBubble, styles.aiBubble]}>
                            <View style={styles.aiAvatar}>
                                <Ionicons name="sparkles" size={16} color={colors.accentText} />
                            </View>
                            <View style={styles.messageContent}>
                                <TypingDots color={colors.textMuted} />
                            </View>
                        </View>
                    ) : null}
                />

                <View style={styles.chipsRow}>
                    <Pressable
                        style={styles.chip}
                        disabled={loading}
                        onPress={() => sendToAgent('Tóm tắt các chương đã đọc, tôi quên diễn biến rồi.', 'recap')}
                    >
                        <Text style={styles.chipText}>Tóm tắt chương đã đọc</Text>
                    </Pressable>
                    <Pressable
                        style={styles.chip}
                        disabled={loading}
                        onPress={() => sendToAgent('Gợi ý vài truyện hay cùng vibe với những gì tôi đang đọc.', 'recommend')}
                    >
                        <Text style={styles.chipText}>Gợi ý truyện</Text>
                    </Pressable>
                </View>

                {/* Input */}
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="Hỏi về truyện bạn muốn đọc..."
                        placeholderTextColor={colors.textMuted}
                        value={input}
                        onChangeText={setInput}
                        multiline
                        maxLength={500}
                        editable={!loading}
                    />
                    <Pressable
                        style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
                        onPress={sendMessage}
                        disabled={!input.trim() || loading}
                    >
                        <Ionicons name="send" size={20} color={colors.onAccent} />
                    </Pressable>
                </View>
            </View>
        </SafeAreaView>
    );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderLight,
        ...cardShadowSm,
    },
    backBtn: {
        width: 38,
        height: 38,
        borderRadius: radius.full,
        backgroundColor: colors.surfaceSubtle,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 1,
        borderColor: colors.borderLight,
    },
    headerCenter: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "800",
        color: colors.text,
    },
    headerSub: {
        fontSize: 11,
        color: colors.textMuted,
        marginTop: 1,
        maxWidth: 180,
    },
    chipsRow: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.borderLight,
    },
    chip: {
        backgroundColor: colors.accentSoft,
        borderRadius: radius.full,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(37, 99, 235, 0.15)',
    },
    chipText: {
        fontSize: 12,
        fontWeight: "700",
        color: colors.accentText,
    },
    choiceList: {
        marginTop: 10,
        gap: 8,
    },
    choiceRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 8,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceSubtle,
        borderWidth: 1,
        borderColor: colors.borderLight,
    },
    choiceTitle: {
        fontSize: 14,
        fontWeight: "700",
        color: colors.text,
    },
    choiceMeta: {
        marginTop: 2,
        fontSize: 12,
        color: colors.textMuted,
    },
    messagesList: {
        padding: 16,
        paddingBottom: 12,
    },
    messageBubble: {
        flexDirection: "row",
        marginBottom: 16,
        maxWidth: "100%",
    },
    userBubble: {
        alignSelf: "flex-end",
        flexDirection: "row-reverse",
    },
    aiBubble: {
        alignSelf: "flex-start",
    },
    cardBubble: {
        width: "100%",
    },
    aiAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: colors.accentSoft,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 10,
        borderWidth: 1,
        borderColor: colors.borderLight,
    },
    messageContent: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.borderLight,
        flexShrink: 1,
        ...cardShadowSm,
    },
    cardContent: {
        flex: 1,
    },
    userContent: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    messageText: {
        fontSize: 14,
        color: colors.text,
        lineHeight: 21,
    },
    userText: {
        color: colors.onAccent,
    },
    loadingContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 8,
        gap: 8,
    },
    loadingText: {
        fontSize: 13,
        color: colors.textMuted,
        fontWeight: '500',
    },
    inputContainer: {
        flexDirection: "row",
        alignItems: "flex-end",
        padding: 12,
        paddingBottom: Platform.OS === "ios" ? 24 : 12,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.borderLight,
        gap: 10,
    },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 100,
        backgroundColor: colors.surfaceSubtle,
        borderRadius: radius.full,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 14,
        color: colors.text,
        borderWidth: 1,
        borderColor: colors.inputBorder,
    },
    sendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.accent,
        justifyContent: "center",
        alignItems: "center",
        ...cardShadowSm,
    },
    sendBtnDisabled: {
        backgroundColor: colors.border,
    },
});

const createMarkdownStyles = (colors: AppColors) => ({
    body: {
        color: colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    strong: {
        fontWeight: "700" as const,
        color: colors.text,
    },
    em: {
        fontStyle: "italic" as const,
    },
    paragraph: {
        marginTop: 0,
        marginBottom: 8,
    },
    bullet_list: {
        marginTop: 4,
        marginBottom: 4,
    },
    ordered_list: {
        marginTop: 4,
        marginBottom: 4,
    },
    list_item: {
        marginTop: 2,
        marginBottom: 2,
    },
    heading1: {
        fontSize: 18,
        fontWeight: "700" as const,
        marginBottom: 8,
    },
    heading2: {
        fontSize: 16,
        fontWeight: "700" as const,
        marginBottom: 6,
    },
    link: {
        color: colors.accentText,
    },
});
