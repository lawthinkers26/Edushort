import { supabase } from '../lib/supabase';
import { decodeCursor, encodeCursor, keysetFilter } from '../utils/cursor';
import { fromDbError } from '../utils/httpError';

export interface CommentDto {
  id: string;
  reelId: string;
  body: string;
  createdAt: string;
  author: {
    uid: string;
    displayName: string;
  };
  isMine: boolean;
}

const COMMENT_SELECT = 'id, reel_id, user_id, body, created_at, author:profiles!reel_comments_user_id_fkey(display_name, email)';

interface CommentRowWithAuthor {
  id: string;
  reel_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author: { display_name: string | null; email: string | null } | null;
}

function authorName(row: CommentRowWithAuthor): string {
  if (row.author?.display_name) return row.author.display_name;
  const email = row.author?.email;
  if (email) return email.split('@')[0] ?? 'Learner';
  return 'Learner';
}

function toCommentDto(row: CommentRowWithAuthor, viewerUid: string): CommentDto {
  return {
    id: row.id,
    reelId: row.reel_id,
    body: row.body,
    createdAt: row.created_at,
    author: { uid: row.user_id, displayName: authorName(row) },
    isMine: row.user_id === viewerUid,
  };
}

export async function listComments(params: {
  reelId: string;
  viewerUid: string;
  cursor?: string;
  limit: number;
}): Promise<{ items: CommentDto[]; nextCursor: string | null }> {
  const cursor = decodeCursor(params.cursor);

  let query = supabase
    .from('reel_comments')
    .select(COMMENT_SELECT)
    .eq('reel_id', params.reelId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(params.limit + 1);

  if (cursor) query = query.or(keysetFilter(cursor));

  const { data, error } = await query.overrideTypes<CommentRowWithAuthor[], { merge: false }>();
  if (error) throw fromDbError(error, 'Loading comments');

  const hasMore = data.length > params.limit;
  const rows = hasMore ? data.slice(0, params.limit) : data;
  const last = rows.at(-1);

  return {
    items: rows.map((row) => toCommentDto(row, params.viewerUid)),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

/** Inserts a comment; the reels.comments_count trigger updates in the same txn. */
export async function addComment(params: { reelId: string; uid: string; body: string }): Promise<CommentDto> {
  const { data, error } = await supabase
    .from('reel_comments')
    .insert({ reel_id: params.reelId, user_id: params.uid, body: params.body })
    .select(COMMENT_SELECT)
    .single()
    .overrideTypes<CommentRowWithAuthor, { merge: false }>();

  if (error) throw fromDbError(error, 'Posting comment');
  return toCommentDto(data, params.uid);
}
