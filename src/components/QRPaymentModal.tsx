import React from 'react'
import { View, Text, Modal, StyleSheet, Pressable, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

type Props = {
    visible: boolean
    onClose: () => void
    amount: number
    coins: number
}

const BANK_ID = "MB"
const ACCOUNT_NO = "669699669"
const ACCOUNT_NAME = "DINH Manh Hung"

export default function QRPaymentModal({ visible, onClose, amount, coins }: Props) {
    const addInfo = `Nap ${coins} xu`
    const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.jpg?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Thanh toán</Text>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <Ionicons name="close" size={24} color="#6b7280" />
                        </Pressable>
                    </View>

                    <View style={styles.qrContainer}>
                        <Image
                            source={{ uri: qrUrl }}
                            style={styles.qrImage}
                            resizeMode="contain"
                        />
                    </View>

                    <View style={styles.info}>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Ngân hàng</Text>
                            <Text style={styles.infoValue}>MB Bank</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Số tài khoản</Text>
                            <Text style={styles.infoValue}>{ACCOUNT_NO}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Chủ tài khoản</Text>
                            <Text style={styles.infoValue}>{ACCOUNT_NAME}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Số tiền</Text>
                            <Text style={[styles.infoValue, styles.amount]}>{amount.toLocaleString('vi-VN')} VNĐ</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Nội dung CK</Text>
                            <Text style={styles.infoValue}>{addInfo}</Text>
                        </View>
                    </View>

                    <Text style={styles.note}>
                        Quét mã QR bằng app ngân hàng để thanh toán. Xu sẽ được cộng sau khi admin xác nhận.
                    </Text>

                    <Pressable style={styles.doneBtn} onPress={onClose}>
                        <Text style={styles.doneBtnText}>Đã thanh toán</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
    },
    qrContainer: {
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    qrImage: {
        width: 250,
        height: 300,
    },
    info: {
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        gap: 12,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    infoLabel: {
        fontSize: 14,
        color: '#6b7280',
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    amount: {
        color: '#059669',
        fontSize: 16,
        fontWeight: '700',
    },
    note: {
        fontSize: 13,
        color: '#6b7280',
        textAlign: 'center',
        marginBottom: 16,
    },
    doneBtn: {
        backgroundColor: '#111827',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    doneBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
})
