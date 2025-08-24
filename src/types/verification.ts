
// Verification-specific types that match the database enums exactly
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'under_review' | 'expired';
export type DocumentType = 'business_license' | 'insurance_certificate' | 'id_proof' | 'professional_certification' | 'background_check' | 'other';

export interface ProviderProfile {
  id: string;
  user_id: string;
  verification_status: VerificationStatus;
  business_name?: string;
  business_address?: string;
  business_phone?: string;
  business_email?: string;
  years_experience?: number;
  description?: string;
}

export interface VerificationDocument {
  id: string;
  provider_id: string;
  document_type: DocumentType;
  file_name: string;
  file_path: string;
  verification_status: VerificationStatus;
  admin_notes?: string;
  created_at: string;
  file_size?: number;
  mime_type?: string;
}

export interface ProviderApplication {
  id: string;
  user_id: string;
  business_name?: string;
  verification_status: VerificationStatus;
  created_at: string;
  profiles?: {
    first_name?: string;
    last_name?: string;
  };
  documents: VerificationDocument[];
}
