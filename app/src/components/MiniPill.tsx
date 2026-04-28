import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  onPress: () => void;
};

/**
 * Minimal always-visible tap target shown when both the address bar and the
 * nav bar are hidden. Tapping opens the Settings modal so the user can turn
 * the bars back on. Rendered as position:absolute in BrowserScreen.
 */
export default function MiniPill({ onPress }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir les réglages"
      style={[styles.wrapper, { bottom: insets.bottom + 8 }]}>
      <View style={styles.pill} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    zIndex: 5,
    elevation: 5,
  },
  pill: {
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#333333',
  },
});
