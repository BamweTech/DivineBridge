/**
 * Must be imported before expo-notifications / expo-av / firebase.
 * RN 0.81 LogBox hides warning details and only shows "Open debugger to
 * view warnings"; these third-party messages otherwise reappear on resume.
 */
const SWALLOW = [
  'Expo AV has been deprecated',
  'aps-environment',
  'IndexedDB persistence',
  'user provided cache',
  'Listening to push token changes is not yet fully supported',
  'Error encountered while updating server registration',
  '"shadow*" style props are deprecated',
  'props.pointerEvents is deprecated',
];

function shouldSwallow(args: unknown[]): boolean {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a)))
    .join(' ');
  return SWALLOW.some((needle) => text.includes(needle));
}

if (__DEV__) {
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    if (!shouldSwallow(args)) origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    if (!shouldSwallow(args)) origError(...args);
  };
}
