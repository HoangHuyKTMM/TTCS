import { Stack } from "expo-router";
import { ImageBackground, StyleSheet, View } from "react-native";

export default function AuthLayout() {
  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../../assets/bg.jpg")}
        style={styles.bg}
        resizeMode="cover"
        blurRadius={16}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            animation: "none",
          }}
        >
          <Stack.Screen name="login" options={{ freezeOnBlur: true }} />
          <Stack.Screen name="register" options={{ freezeOnBlur: true }} />
        </Stack>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bg: { flex: 1, width: "100%", height: "100%" },
});
