import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAppTheme } from '../../components/AppTheme'

export default function AuthLayout() {
  const { colors } = useAppTheme()
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="login" options={{ freezeOnBlur: true }} />
        <Stack.Screen name="register" options={{ freezeOnBlur: true }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
