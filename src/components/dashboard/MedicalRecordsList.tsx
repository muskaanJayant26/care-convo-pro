import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Activity, Image, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';

interface MedicalRecord {
  id: string;
  record_type: string;
  title: string;
  description: string;
  test_name: string;
  test_results: any;
  recorded_date: string;
  created_at: string;
}

interface MedicalRecordsListProps {
  patientId: string;
}

const MedicalRecordsList = ({ patientId }: MedicalRecordsListProps) => {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecords();
  }, [patientId]);

  const fetchRecords = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', patientId)
      .order('recorded_date', { ascending: false });

    if (error) {
      console.error('Error fetching medical records:', error);
    } else {
      setRecords(data || []);
    }
    setLoading(false);
  };

  const getRecordIcon = (type: string) => {
    switch (type) {
      case 'lab_result':
        return <Activity className="w-5 h-5 text-primary" />;
      case 'imaging':
        return <Image className="w-5 h-5 text-secondary" />;
      case 'vital_signs':
        return <Stethoscope className="w-5 h-5 text-accent" />;
      default:
        return <FileText className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getRecordTypeBadge = (type: string) => {
    const variants: Record<string, any> = {
      lab_result: 'default',
      imaging: 'secondary',
      vital_signs: 'outline',
      document: 'outline',
    };
    return variants[type] || 'default';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">No medical records found</p>
          <p className="text-sm text-muted-foreground mt-2">
            Medical records will appear here once uploaded by your doctor
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {records.map((record) => (
        <Card key={record.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-muted/50">
                {getRecordIcon(record.record_type)}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-lg">{record.title}</h3>
                  <Badge variant={getRecordTypeBadge(record.record_type)}>
                    {record.record_type.replace('_', ' ')}
                  </Badge>
                </div>
                {record.description && (
                  <p className="text-muted-foreground text-sm mb-3">{record.description}</p>
                )}
                {record.test_name && (
                  <div className="mb-2">
                    <span className="text-sm font-medium">Test: </span>
                    <span className="text-sm text-muted-foreground">{record.test_name}</span>
                  </div>
                )}
                {record.test_results && (
                  <div className="bg-muted/30 p-3 rounded-md mb-3">
                    <pre className="text-xs whitespace-pre-wrap">
                      {JSON.stringify(record.test_results, null, 2)}
                    </pre>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Recorded: {format(new Date(record.recorded_date), 'MMM dd, yyyy')}</span>
                  <span>•</span>
                  <span>Added: {format(new Date(record.created_at), 'MMM dd, yyyy')}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default MedicalRecordsList;
