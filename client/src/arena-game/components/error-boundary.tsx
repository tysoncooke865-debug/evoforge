/**
 * Error boundary wrapping every screen. Battle and profile screens must
 * never take the whole app down — the user always gets a way back.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { NeonButton } from './ui';

interface Props {
  children: React.ReactNode;
  /** Label shown in the fallback so the user knows what failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Structured log — picked up by the debug panel / device logs.
    console.error(`[ErrorBoundary:${this.props.label ?? 'screen'}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.message}>
            {this.props.label ? `The ${this.props.label} hit an error.` : 'This screen hit an error.'}
          </Text>
          <Text style={styles.detail} numberOfLines={4}>
            {String(this.state.error.message || this.state.error)}
          </Text>
          <NeonButton label="Try again" onPress={() => this.setState({ error: null })} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { color: colors.danger, fontSize: 22, fontWeight: '800' },
  message: { color: colors.text, fontSize: 15, textAlign: 'center' },
  detail: { color: colors.textDim, fontSize: 12, fontFamily: 'monospace', textAlign: 'center' },
});
