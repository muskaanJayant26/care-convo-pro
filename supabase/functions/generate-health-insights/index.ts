import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { patientId } = await req.json();
    console.log("Generating health insights for patient:", patientId);

    if (!patientId) {
      return new Response(
        JSON.stringify({ error: "Patient ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch patient data
    const [consultationsRes, recordsRes, prescriptionsRes] = await Promise.all([
      supabase
        .from("consultations")
        .select(`
          doctor_notes,
          created_at,
          appointments!inner(patient_id)
        `)
        .eq("appointments.patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10),
      
      supabase
        .from("medical_records")
        .select("*")
        .eq("patient_id", patientId)
        .order("recorded_date", { ascending: false })
        .limit(10),
      
      supabase
        .from("prescriptions")
        .select(`
          medication_name,
          dosage,
          frequency,
          created_at,
          consultations!inner(
            appointments!inner(patient_id)
          )
        `)
        .eq("consultations.appointments.patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    console.log("Patient data fetched successfully");

    // Prepare context for AI
    const context = {
      consultations: consultationsRes.data || [],
      medical_records: recordsRes.data || [],
      prescriptions: prescriptionsRes.data || [],
    };

    // Generate AI insights using Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a medical AI assistant analyzing patient health data. Generate 3-5 actionable health insights based on the patient's medical history, consultations, and records. For each insight, provide:
1. A clear title (max 60 chars)
2. Detailed content (2-3 sentences)
3. Insight type: 'health_trend', 'risk_assessment', or 'recommendation'
4. Severity: 'low', 'medium', or 'high'

Focus on: patterns in symptoms, medication adherence, preventive care, lifestyle recommendations, and follow-up needs.`
          },
          {
            role: "user",
            content: `Analyze this patient data and generate health insights:\n\n${JSON.stringify(context, null, 2)}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_insights",
              description: "Generate health insights for a patient",
              parameters: {
                type: "object",
                properties: {
                  insights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        content: { type: "string" },
                        insight_type: { 
                          type: "string",
                          enum: ["health_trend", "risk_assessment", "recommendation"]
                        },
                        severity: {
                          type: "string",
                          enum: ["low", "medium", "high"]
                        }
                      },
                      required: ["title", "content", "insight_type", "severity"]
                    }
                  }
                },
                required: ["insights"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "generate_insights" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response received");

    // Extract insights from tool call
    const toolCall = aiData.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No insights generated");
    }

    const { insights } = JSON.parse(toolCall.function.arguments);
    console.log(`Generated ${insights.length} insights`);

    // Store insights in database
    const insightsToInsert = insights.map((insight: any) => ({
      patient_id: patientId,
      insight_type: insight.insight_type,
      title: insight.title,
      content: insight.content,
      severity: insight.severity,
    }));

    const { error: insertError } = await supabase
      .from("ai_insights")
      .insert(insightsToInsert);

    if (insertError) {
      console.error("Error inserting insights:", insertError);
      throw insertError;
    }

    console.log("Insights stored successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        insights_generated: insights.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error generating insights:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
