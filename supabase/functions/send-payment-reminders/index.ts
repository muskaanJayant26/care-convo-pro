import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting payment reminder check...');

    // Calculate the timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Find confirmed appointments with pending payments that were confirmed more than 24 hours ago
    const { data: appointments, error: fetchError } = await supabase
      .from('appointments')
      .select(`
        id,
        patient_id,
        updated_at,
        patient:profiles!appointments_patient_id_fkey(full_name),
        payments(id, amount, status)
      `)
      .eq('status', 'confirmed')
      .lt('updated_at', twentyFourHoursAgo.toISOString());

    if (fetchError) {
      console.error('Error fetching appointments:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${appointments?.length || 0} confirmed appointments updated more than 24h ago`);

    // Filter appointments with pending payments
    const appointmentsWithPendingPayments = appointments?.filter(
      apt => apt.payments && apt.payments.length > 0 && apt.payments[0].status === 'pending'
    ) || [];

    console.log(`${appointmentsWithPendingPayments.length} have pending payments`);

    // Send reminder notifications
    let remindersSent = 0;
    for (const apt of appointmentsWithPendingPayments) {
      const payment = apt.payments![0];
      
      // Check if we already sent a reminder recently (within last 23 hours to avoid spam)
      const { data: recentNotifications } = await supabase
        .from('notifications')
        .select('created_at')
        .eq('user_id', apt.patient_id)
        .eq('title', 'Payment Reminder')
        .gte('created_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentNotifications && recentNotifications.length > 0) {
        console.log(`Skipping reminder for patient ${apt.patient_id} - already sent recently`);
        continue;
      }

      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: apt.patient_id,
          title: 'Payment Reminder',
          message: `Reminder: You have a pending payment of $${payment.amount.toFixed(2)} for your confirmed appointment. Please complete the payment at your earliest convenience.`,
        });

      if (notificationError) {
        console.error(`Error sending reminder to patient ${apt.patient_id}:`, notificationError);
      } else {
        remindersSent++;
        console.log(`Sent payment reminder to patient ${apt.patient_id}`);
      }
    }

    console.log(`Payment reminder check complete. Sent ${remindersSent} reminders.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        remindersSent,
        appointmentsChecked: appointments?.length || 0
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Error in send-payment-reminders function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
