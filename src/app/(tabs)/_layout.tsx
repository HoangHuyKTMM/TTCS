import React from "react";
import { Tabs } from "expo-router";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="explore"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1088ff",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="explore"
        options={{
          title: "Khám phá",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "compass" : "compass-outline"} size={20} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Thư viện",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "library" : "library-outline"} size={20} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="rank"
        options={{
          title: "BXH",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "trophy" : "trophy-outline"} size={20} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Tôi",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={20} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
