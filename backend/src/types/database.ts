/**
 * Supabase schema types for EduShorts.
 *
 * Mirrors supabase/migrations/20260925000000_init_schema.sql in the exact shape
 * produced by `supabase gen types typescript`, so it can be regenerated with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export const REEL_CATEGORIES = ['History', 'Polity', 'Geography', 'Science'] as const;
export type ReelCategory = (typeof REEL_CATEGORIES)[number];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          firebase_uid: string;
          email: string | null;
          display_name: string | null;
          subscription_status: boolean;
          subscription_expires_at: string | null;
          razorpay_subscription_id: string | null;
          razorpay_subscription_state: string | null;
          subscription_event_at: string | null;
          free_reels_watched_count: number;
          liked_reels: string[];
          saved_reels: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          firebase_uid: string;
          email?: string | null;
          display_name?: string | null;
          subscription_status?: boolean;
          subscription_expires_at?: string | null;
          razorpay_subscription_id?: string | null;
          razorpay_subscription_state?: string | null;
          subscription_event_at?: string | null;
          free_reels_watched_count?: number;
          liked_reels?: string[];
          saved_reels?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          firebase_uid?: string;
          email?: string | null;
          display_name?: string | null;
          subscription_status?: boolean;
          subscription_expires_at?: string | null;
          razorpay_subscription_id?: string | null;
          razorpay_subscription_state?: string | null;
          subscription_event_at?: string | null;
          free_reels_watched_count?: number;
          liked_reels?: string[];
          saved_reels?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reels: {
        Row: {
          id: string;
          bunny_video_id: string;
          bunny_library_id: string;
          title: string;
          description: string;
          category: ReelCategory;
          likes_count: number;
          comments_count: number;
          views_count: number;
          duration_seconds: number | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bunny_video_id: string;
          bunny_library_id: string;
          title: string;
          description?: string;
          category: ReelCategory;
          likes_count?: number;
          comments_count?: number;
          views_count?: number;
          duration_seconds?: number | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bunny_video_id?: string;
          bunny_library_id?: string;
          title?: string;
          description?: string;
          category?: ReelCategory;
          likes_count?: number;
          comments_count?: number;
          views_count?: number;
          duration_seconds?: number | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      system_config: {
        Row: {
          id: number;
          free_reel_limit: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          free_reel_limit?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          free_reel_limit?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      reel_views: {
        Row: {
          user_id: string;
          reel_id: string;
          first_viewed_at: string;
        };
        Insert: {
          user_id: string;
          reel_id: string;
          first_viewed_at?: string;
        };
        Update: {
          user_id?: string;
          reel_id?: string;
          first_viewed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reel_views_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['firebase_uid'];
          },
          {
            foreignKeyName: 'reel_views_reel_id_fkey';
            columns: ['reel_id'];
            isOneToOne: false;
            referencedRelation: 'reels';
            referencedColumns: ['id'];
          },
        ];
      };
      reel_comments: {
        Row: {
          id: string;
          reel_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          reel_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          reel_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reel_comments_reel_id_fkey';
            columns: ['reel_id'];
            isOneToOne: false;
            referencedRelation: 'reels';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reel_comments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['firebase_uid'];
          },
        ];
      };
      payment_webhook_events: {
        Row: {
          event_id: string;
          event_type: string;
          firebase_uid: string | null;
          payload: Json;
          received_at: string;
        };
        Insert: {
          event_id: string;
          event_type: string;
          firebase_uid?: string | null;
          payload: Json;
          received_at?: string;
        };
        Update: {
          event_id?: string;
          event_type?: string;
          firebase_uid?: string | null;
          payload?: Json;
          received_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      increment_reel_view: {
        Args: { p_firebase_uid: string; p_reel_id: string };
        Returns: {
          status: 'OK' | 'LIMIT_REACHED';
          watched_count: number;
          reel_limit: number;
          subscribed: boolean;
          counted: boolean;
        }[];
      };
      set_reel_like: {
        Args: { p_firebase_uid: string; p_reel_id: string; p_liked: boolean };
        Returns: { is_liked: boolean; total_likes: number }[];
      };
      set_reel_save: {
        Args: { p_firebase_uid: string; p_reel_id: string; p_saved: boolean };
        Returns: boolean;
      };
      apply_subscription_event: {
        Args: {
          p_firebase_uid: string;
          p_subscription_id: string;
          p_active: boolean;
          p_expires_at: string | null;
          p_razorpay_state: string;
          p_event_at: string | null;
        };
        Returns: boolean;
      };
      is_subscription_active: {
        Args: { p_status: boolean; p_expires_at: string | null };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];

export type ProfileRow = Tables<'profiles'>;
export type ReelRow = Tables<'reels'>;
export type SystemConfigRow = Tables<'system_config'>;
export type ReelCommentRow = Tables<'reel_comments'>;
