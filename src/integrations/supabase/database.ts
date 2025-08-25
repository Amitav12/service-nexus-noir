
/**
 * Lightweight Supabase Database type used for typing the Supabase client and table operations.
 * This intentionally includes only the tables and enums referenced in the current codebase.
 * Extend as needed.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      bookings: {
        Row: {
          id: string;
          customer_id: string;
          provider_user_id: string;
          service_id: string;
          status:
            | 'pending'
            | 'accepted'
            | 'in_progress'
            | 'completed'
            | 'cancelled'
            | 'disputed'
            | 'confirmed';
          service_date: string;
          duration_minutes: number | null;
          final_price: number;
          platform_fee: number;
          provider_earnings: number;
          special_instructions: string | null;
          service_address: string;
          service_city: string;
          service_state: string;
          service_zip: string | null;
          booking_number: string;
          created_at: string;
          updated_at: string;
          completed_at?: string | null;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          cancellation_fee?: number | null;
          refund_amount?: number | null;
        };
        Insert: {
          customer_id: string;
          provider_user_id: string;
          service_id: string;
          status?:
            | 'pending'
            | 'accepted'
            | 'in_progress'
            | 'completed'
            | 'cancelled'
            | 'disputed'
            | 'confirmed';
          service_date: string;
          duration_minutes?: number | null;
          final_price: number;
          platform_fee?: number;
          provider_earnings?: number;
          special_instructions?: string | null;
          service_address: string;
          service_city: string;
          service_state: string;
          service_zip?: string | null;
          booking_number: string;
          confirmed_at?: string | null;
          // Allow additional fields without being overly strict
          [key: string]: unknown;
        };
        Update: Partial<{
          status:
            | 'pending'
            | 'accepted'
            | 'in_progress'
            | 'completed'
            | 'cancelled'
            | 'disputed'
            | 'confirmed';
          confirmed_at: string | null;
          cancelled_at: string | null;
          completed_at: string | null;
          cancellation_fee: number | null;
          refund_amount: number | null;
          updated_at: string;
          // Allow additional fields without being overly strict
          [key: string]: unknown;
        }>;
      };
      payments: {
        Row: {
          id: string;
          amount: number;
          payment_status: 'pending' | 'completed' | 'failed' | 'refunded' | 'disputed';
          stripe_session_id?: string | null;
          booking_id?: string | null;
          provider_user_id?: string | null;
          updated_at?: string | null;
        };
        Insert: { [key: string]: unknown };
        Update: { [key: string]: unknown };
      };
      services: {
        Row: {
          id: string;
          provider_id: string;
          title: string;
        };
        Insert: { [key: string]: unknown };
        Update: { [key: string]: unknown };
      };
      provider_profiles: {
        Row: {
          user_id: string;
          verification_status: 'pending' | 'approved' | 'rejected' | 'under_review' | 'expired';
        };
        Insert: { [key: string]: unknown };
        Update: { [key: string]: unknown };
      };
    };
    Views: {
      [key: string]: unknown;
    };
    Functions: {
      [key: string]: unknown;
    };
    Enums: {
      booking_status:
        | 'pending'
        | 'accepted'
        | 'in_progress'
        | 'completed'
        | 'cancelled'
        | 'disputed'
        | 'confirmed';
    };
  };
}

