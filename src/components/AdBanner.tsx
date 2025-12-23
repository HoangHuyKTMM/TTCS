import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

type Props = { size?: 'small' | 'medium' | 'large' }

export default function AdBanner({ size = 'medium' }: Props) {
  const height = size === 'small' ? 60 : size === 'large' ? 160 : 90
  return (
    <View style={[styles.container, { height }]}> 
      <View style={styles.adBox}>
        <Text style={styles.adText}>Quảng cáo</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  adBox: { width: '94%', height: '100%', borderRadius: 8, borderWidth: 1, borderColor: '#e6e6e6', backgroundColor: '#fff7e6', alignItems: 'center', justifyContent: 'center' },
  adText: { color: '#b9770e', fontWeight: '700' }
})
