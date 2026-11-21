import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import { prayerWarriorApi, type WarriorApplicationReview } from '@/services/api';

const DAY_NAME: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

function formatMinute(minute: number) {
  const date = new Date();
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return dayjs(date).format('h:mm A');
}

function formatLanguages(languages: string[]) {
  return languages.map((item) => item.charAt(0).toUpperCase() + item.slice(1)).join(', ');
}

function formatAvailability(application: WarriorApplicationReview) {
  const slots = application.availability?.slots ?? [];
  if (!slots.length) return 'No times listed';
  return slots
    .map((slot) => `${DAY_NAME[slot.weekday] || slot.weekday} ${formatMinute(slot.start_minute)}–${formatMinute(slot.end_minute)}`)
    .join('\n');
}

export default function PrayerWarriorReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const applicationsQuery = useQuery({
    queryKey: ['prayer-warrior-applications'],
    queryFn: prayerWarriorApi.listApplications,
  });
  const applications = applicationsQuery.data?.data ?? [];
  const review = useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: 'accept' | 'decline' }) =>
      prayerWarriorApi.reviewApplication(userId, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prayer-warrior-applications'] }),
    onError: (error: Error) => Alert.alert('Could not update application', error.message),
  });

  function decide(application: WarriorApplicationReview, decision: 'accept' | 'decline') {
    const name = application.first_name || 'This person';
    const title = decision === 'accept' ? `Accept ${name}?` : `Decline ${name}?`;
    const message = decision === 'accept'
      ? 'They will be enrolled and can receive private prayer requests.'
      : 'They will not be enrolled as a prayer warrior.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: decision === 'accept' ? 'Accept' : 'Decline', style: decision === 'decline' ? 'destructive' : 'default', onPress: () => review.mutate({ userId: application.user_id, decision }) },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 96 }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 16 }}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 23 }}>Prayer warriors</Text>
      <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 }}>
        Accept an application to enroll them. Decline leaves them unenrolled.
      </Text>
      {applicationsQuery.isLoading ? (
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14 }}>Loading applications…</Text>
      ) : applicationsQuery.isError ? (
        <Text style={{ color: '#9a4034', ...iosFontStyle('500'), fontSize: 14 }}>
          {(applicationsQuery.error as Error).message || 'Could not load applications.'}
        </Text>
      ) : applications.length === 0 ? (
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14 }}>No applications are waiting.</Text>
      ) : applications.map((application) => {
        const busy = review.isPending && review.variables?.userId === application.user_id;
        return (
          <View key={application.user_id} style={{ backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 16, marginBottom: 12 }}>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 17 }}>{application.first_name || 'Applicant'}</Text>
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, marginTop: 6 }}>{formatLanguages(application.languages)}</Text>
            {application.church ? (
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, marginTop: 4 }}>{application.church}</Text>
            ) : null}
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 14, lineHeight: 20, marginTop: 10 }}>{application.note}</Text>
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, lineHeight: 18, marginTop: 10 }}>{formatAvailability(application)}</Text>
            {application.submitted_at ? (
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 8 }}>
                Applied {dayjs(application.submitted_at).format('MMM D, YYYY')}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Button label="Decline" variant="secondary" onPress={() => decide(application, 'decline')} disabled={busy} style={{ flex: 1 }} />
              <Button label="Accept" onPress={() => decide(application, 'accept')} isLoading={busy && review.variables?.decision === 'accept'} disabled={busy} style={{ flex: 1 }} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
