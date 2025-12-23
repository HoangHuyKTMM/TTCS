import { StyleSheet, View, ImageBackground } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace("/home");
    }, 5000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ImageBackground
        source={require("../assets/splash.png")}
        style={styles.image}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#4ea1ff",
  },
  image: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
});
