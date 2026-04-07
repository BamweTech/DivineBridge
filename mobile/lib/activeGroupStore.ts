/**
 * Lightweight module-level tracker for the currently visible group screen.
 * Used to suppress chat notifications for the group the user is already viewing.
 */

let currentGroupId: string | null = null;

export function setActiveGroup(groupId: string | null): void {
  currentGroupId = groupId;
}

export function getActiveGroup(): string | null {
  return currentGroupId;
}
