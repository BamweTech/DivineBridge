import { useState, useCallback, useRef } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  type QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface PaginationOptions {
  collectionPath: string;
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  pageSize?: number;
  constraints?: QueryConstraint[];
}

/**
 * Cursor-based Firestore pagination hook.
 * Returns pages of documents with loadMore / refresh capabilities.
 */
export function usePaginatedFirestore<T extends DocumentData = DocumentData>({
  collectionPath,
  orderByField = 'created_at',
  orderDirection = 'desc',
  pageSize = 20,
  constraints = [],
}: PaginationOptions) {
  const [items, setItems] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);

  const fetchPage = useCallback(
    async (isRefresh = false) => {
      if (loading) return;
      setLoading(true);

      try {
        const colRef = collection(db, collectionPath);
        const queryConstraints: QueryConstraint[] = [
          ...constraints,
          orderBy(orderByField, orderDirection),
          limit(pageSize),
        ];

        if (!isRefresh && lastDocRef.current) {
          queryConstraints.push(startAfter(lastDocRef.current));
        }

        const q = query(colRef, ...queryConstraints);
        const snapshot = await getDocs(q);

        const newItems = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as T),
        }));

        if (snapshot.docs.length > 0) {
          lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
        }

        setHasMore(snapshot.docs.length >= pageSize);

        if (isRefresh) {
          setItems(newItems);
        } else {
          setItems((prev) => [...prev, ...newItems]);
        }
      } catch (err) {
        console.error('Pagination fetch error:', err);
      } finally {
        setLoading(false);
      }
    },
    [collectionPath, orderByField, orderDirection, pageSize, loading],
  );

  const loadMore = useCallback(() => {
    if (hasMore && !loading) fetchPage(false);
  }, [hasMore, loading, fetchPage]);

  const refresh = useCallback(() => {
    lastDocRef.current = null;
    setHasMore(true);
    fetchPage(true);
  }, [fetchPage]);

  return { items, loading, hasMore, loadMore, refresh };
}
