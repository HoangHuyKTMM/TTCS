import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface CustomAlertProps {
  visible: boolean;
  type?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  buttons?: Array<{
    text: string;
    onPress?: () => void;
  }>;
  onDismiss?: () => void;
}

export default function CustomAlert(props: CustomAlertProps) {
  const { visible, type = 'info', title, message, buttons, onDismiss } = props;

  const colorMap: any = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  };

  const color = colorMap[type] || '#3b82f6';
  const defaultButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK', onPress: undefined }];

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header with color */}
          <View style={[styles.header, { backgroundColor: color }]}>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>

          {/* Body */}
          <View style={styles.body}>
            <Text style={styles.message}>{message}</Text>
          </View>

          {/* Footer */}
          <View style={[styles.footer, { flexDirection: defaultButtons.length > 1 ? 'row' : 'column' }]}>
            {defaultButtons.map((btn, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.btn,
                  defaultButtons.length > 1 && { flex: 1, borderRightWidth: idx < defaultButtons.length - 1 ? 1 : 0 },
                ]}
                onPress={() => {
                  btn.onPress?.();
                  setTimeout(() => onDismiss?.(), 100);
                }}
              >
                <Text style={styles.btnText}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 15,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  header: {
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'left',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#efefef',
    minHeight: 60,
    justifyContent: 'center',
  },
  message: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#efefef',
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightColor: '#efefef',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3b82f6',
  },
});

