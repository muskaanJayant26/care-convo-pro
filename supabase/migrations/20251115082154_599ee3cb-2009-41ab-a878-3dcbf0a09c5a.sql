-- Create video_calls table to track video call sessions
CREATE TABLE public.video_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  started_by UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.video_calls ENABLE ROW LEVEL SECURITY;

-- Patients and doctors can view video calls for their chat rooms
CREATE POLICY "Users can view their own video calls"
ON public.video_calls FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE chat_rooms.id = video_calls.chat_room_id
    AND (chat_rooms.patient_id = auth.uid() OR chat_rooms.doctor_id = auth.uid())
  )
);

-- Users can create video calls for their chat rooms
CREATE POLICY "Users can create video calls"
ON public.video_calls FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE chat_rooms.id = video_calls.chat_room_id
    AND (chat_rooms.patient_id = auth.uid() OR chat_rooms.doctor_id = auth.uid())
  )
  AND started_by = auth.uid()
);

-- Users can update video calls they participate in
CREATE POLICY "Users can update their video calls"
ON public.video_calls FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE chat_rooms.id = video_calls.chat_room_id
    AND (chat_rooms.patient_id = auth.uid() OR chat_rooms.doctor_id = auth.uid())
  )
);

-- Enable realtime for video_calls
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_calls;

-- Create index for performance
CREATE INDEX idx_video_calls_chat_room ON public.video_calls(chat_room_id);
CREATE INDEX idx_video_calls_status ON public.video_calls(status);