-- Create medical records table for storing test results and documents
CREATE TABLE public.medical_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  record_type TEXT NOT NULL, -- 'lab_result', 'imaging', 'document', 'vital_signs'
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  test_name TEXT,
  test_results JSONB,
  recorded_date DATE NOT NULL,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;

-- Patients can view their own medical records
CREATE POLICY "Patients can view their medical records"
ON public.medical_records
FOR SELECT
USING (auth.uid() = patient_id);

-- Doctors can view and create medical records for their patients
CREATE POLICY "Doctors can view medical records"
ON public.medical_records
FOR SELECT
USING (has_role(auth.uid(), 'doctor'::app_role));

CREATE POLICY "Doctors can create medical records"
ON public.medical_records
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'doctor'::app_role) AND auth.uid() = uploaded_by);

CREATE POLICY "Doctors can update medical records they uploaded"
ON public.medical_records
FOR UPDATE
USING (has_role(auth.uid(), 'doctor'::app_role) AND auth.uid() = uploaded_by);

-- Create AI insights table
CREATE TABLE public.ai_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  insight_type TEXT NOT NULL, -- 'health_trend', 'risk_assessment', 'recommendation'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low', -- 'low', 'medium', 'high'
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_read BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

-- Patients can view their own insights
CREATE POLICY "Patients can view their insights"
ON public.ai_insights
FOR SELECT
USING (auth.uid() = patient_id);

-- Patients can mark insights as read
CREATE POLICY "Patients can update their insights"
ON public.ai_insights
FOR UPDATE
USING (auth.uid() = patient_id);

-- Doctors can view and create insights for their patients
CREATE POLICY "Doctors can view all insights"
ON public.ai_insights
FOR SELECT
USING (has_role(auth.uid(), 'doctor'::app_role));

CREATE POLICY "Doctors can create insights"
ON public.ai_insights
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'doctor'::app_role));

-- Add indexes for better performance
CREATE INDEX idx_medical_records_patient ON public.medical_records(patient_id);
CREATE INDEX idx_medical_records_date ON public.medical_records(recorded_date DESC);
CREATE INDEX idx_ai_insights_patient ON public.ai_insights(patient_id);
CREATE INDEX idx_ai_insights_read ON public.ai_insights(is_read);