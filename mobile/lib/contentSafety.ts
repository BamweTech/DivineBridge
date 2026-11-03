import { Alert } from 'react-native';
import { safetyApi, type SafetyContentType } from '@/services/api';

export function promptReportContent(input: {
  contentType: SafetyContentType;
  contentId: string;
  targetUserId?: string;
}) {
  const send = async (reason: string) => {
    try {
      await safetyApi.report({
        contentType: input.contentType,
        contentId: input.contentId,
        targetUserId: input.targetUserId ?? '',
        reason,
      });
      Alert.alert('Report sent', 'Thank you. We will review this content.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not send the report.';
      Alert.alert('Could not report', message);
    }
  };

  Alert.alert(
    'Report this?',
    'Your report is sent to Divine Bridge for review and includes your account and this content.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Harassment', onPress: () => { void send('harassment'); } },
      { text: 'Spam', onPress: () => { void send('spam'); } },
    ],
  );
}

export function promptBlockUser(targetUserId: string, onBlocked?: () => Promise<void> | void) {
  Alert.alert(
    'Block this person?',
    'You will stop seeing their messages and prayer requests. They are not notified.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await safetyApi.blockUser(targetUserId);
              await onBlocked?.();
              Alert.alert('Blocked', 'Their content is hidden on this account.');
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : 'Could not block this person.';
              Alert.alert('Could not block', message);
            }
          })();
        },
      },
    ],
  );
}
