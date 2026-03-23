import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '@/lib/firebase';
import type { GroupChatAttachment } from '@/types';

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadGroupChatFile(
  groupId: string,
  blob: Blob,
  contentType: string,
  fileName: string
): Promise<GroupChatAttachment> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  if (blob.size > MAX_BYTES) throw new Error('File must be 10 MB or smaller');
  if (!contentType.startsWith('image/') && contentType !== 'application/pdf') {
    throw new Error('Only photos and PDF files are allowed');
  }

  const ext = (fileName.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const safeTail = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = `group_chat_uploads/${groupId}/${uid}/${safeTail}`;
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType });
  const url = await getDownloadURL(r);
  const safeName = fileName.slice(0, 200) || `file.${ext}`;
  return {
    url,
    content_type: contentType,
    file_name: safeName,
    size_bytes: blob.size,
  };
}
