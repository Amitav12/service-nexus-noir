
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ProviderProfile, VerificationDocument, DocumentType, VerificationStatus } from '@/types/verification';

const DOCUMENT_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: 'business_license', label: 'Business License' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'id_proof', label: 'Government ID' },
  { value: 'professional_certification', label: 'Professional Certifications' },
  { value: 'background_check', label: 'Background Check' }
];

const ProviderVerification = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});

  // Load provider profile and documents
  useEffect(() => {
    if (user?.id) {
      loadProviderData();
    }
  }, [user?.id]);

  const loadProviderData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Load provider profile
      const { data: profileData, error: profileError } = await supabase
        .from('provider_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Error loading provider profile:', profileError);
        throw profileError;
      }

      if (profileData) {
        setProfile(profileData as ProviderProfile);
      }

      // Load verification documents
      const { data: documentsData, error: documentsError } = await supabase
        .from('verification_documents')
        .select('*')
        .eq('provider_id', user.id)
        .order('created_at', { ascending: false });

      if (documentsError) {
        console.error('Error loading documents:', documentsError);
        throw documentsError;
      }

      setDocuments((documentsData || []) as VerificationDocument[]);
    } catch (error) {
      console.error('Error loading provider data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load verification data. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (documentType: DocumentType, file: File) => {
    if (!user?.id) return;

    try {
      setUploadingFiles(prev => ({ ...prev, [documentType]: true }));

      // Upload file to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${documentType}_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('verification-documents')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      // Save document record
      const { error: insertError } = await supabase
        .from('verification_documents')
        .insert({
          provider_id: user.id,
          document_type: documentType,
          file_name: file.name,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          verification_status: 'pending' as VerificationStatus
        });

      if (insertError) {
        console.error('Insert error:', insertError);
        throw insertError;
      }

      toast({
        title: 'Document Uploaded',
        description: `${file.name} has been uploaded successfully and is pending review.`
      });

      // Reload documents
      await loadProviderData();
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: 'Upload Failed',
        description: 'Failed to upload document. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setUploadingFiles(prev => ({ ...prev, [documentType]: false }));
    }
  };

  const getStatusIcon = (status: VerificationStatus) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: VerificationStatus) => {
    switch (status) {
      case 'approved':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'rejected':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }
  };

  const getOverallStatus = (): VerificationStatus => {
    if (!profile) return 'pending';
    return profile.verification_status;
  };

  const getRequiredDocuments = () => {
    const uploaded = new Set(documents.map(doc => doc.document_type));
    return DOCUMENT_TYPES.filter(type => !uploaded.has(type.value));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Verification Status Overview */}
      <Card className={`border-2 ${getStatusColor(getOverallStatus())}`}>
        <CardHeader>
          <div className="flex items-center gap-3">
            {getStatusIcon(getOverallStatus())}
            <div>
              <CardTitle className="text-xl">
                Verification Status: {getOverallStatus().charAt(0).toUpperCase() + getOverallStatus().slice(1)}
              </CardTitle>
              <CardDescription>
                {getOverallStatus() === 'pending' && 'Your verification is being reviewed by our team'}
                {getOverallStatus() === 'approved' && 'Your account is verified and you can start offering services'}
                {getOverallStatus() === 'rejected' && 'Please review the feedback and resubmit required documents'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Document Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Verification Documents</CardTitle>
          <CardDescription>
            Upload the required documents for account verification. All documents will be reviewed within 2-3 business days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Upload new documents */}
          {getRequiredDocuments().length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Required Documents</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getRequiredDocuments().map((docType) => (
                  <div key={docType.value} className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-teal-600 transition-colors">
                    <div className="text-center">
                      <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <h4 className="font-medium text-foreground">{docType.label}</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Upload your {docType.label.toLowerCase()}
                      </p>
                      <input
                        type="file"
                        id={`upload-${docType.value}`}
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleFileUpload(docType.value, file);
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uploadingFiles[docType.value]}
                        onClick={() => document.getElementById(`upload-${docType.value}`)?.click()}
                      >
                        {uploadingFiles[docType.value] ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Upload File
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Uploaded documents */}
          {documents.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Uploaded Documents</h3>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="font-medium text-foreground">{doc.file_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {DOCUMENT_TYPES.find(type => type.value === doc.document_type)?.label}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(doc.verification_status)}
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(doc.verification_status)}`}>
                        {doc.verification_status.charAt(0).toUpperCase() + doc.verification_status.slice(1)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {documents.length === 0 && (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No documents uploaded yet. Please upload the required documents to start the verification process.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProviderVerification;
