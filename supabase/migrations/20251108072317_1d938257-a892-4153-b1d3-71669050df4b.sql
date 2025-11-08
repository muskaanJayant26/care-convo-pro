-- Create chat_rooms table to track conversations
CREATE TABLE public.chat_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL,
  doctor_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(appointment_id)
);

-- Create messages table for chat messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chat_rooms
CREATE POLICY "Users can view their own chat rooms"
ON public.chat_rooms
FOR SELECT
USING (auth.uid() = patient_id OR auth.uid() = doctor_id);

CREATE POLICY "Chat rooms are created automatically"
ON public.chat_rooms
FOR INSERT
WITH CHECK (auth.uid() = patient_id OR auth.uid() = doctor_id);

-- RLS Policies for messages
CREATE POLICY "Users can view messages in their chat rooms"
ON public.messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = chat_room_id
    AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
  )
);

CREATE POLICY "Users can send messages in their chat rooms"
ON public.messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE id = chat_room_id
    AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
  )
);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;