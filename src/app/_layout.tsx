import { Stack, usePathname } from "expo-router";
import { ImageBackground, StyleSheet, View } from "react-native";

export default function RootLayout() {
  const pathname = usePathname();
  const p = pathname ?? "";
  const isSplash = p === "/" || p.length === 0;
  const isHome = p === "/home" || p.endsWith("/home");
  const isBgRoute = isHome;

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
        animation: "none",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="home" />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="search" />
      <Stack.Screen name="book/[id]" />
      <Stack.Screen name="reader/[id]" />
    </Stack>
  );

  if (isSplash || !isBgRoute) {
    return stack;
  }

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require("../assets/bg.jpg")}
        style={styles.bg}
        resizeMode="cover"
        blurRadius={16}
      >
        {stack}
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bg: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
});
