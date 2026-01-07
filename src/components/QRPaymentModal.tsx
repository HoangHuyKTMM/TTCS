import React, { useState, useEffect, useRef } from 'react'
import { View, Text, Modal, StyleSheet, Pressable, Image, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiVerifyAndCreditPayment } from '../lib/api'

type Props = {
    visible: boolean
    onClose: () => void
    onPaymentSuccess?: (wallet?: any) => void
    amount: number
    coins: number
    userId?: string | number
    token?: string
}

const BANK_ID = "MB"
const ACCOUNT_NO = "123406072004"
const ACCOUNT_NAME = "Hoang Van Huy"

export default function QRPaymentModal({ visible, onClose, onPaymentSuccess, amount, coins, userId, token }: Props) {
    const [checking, setChecking] = useState(false)
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'failed'>('pending')
    const [statusMessage, setStatusMessage] = useState('')
    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const [paymentCode, setPaymentCode] = useState('')

    // Payment content is a short unique code
    // Format: "RD<userId><shortCode>" e.g. "RD123A7B2"
    const addInfo = paymentCode || `Nap ${coins} xu`
    const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${ACCOUNT_NO}-compact2.jpg?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(ACCOUNT_NAME)}`

    // Reset state when modal opens
    useEffect(() => {
        if (visible) {
            setPaymentStatus('pending')
            setStatusMessage('')
            setChecking(false)

            // Generate unique payment code: RD + userId + short timestamp (base36)
            if (userId) {
                const shortTs = Date.now().toString(36).slice(-4).toUpperCase()
                setPaymentCode(`RD${userId}${shortTs}`)
            } else {
                setPaymentCode('')
            }
        } else {
            // Clear interval when modal closes
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
            }
        }
    }, [visible, userId])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
            }
        }
    }, [])

    const checkPayment = async () => {
        if (!token) {
            setStatusMessage('Bạn cần đăng nhập để xác thực thanh toán.')
            return
        }

        setChecking(true)
        setStatusMessage('Đang kiểm tra giao dịch...')

        try {
            // Call backend API which verifies with bank and auto-credits coins
            const result = await apiVerifyAndCreditPayment(coins, amount, paymentCode, token)

            if (result.paid && result.success) {
                setPaymentStatus('success')
                setStatusMessage(result.message || '✅ Thanh toán thành công! Xu đã được cộng vào tài khoản.')

                // Clear any running interval
                if (checkIntervalRef.current) {
                    clearInterval(checkIntervalRef.current)
                    checkIntervalRef.current = null
                }

                // Wait a bit then call success callback with wallet info
                setTimeout(() => {
                    if (onPaymentSuccess) {
                        onPaymentSuccess(result.wallet)
                    }
                    onClose()
                }, 1500)
            } else {
                setPaymentStatus('pending')
                setStatusMessage(result.message || 'Chưa tìm thấy giao dịch. Vui lòng kiểm tra nội dung chuyển khoản.')
            }
        } catch (error: any) {
            setStatusMessage('Lỗi kết nối. Vui lòng thử lại.')
            console.error('[QRPayment] Verify payment error:', error)
        } finally {
            setChecking(false)
        }
    }

    // Auto-check payment every 5 seconds when modal is visible
    const startAutoCheck = () => {
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
        }

        // Check immediately
        checkPayment()

        // Then check every 5 seconds
        checkIntervalRef.current = setInterval(() => {
            if (paymentStatus !== 'success') {
                checkPayment()
            }
        }, 5000)
    }

    const handleManualCheck = () => {
        checkPayment()
    }

    const handleClose = () => {
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
        }
        onClose()
    }

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Thanh toán</Text>
                        <Pressable onPress={handleClose} hitSlop={10}>
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

                    {/* Payment Status */}
                    {statusMessage ? (
                        <View style={[
                            styles.statusContainer,
                            paymentStatus === 'success' && styles.statusSuccess
                        ]}>
                            {checking && <ActivityIndicator size="small" color="#1088ff" style={{ marginRight: 8 }} />}
                            <Text style={[
                                styles.statusText,
                                paymentStatus === 'success' && styles.statusTextSuccess
                            ]}>
                                {statusMessage}
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.note}>
                            Quét mã QR bằng app ngân hàng để thanh toán. Sau khi thanh toán, nhấn nút xác nhận bên dưới.
                        </Text>
                    )}

                    {/* Verify Payment Button */}
                    <Pressable
                        style={[styles.verifyBtn, checking && styles.verifyBtnDisabled]}
                        onPress={handleManualCheck}
                        disabled={checking || paymentStatus === 'success'}
                    >
                        {checking ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                                <Text style={styles.verifyBtnText}>Xác nhận thanh toán</Text>
                            </>
                        )}
                    </Pressable>

                    {/* Close / Done Button */}
                    <Pressable style={styles.doneBtn} onPress={handleClose}>
                        <Text style={styles.doneBtnText}>Đóng</Text>
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
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f9ff',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
    },
    statusSuccess: {
        backgroundColor: '#dcfce7',
    },
    statusText: {
        fontSize: 14,
        color: '#1e40af',
        fontWeight: '500',
    },
    statusTextSuccess: {
        color: '#166534',
        fontWeight: '700',
    },
    verifyBtn: {
        backgroundColor: '#1088ff',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 10,
    },
    verifyBtnDisabled: {
        backgroundColor: '#93c5fd',
    },
    verifyBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    doneBtn: {
        backgroundColor: '#e5e7eb',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    doneBtnText: {
        color: '#374151',
        fontSize: 16,
        fontWeight: '700',
    },
})

