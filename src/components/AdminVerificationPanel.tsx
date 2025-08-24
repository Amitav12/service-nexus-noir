
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, CheckCircle, XCircle, Clock, Download, Eye, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ProviderApplication, VerificationDocument, VerificationStatus, DocumentType } from '@/types/verification';

const DOCUMENT_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: 'business_license', label: 'Business License' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'id_proof', label: 'Government ID' },
  { value: 'professional_certification', label: 'Professional Certifications' },
  { value: 'background_check', label: 'Background Check' }
];

const AdminVerificationPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [applications, setApplications] = useState<ProviderApplication[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    loadApplications();
  }, []);

  const loadApplications = async () => {
    try {
      setLoading(true);

      // Load provider profiles with documents
      const { data: providersData, error: providersError } = await supabase
        .from('provider_profiles')
        .select(`
          *,
          profiles!inner(first_name, last_name)
        `)
        .order('created_at', { ascending: false });

      if (providersError) {
        console.error('Error loading providers:', providersError);
        throw providersError;
      }

      // Load documents for each provider
      const providersWithDocs = await Promise.all(
        (providersData || []).map(async (provider) => {
          const { data: documentsData } = await supabase
            .from('verification_documents')
            .select('*')
            .eq('provider_id', provider.user_id)
            .order('created_at', { ascending: false });

          return {
            ...provider,
            documents: (documentsData || []) as VerificationDocument[]
          } as ProviderApplication;
        })
      );

      setApplications(providersWithDocs);
    } catch (error) {
      console.error('Error loading applications:', error);
      toast({
        title: 'Error',
        description: 'Failed to load verification applications.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleProviderStatusUpdate = async (providerId: string, status: 'approved' | 'rejected', notes?: string) => {
    try {
      const { error } = await supabase
        .from('provider_profiles')
        .update({
          verification_status: status as VerificationStatus,
          verified_at: status === 'approved' ? new Date().toISOString() : null
        })
        .eq('user_id', providerId);

      if (error) throw error;

      // Add verification note
      if (notes) {
        await supabase
          .from('verification_notes')
          .insert({
            provider_id: providerId,
            admin_id: user?.id,
            note: notes,
            is_internal: false
          });
      }

      toast({
        title: 'Status Updated',
        description: `Provider has been ${status}.`
      });

      // Reload applications
      await loadApplications();
      setSelectedApplication(null);
      setReviewNotes('');
    } catch (error) {
      console.error('Error updating provider status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update provider status.',
        variant: 'destructive'
      });
    }
  };

  const handleDocumentStatusUpdate = async (documentId: string, status: 'approved' | 'rejected', notes?: string) => {
    try {
      const { error } = await supabase
        .from('verification_documents')
        .update({
          verification_status: status as VerificationStatus,
          admin_notes: notes,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id
        })
        .eq('id', documentId);

      if (error) throw error;

      toast({
        title: 'Document Updated',
        description: `Document has been ${status}.`
      });

      // Reload applications
      await loadApplications();
    } catch (error) {
      console.error('Error updating document:', error);
      toast({
        title: 'Error',
        description: 'Failed to update document status.',
        variant: 'destructive'
      });
    }
  };

  const downloadDocument = async (filePath: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('verification-documents')
        .download(filePath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading document:', error);
      toast({
        title: 'Download Failed',
        description: 'Failed to download document.',
        variant: 'destructive'
      });
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

  const pendingApplications = applications.filter(app => app.verification_status === 'pending');
  const approvedApplications = applications.filter(app => app.verification_status === 'approved');
  const rejectedApplications = applications.filter(app => app.verification_status === 'rejected');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Provider Verification</h1>
        <p className="text-muted-foreground">Review and manage provider verification applications</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending">
            Pending ({pendingApplications.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({approvedApplications.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({rejectedApplications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          <div className="space-y-4">
            {pendingApplications.map((application) => (
              <Card key={application.id} className="border-2 border-yellow-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {getStatusIcon(application.verification_status)}
                        {application.business_name || 'Business Name Not Set'}
                      </CardTitle>
                      <CardDescription>
                        {application.profiles?.first_name} {application.profiles?.last_name} • 
                        Applied {new Date(application.created_at).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedApplication(selectedApplication === application.id ? null : application.id)}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      {selectedApplication === application.id ? 'Hide Details' : 'Review'}
                    </Button>
                  </div>
                </CardHeader>
                
                {selectedApplication === application.id && (
                  <CardContent className="border-t border-border">
                    <div className="space-y-6">
                      {/* Documents */}
                      <div>
                        <h4 className="font-semibold mb-3">Documents ({application.documents.length})</h4>
                        {application.documents.length === 0 ? (
                          <p className="text-muted-foreground">No documents uploaded</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {application.documents.map((doc) => (
                              <div key={doc.id} className="border rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-gray-500" />
                                    <span className="font-medium text-sm">{doc.document_type.replace('_', ' ')}</span>
                                  </div>
                                  {getStatusIcon(doc.verification_status)}
                                </div>
                                <p className="text-xs text-muted-foreground mb-2">{doc.file_name}</p>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => downloadDocument(doc.file_path, doc.file_name)}
                                  >
                                    <Download className="w-3 h-3 mr-1" />
                                    Download
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDocumentStatusUpdate(doc.id, 'approved')}
                                  >
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => handleDocumentStatusUpdate(doc.id, 'rejected', 'Document rejected by admin')}
                                  >
                                    <XCircle className="w-3 h-3 mr-1" />
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Review Actions */}
                      <div>
                        <Label htmlFor="reviewNotes">Review Notes</Label>
                        <Textarea
                          id="reviewNotes"
                          placeholder="Add notes for the provider..."
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          className="mt-2"
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          onClick={() => handleProviderStatusUpdate(application.user_id, 'approved', reviewNotes)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve Provider
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleProviderStatusUpdate(application.user_id, 'rejected', reviewNotes)}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reject Provider
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
            {pendingApplications.length === 0 && (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No pending applications to review.</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="approved" className="mt-6">
          <div className="space-y-4">
            {approvedApplications.map((application) => (
              <Card key={application.id} className="border-2 border-green-200">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(application.verification_status)}
                    <div>
                      <CardTitle>{application.business_name || 'Business Name Not Set'}</CardTitle>
                      <CardDescription>
                        {application.profiles?.first_name} {application.profiles?.last_name} • 
                        Approved
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
            {approvedApplications.length === 0 && (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No approved providers yet.</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="rejected" className="mt-6">
          <div className="space-y-4">
            {rejectedApplications.map((application) => (
              <Card key={application.id} className="border-2 border-red-200">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(application.verification_status)}
                    <div>
                      <CardTitle>{application.business_name || 'Business Name Not Set'}</CardTitle>
                      <CardDescription>
                        {application.profiles?.first_name} {application.profiles?.last_name} • 
                        Rejected
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
            {rejectedApplications.length === 0 && (
              <div className="text-center py-8">
                <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No rejected applications.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminVerificationPanel;
