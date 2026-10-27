import { useThemeStyles } from './AppTheme'
import { type AppColors } from '../theme'
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
  const { colors, styles } = useThemeStyles(createStyles)

  const { visible, type = 'info', title, message, buttons, onDismiss } = props;

  const colorMap: any = {
    success: colors.successText,
    error: colors.dangerText,
    warning: colors.warningText,
    info: colors.info,
  };

  const color = colorMap[type] || colors.info;
  const surface = { success: colors.successSoft, error: colors.dangerSoft, warning: colors.warningSoft, info: colors.infoSoft }[type]
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
          <View style={[styles.header, { backgroundColor: surface }]}>
            <Text style={[styles.headerTitle, { color: type === 'info' ? colors.text : color }]}>{title}</Text>
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

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: colors.surface,
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
    color: colors.onDark,
    textAlign: 'left',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    minHeight: 60,
    justifyContent: 'center',
  },
  message: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightColor: colors.borderLight,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accentText,
  },
});

