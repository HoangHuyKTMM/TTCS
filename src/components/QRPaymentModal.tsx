import { useThemeStyles } from './AppTheme'
import { type AppColors } from '../theme'
import React, { useState, useEffect, useRef } from 'react'
import { View, Text, Modal, StyleSheet, Pressable, Image, ActivityIndicator, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiCreateTopupIntent, apiCheckTopupIntentStatus, apiVerifyAndCreditPayment, apiLocalSepayPay, TopupIntent } from '../lib/api'

type Props = {
    visible: boolean
    onClose: () => void
    onPaymentSuccess?: (wallet?: any) => void
    coins: number
    token?: string
}

export default function QRPaymentModal({ visible, onClose, onPaymentSuccess, coins, token }: Props) {
  const { colors, styles } = useThemeStyles(createStyles)

    const [loadingIntent, setLoadingIntent] = useState(false)
    const [checking, setChecking] = useState(false)
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'success' | 'failed'>('pending')
    const [statusMessage, setStatusMessage] = useState('')
    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const successRef = useRef(false)

    const [intentCoins, setIntentCoins] = useState(coins)
    const [intentAmount, setIntentAmount] = useState(coins * 100)
    const [paymentCode, setPaymentCode] = useState('')
    const [bankName, setBankName] = useState('MBBank')
    const [accountNo, setAccountNo] = useState('')
    const [accountName, setAccountName] = useState('')
    const [qrImageUrl, setQrImageUrl] = useState('')
    const [localMode, setLocalMode] = useState(false)

    const stopPolling = () => {
        if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
        }
    }

    const handlePaymentSuccess = (walletData?: any, creditedCoins?: number) => {
        if (successRef.current) return
        successRef.current = true
        stopPolling()
        const n = creditedCoins ?? intentCoins
        setPaymentStatus('success')
        setStatusMessage(`✅ Thanh toán thành công! Đã nạp ${n} xu.`)

        setTimeout(() => {
            if (onPaymentSuccess) {
                onPaymentSuccess(walletData)
            }
            onClose()
        }, 1500)
    }

    const verifyOnce = async (code: string) => {
        if (!code || !token || successRef.current) return
        try {
            const result = await apiVerifyAndCreditPayment(code, token)
            if (result && result.paid && (result.success || result.already_credited)) {
                handlePaymentSuccess(result.wallet, intentCoins)
                return
            }
            const status = await apiCheckTopupIntentStatus(code, token)
            if (status && (status.is_paid || status.status === 'consumed')) {
                handlePaymentSuccess(status.wallet, status.coins ?? intentCoins)
            }
        } catch (e) {
            // Ignore polling network glitches
        }
    }

    const startAutoCheck = (code: string) => {
        stopPolling()
        checkIntervalRef.current = setInterval(() => {
            verifyOnce(code)
        }, 3000)
    }

    useEffect(() => {
        let isMounted = true
        successRef.current = false

        const initPayment = async () => {
            if (!visible) {
                stopPolling()
                return
            }

            setPaymentStatus('pending')
            setStatusMessage('')
            setChecking(false)
            setLoadingIntent(true)
            setQrImageUrl('')
            setLocalMode(false)
            setPaymentCode('')
            setAccountNo('')
            setAccountName('')

            if (!token) {
                if (isMounted) {
                    setPaymentStatus('failed')
                    setStatusMessage('Bạn cần đăng nhập để tạo mã thanh toán.')
                    setLoadingIntent(false)
                }
                return
            }

            try {
                const res = await apiCreateTopupIntent(coins, token)
                if (!isMounted) return
                if (res && res.success && res.intent) {
                    const intent: TopupIntent = res.intent
                    setPaymentCode(intent.payment_code)
                    setIntentCoins(Number(intent.coins) || coins)
                    setIntentAmount(Number(intent.amount) || coins * 100)
                    if (intent.bank_name) setBankName(intent.bank_name)
                    if (intent.account_no) setAccountNo(intent.account_no)
                    if (intent.account_name) setAccountName(intent.account_name)
                    setQrImageUrl(intent.vietqr_url || intent.qr_url)
                    setLocalMode(!!intent.local_mode)
                    startAutoCheck(intent.payment_code)
                    verifyOnce(intent.payment_code)
                    setLoadingIntent(false)
                    return
                }
                setPaymentStatus('failed')
                setStatusMessage((res && (res.error || (res as any).message)) || 'Không tạo được mã QR. Vui lòng thử lại.')
            } catch (err) {
                console.error('[QRPayment] Error creating topup intent:', err)
                if (isMounted) {
                    setPaymentStatus('failed')
                    setStatusMessage('Không tạo được mã QR. Vui lòng thử lại.')
                }
            }
            if (isMounted) setLoadingIntent(false)
        }

        initPayment()

        return () => {
            isMounted = false
            stopPolling()
        }
    }, [visible, coins, token])

    const handleManualCheck = async () => {
        if (!token) {
            setStatusMessage('Bạn cần đăng nhập để xác thực thanh toán.')
            return
        }
        if (!paymentCode) {
            setStatusMessage('Chưa có mã thanh toán. Vui lòng đóng và mở lại.')
            return
        }

        setChecking(true)
        setStatusMessage(localMode ? 'Đang cộng xu trên máy local...' : 'Đang kiểm tra giao dịch...')

        try {
            const result = localMode
                ? await apiLocalSepayPay(paymentCode, token)
                : await apiVerifyAndCreditPayment(paymentCode, token)
            if (result.paid && (result.success || result.already_credited)) {
                handlePaymentSuccess(result.wallet, intentCoins)
            } else {
                setPaymentStatus('pending')
                setStatusMessage(result.message || 'Chưa tìm thấy giao dịch. Vui lòng chuyển khoản đúng nội dung và thử lại.')
            }
        } catch (error: any) {
            setStatusMessage('Lỗi kết nối tới cổng thanh toán. Vui lòng thử lại.')
            console.error('[QRPayment] Manual verify payment error:', error)
        } finally {
            setChecking(false)
        }
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
                        <View>
                            <Text style={styles.title}>Nạp xu tự động</Text>
                            <Text style={styles.subtitle}>Cổng thanh toán tự động SePay</Text>
                        </View>
                        <Pressable onPress={handleClose} hitSlop={10}>
                            <Ionicons name="close" size={24} color={colors.textSecondary} />
                        </Pressable>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                        {loadingIntent ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color={colors.accentText} />
                                <Text style={styles.loadingText}>Đang tạo mã QR thanh toán SePay...</Text>
                            </View>
                        ) : paymentStatus === 'failed' || !qrImageUrl ? (
                            <View style={styles.loadingContainer}>
                                <Ionicons name="alert-circle" size={36} color={colors.danger} />
                                <Text style={styles.loadingText}>{statusMessage || 'Không tạo được mã QR. Vui lòng thử lại.'}</Text>
                                <Pressable style={styles.doneBtn} onPress={handleClose}>
                                    <Text style={styles.doneBtnText}>Đóng</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <>
                                <View style={styles.qrContainer}>
                                    <Image
                                        source={{ uri: qrImageUrl }}
                                        style={styles.qrImage}
                                        resizeMode="contain"
                                    />
                                    <View style={styles.badgeAuto}>
                                        <Ionicons name="flash" size={14} color={colors.secondaryText} />
                                        <Text style={styles.badgeAutoText}>{localMode ? 'SePay local: bấm xác nhận để cộng xu' : 'Tự động cộng xu sau 1 - 3 giây'}</Text>
                                    </View>
                                </View>

                                <View style={styles.info}>
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>Ngân hàng</Text>
                                        <Text style={styles.infoValue}>{bankName}</Text>
                                    </View>
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>Số tài khoản</Text>
                                        <Text style={[styles.infoValue, { color: colors.accentText }]} selectable>{accountNo}</Text>
                                    </View>
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>Chủ tài khoản</Text>
                                        <Text style={styles.infoValue}>{accountName}</Text>
                                    </View>
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>Số tiền</Text>
                                        <Text style={[styles.infoValue, styles.amount]}>{Number(intentAmount || 0).toLocaleString('vi-VN')} VNĐ</Text>
                                    </View>
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>Nội dung CK</Text>
                                        <Text style={[styles.infoValue, styles.codeHighlight]} selectable>{paymentCode}</Text>
                                    </View>
                                </View>

                                {/* Payment Status / Live indicator */}
                                {paymentStatus === 'success' ? (
                                    <View style={[styles.statusContainer, styles.statusSuccess]}>
                                        <Ionicons name="checkmark-circle" size={20} color="#166534" style={{ marginRight: 8 }} />
                                        <Text style={[styles.statusText, styles.statusTextSuccess]}>
                                            {statusMessage}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.statusContainer}>
                                        <ActivityIndicator size="small" color={colors.accentText} style={{ marginRight: 8 }} />
                                        <Text style={styles.statusText}>
                                            {statusMessage || (localMode ? 'Chế độ local không trừ tiền ngân hàng. Bấm xác nhận để cộng xu.' : 'Đang chờ chuyển khoản... Quét mã QR bằng App ngân hàng.')}
                                        </Text>
                                    </View>
                                )}

                                <Text style={styles.note}>
                                    ⚠️ Vui lòng giữ nguyên <Text style={{ fontWeight: '700' }}>Nội dung CK</Text> để hệ thống SePay tự động cộng xu ngay lập tức.
                                </Text>

                                {/* Manual verify fallback */}
                                <Pressable
                                    style={[styles.verifyBtn, (checking || paymentStatus === 'success') && styles.verifyBtnDisabled]}
                                    onPress={handleManualCheck}
                                    disabled={checking || paymentStatus === 'success'}
                                >
                                    {checking ? (
                                        <ActivityIndicator size="small" color={colors.onAccent} />
                                    ) : (
                                        <>
                                            <Ionicons name="checkmark-circle-outline" size={20} color={colors.onAccent} style={{ marginRight: 8 }} />
                                            <Text style={styles.verifyBtnText}>{localMode ? 'Xác nhận SePay local' : 'Xác nhận thanh toán'}</Text>
                                        </>
                                    )}
                                </Pressable>

                                {/* Close Button */}
                                <Pressable style={styles.doneBtn} onPress={handleClose}>
                                    <Text style={styles.doneBtnText}>Đóng</Text>
                                </Pressable>
                            </>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    )
}

