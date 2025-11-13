-- Make appointment_id nullable to allow direct chats with general physician
ALTER TABLE public.chat_rooms 
ALTER COLUMN appointment_id DROP NOT NULL;

-- Add index for better query performance on user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- Update RLS policies for chat_rooms to allow general physician chats
DROP POLICY IF EXISTS "Chat rooms are created automatically" ON public.chat_rooms;
DROP POLICY IF EXISTS "Users can view their own chat rooms" ON public.chat_rooms;

CREATE POLICY "Users can create chat rooms"
ON public.chat_rooms
FOR INSERT
WITH CHECK ((auth.uid() = patient_id) OR (auth.uid() = doctor_id));

CREATE POLICY "Users can view their own chat rooms"
ON public.chat_rooms
FOR SELECT
USING ((auth.uid() = patient_id) OR (auth.uid() = doctor_id));