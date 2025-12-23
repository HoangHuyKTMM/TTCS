import React, { useEffect } from 'react'
import { View, Text, Modal, StyleSheet, Pressable } from 'react-native'

type Props = {
  visible: boolean
  onFinish: () => void
  seconds?: number
}

export default function AdInterstitial({ visible, onFinish, seconds = 3 }: Props) {
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => onFinish(), seconds * 1000)
    return () => clearTimeout(t)
  }, [visible, onFinish, seconds])

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>Quảng cáo</Text>
          <Text style={styles.body}>Quảng cáo sẽ kết thúc sau vài giây — mua VIP để tắt quảng cáo.</Text>
          <Pressable style={styles.btn} onPress={onFinish}>
            <Text style={styles.btnText}>Bỏ qua</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  box: { width: '86%', backgroundColor: '#fff', borderRadius: 12, padding: 18, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  body: { fontSize: 14, color: '#374151', textAlign: 'center', marginBottom: 12 },
  btn: { backgroundColor: '#f59e0b', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
})
