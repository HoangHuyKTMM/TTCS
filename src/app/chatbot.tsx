import React, { useState, useRef, useEffect } from "react";
import {
    StyleSheet,
    Text,
    View,
    TextInput,
    FlatList,
    Pressable,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE } from "../lib/api";
import * as Auth from "../lib/auth";
import Markdown from "react-native-markdown-display";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    books?: any[];
};

export default function ChatbotScreen() {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content:
                "Xin chào! 👋 Tôi là trợ lý AI của Reader App. Tôi có thể giúp bạn:\n\n• Tìm truyện theo thể loại, tác giả\n• Gợi ý truyện hay\n• Tóm tắt nội dung truyện\n• Trả lời câu hỏi về truyện\n\nBạn muốn tôi giúp gì?",
        },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input.trim(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setLoading(true);

        try {
            const token = await Auth.getToken();
            const res = await fetch(`${API_BASE}/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ message: input.trim() }),
            });

            const data = await res.json();

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: data.reply || "Xin lỗi, tôi không thể trả lời lúc này.",
                books: data.books || [],
            };

            setMessages((prev) => [...prev, aiMessage]);
        } catch (e: any) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "Đã có lỗi xảy ra. Vui lòng thử lại sau.",
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (flatListRef.current && messages.length > 0) {
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    }, [messages]);

    const renderMessage = ({ item }: { item: Message }) => {
        const isUser = item.role === "user";
        return (
            <View
                style={[
                    styles.messageBubble,
                    isUser ? styles.userBubble : styles.aiBubble,
                ]}
            >
                {!isUser && (
                    <View style={styles.aiAvatar}>
                        <Ionicons name="sparkles" size={16} color="#1088ff" />
                    </View>
                )}
                <View style={[styles.messageContent, isUser && styles.userContent]}>
                    {isUser ? (
                        <Text style={[styles.messageText, styles.userText]}>
                            {item.content}
                        </Text>
                    ) : (
                        <Markdown style={markdownStyles}>
                            {item.content}
                        </Markdown>
                    )}

                    {/* Book recommendations */}
                    {item.books && item.books.length > 0 && (
                        <View style={styles.booksContainer}>
                            {item.books.slice(0, 5).map((book: any) => (
                                <Pressable
                                    key={book.id}
                                    style={styles.bookCard}
                                    onPress={() =>
                                        router.push({
                                            pathname: "/book/[id]",
                                            params: { id: book.id },
                                        } as any)
                                    }
                                >
                                    {book.cover_url ? (
                                        <Image
                                            source={{
                                                uri: book.cover_url.startsWith("http")
                                                    ? book.cover_url
                                                    : `${API_BASE}${book.cover_url}`,
                                            }}
                                            style={styles.bookCover}
                                        />
                                    ) : (
                                        <View style={styles.bookCoverPlaceholder}>
                                            <Ionicons name="book" size={20} color="#9ca3af" />
                                        </View>
                                    )}
                                    <View style={styles.bookInfo}>
                                        <Text style={styles.bookTitle} numberOfLines={1}>
                                            {book.title}
                                        </Text>
                                        <Text style={styles.bookMeta} numberOfLines={1}>
                                            {book.genre || "Truyện"} • {book.chapters_count || 0} chương
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                                </Pressable>
                            ))}
                        </View>
                    )}
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </Pressable>
                <View style={styles.headerCenter}>
                    <Ionicons name="sparkles" size={20} color="#1088ff" />
                    <Text style={styles.headerTitle}>AI Tư Vấn Truyện</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
            >
                {/* Messages */}
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={styles.messagesList}
                    showsVerticalScrollIndicator={false}
                />

                {/* Loading indicator */}
                {loading && (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color="#1088ff" />
                        <Text style={styles.loadingText}>AI đang suy nghĩ...</Text>
                    </View>
                )}

                {/* Input */}
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="Hỏi về truyện bạn muốn đọc..."
                        placeholderTextColor="#9ca3af"
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
                        <Ionicons name="send" size={20} color="#fff" />
                    </Pressable>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#f8fafc",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: "#fff",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#e5e7eb",
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: "#f2f4f7",
        justifyContent: "center",
        alignItems: "center",
    },
    headerCenter: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#111827",
    },
    messagesList: {
        padding: 16,
        paddingBottom: 8,
    },
    messageBubble: {
        flexDirection: "row",
        marginBottom: 16,
        maxWidth: "90%",
    },
    userBubble: {
        alignSelf: "flex-end",
        flexDirection: "row-reverse",
    },
    aiBubble: {
        alignSelf: "flex-start",
    },
    aiAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "#e0f2fe",
        justifyContent: "center",
        alignItems: "center",
        marginRight: 8,
    },
    messageContent: {
        backgroundColor: "#fff",
        borderRadius: 16,
        padding: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#e5e7eb",
        maxWidth: "85%",
    },
    userContent: {
        backgroundColor: "#1088ff",
        borderColor: "#1088ff",
    },
    messageText: {
        fontSize: 14,
        color: "#111827",
        lineHeight: 20,
    },
    userText: {
        color: "#fff",
    },
    booksContainer: {
        marginTop: 12,
        gap: 8,
    },
    bookCard: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#f8fafc",
        borderRadius: 10,
        padding: 8,
        gap: 10,
    },
    bookCover: {
        width: 40,
        height: 54,
        borderRadius: 6,
        backgroundColor: "#e5e7eb",
    },
    bookCoverPlaceholder: {
        width: 40,
        height: 54,
        borderRadius: 6,
        backgroundColor: "#e5e7eb",
        justifyContent: "center",
        alignItems: "center",
    },
    bookInfo: {
        flex: 1,
    },
    bookTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: "#111827",
    },
    bookMeta: {
        fontSize: 11,
        color: "#6b7280",
        marginTop: 2,
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
        color: "#6b7280",
    },
    inputContainer: {
        flexDirection: "row",
        alignItems: "flex-end",
        padding: 12,
        paddingBottom: Platform.OS === "ios" ? 24 : 12,
        backgroundColor: "#fff",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#e5e7eb",
        gap: 10,
    },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 100,
        backgroundColor: "#f2f4f7",
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 14,
        color: "#111827",
    },
    sendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: "#1088ff",
        justifyContent: "center",
        alignItems: "center",
    },
    sendBtnDisabled: {
        backgroundColor: "#94a3b8",
    },
});

const markdownStyles = {
    body: {
        color: "#111827",
        fontSize: 14,
        lineHeight: 20,
    },
    strong: {
        fontWeight: "700" as const,
        color: "#111827",
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
        color: "#1088ff",
    },
};