const createStyles = (colors: AppColors) => StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
        maxHeight: '90%',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.text,
    },
    subtitle: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
    loadingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 50,
        gap: 12,
    },
    loadingText: {
        fontSize: 14,
        color: colors.textSecondary,
        fontWeight: '500',
    },
    qrContainer: {
        alignItems: 'center',
        backgroundColor: colors.bg,
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    qrImage: {
        width: 250,
        height: 290,
    },
    badgeAuto: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.successSoft,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
        marginTop: 8,
        gap: 4,
    },
    badgeAutoText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.secondaryText,
    },
    info: {
        backgroundColor: colors.bg,
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
        color: colors.textSecondary,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    codeHighlight: {
        fontSize: 15,
        fontWeight: '700',
        color: '#e11d48',
        backgroundColor: '#ffe4e6',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    amount: {
        color: colors.secondaryText,
        fontSize: 16,
        fontWeight: '700',
    },
    note: {
        fontSize: 13,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 16,
        lineHeight: 18,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accentSoft,
        borderRadius: 12,
        padding: 12,
        marginBottom: 14,
    },
    statusSuccess: {
        backgroundColor: colors.successSoft,
    },
    statusText: {
        fontSize: 13,
        color: '#1e40af',
        fontWeight: '500',
        flexShrink: 1,
        textAlign: 'center',
    },
    statusTextSuccess: {
        color: '#166534',
        fontWeight: '700',
    },
    verifyBtn: {
        backgroundColor: colors.accent,
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
        color: colors.onAccent,
        fontSize: 16,
        fontWeight: '700',
    },
    doneBtn: {
        backgroundColor: colors.surfaceSubtle,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    doneBtnText: {
        color: colors.text,
        fontSize: 15,
        fontWeight: '600',
    },
})
