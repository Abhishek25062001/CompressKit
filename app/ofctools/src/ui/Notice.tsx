import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Palette } from '../theme';

export interface NoticeData {
  /** Changes for every new notice, so the same text shown twice still restarts the timer. */
  id: number;
  tone: 'success' | 'error';
  title: string;
  detail?: string;
  action?: { label: string; onPress: () => void };
}

interface NoticeProps {
  palette: Palette;
  notice: NoticeData | null;
  onDismiss: () => void;
}

const VISIBLE_MS = { success: 7000, error: 10000 };

/**
 * A short message at the bottom of the screen, such as "Saved to Downloads" with a Share button.
 * It goes away by itself, or when tapped.
 */
export function Notice({ palette, notice, onDismiss }: NoticeProps) {
  const [shown] = useState(() => new Animated.Value(0));
  const id = notice?.id;
  const tone = notice?.tone;

  useEffect(() => {
    if (id === undefined || tone === undefined) return;
    shown.setValue(0);
    Animated.timing(shown, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(onDismiss, VISIBLE_MS[tone]);
    return () => clearTimeout(timer);
  }, [id, tone, onDismiss, shown]);

  if (!notice) return null;
  const error = notice.tone === 'error';
  const translateY = shown.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <Animated.View
      style={[styles.wrap, { opacity: shown, transform: [{ translateY }] }]}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: error ? palette.dangerSoft : palette.surface,
            borderColor: error ? palette.danger : palette.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${notice.title}. Dismiss`}
          onPress={onDismiss}
          style={styles.text}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.title,
              { color: error ? palette.danger : palette.fg },
            ]}
          >
            {notice.title}
          </Text>
          {notice.detail ? (
            <Text
              numberOfLines={2}
              style={[styles.detail, { color: palette.muted }]}
            >
              {notice.detail}
            </Text>
          ) : null}
        </Pressable>
        {notice.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={notice.action.onPress}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.actionLabel, { color: palette.accentFg }]}>
              {notice.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    pointerEvents: 'box-none',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    flex: 1,
    paddingVertical: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  detail: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
  action: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
