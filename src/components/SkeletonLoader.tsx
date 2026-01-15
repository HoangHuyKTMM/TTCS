import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: any;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ 
  width = '100%', 
  height = 20, 
  borderRadius = 4,
  style 
}) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
};

export const BookCardSkeleton: React.FC<{ variant?: 'vertical' | 'horizontal' }> = ({ variant = 'vertical' }) => {
  if (variant === 'horizontal') {
    return (
      <View style={{ flexDirection: 'row', padding: 12, backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16 }}>
        <SkeletonLoader width={80} height={106} style={{ borderRadius: 8, marginRight: 12 }} />
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View>
            <SkeletonLoader width="85%" height={18} style={{ marginBottom: 8 }} />
            <SkeletonLoader width="100%" height={14} style={{ marginBottom: 4 }} />
            <SkeletonLoader width="95%" height={14} />
          </View>
          <SkeletonLoader width="60%" height={12} />
        </View>
      </View>
    )
  }
  
  return (
    <View style={{ width: 140, marginRight: 12 }}>
      <SkeletonLoader width={140} height={186} style={{ borderRadius: 12, marginBottom: 8 }} />
      <SkeletonLoader width="90%" height={14} style={{ marginBottom: 4 }} />
      <SkeletonLoader width="70%" height={12} />
    </View>
  )
}

export const CommentSkeleton: React.FC = () => (
  <View style={styles.commentRow}>
    <SkeletonLoader width={36} height={36} borderRadius={18} />
    <View style={{ flex: 1 }}>
      <SkeletonLoader width="30%" height={14} style={{ marginBottom: 6 }} />
      <SkeletonLoader width="90%" height={12} style={{ marginBottom: 4 }} />
      <SkeletonLoader width="70%" height={12} />
    </View>
  </View>
);

export const ChapterListSkeleton: React.FC = () => (
  <View style={styles.chapterContainer}>
    {[1, 2, 3, 4, 5].map((i) => (
      <View key={i} style={styles.chapterRow}>
        <SkeletonLoader width="80%" height={16} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#e5e7eb',
  },
  bookCard: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  bookInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  commentRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  chapterContainer: {
    padding: 12,
  },
  chapterRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
});
