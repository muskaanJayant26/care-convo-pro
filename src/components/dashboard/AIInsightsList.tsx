import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brain, Sparkles, AlertTriangle, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface AIInsight {
  id: string;
  insight_type: string;
  title: string;
  content: string;
  severity: string;
  generated_at: string;
  is_read: boolean;
}

interface AIInsightsListProps {
  patientId: string;
}

const AIInsightsList = ({ patientId }: AIInsightsListProps) => {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchInsights();
  }, [patientId]);

  const fetchInsights = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_insights')
      .select('*')
      .eq('patient_id', patientId)
      .order('generated_at', { ascending: false });

    if (error) {
      console.error('Error fetching insights:', error);
    } else {
      setInsights(data || []);
    }
    setLoading(false);
  };

  const generateInsights = async () => {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke('generate-health-insights', {
        body: { patientId }
      });

      if (error) throw error;

      toast({
        title: 'AI Insights Generated',
        description: 'New health insights have been generated successfully',
      });
      
      await fetchInsights();
    } catch (error: any) {
      console.error('Error generating insights:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate insights',
        variant: 'destructive'
      });
    } finally {
      setGenerating(false);
    }
  };

  const markAsRead = async (insightId: string) => {
    await supabase
      .from('ai_insights')
      .update({ is_read: true })
      .eq('id', insightId);
    
    setInsights(insights.map(i => 
      i.id === insightId ? { ...i, is_read: true } : i
    ));
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'health_trend':
        return <TrendingUp className="w-5 h-5" />;
      case 'risk_assessment':
        return <AlertTriangle className="w-5 h-5" />;
      case 'recommendation':
        return <Sparkles className="w-5 h-5" />;
      default:
        return <Brain className="w-5 h-5" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-full"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AI-Powered Health Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Get personalized health insights powered by AI based on your medical history and records
          </p>
          <Button 
            onClick={generateInsights} 
            disabled={generating}
            className="w-full"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {generating ? 'Generating Insights...' : 'Generate New Insights'}
          </Button>
        </CardContent>
      </Card>

      {insights.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No AI insights yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Click "Generate New Insights" to get personalized health recommendations
            </p>
          </CardContent>
        </Card>
      ) : (
        insights.map((insight) => (
          <Card 
            key={insight.id} 
            className={`hover:shadow-md transition-shadow ${!insight.is_read ? 'border-primary/30' : ''}`}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg ${
                  insight.severity === 'high' ? 'bg-destructive/10' :
                  insight.severity === 'medium' ? 'bg-primary/10' :
                  'bg-secondary/10'
                }`}>
                  {getInsightIcon(insight.insight_type)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">{insight.title}</h3>
                    <Badge variant={getSeverityColor(insight.severity)}>
                      {insight.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{insight.content}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(insight.generated_at), 'MMM dd, yyyy')}
                    </span>
                    {!insight.is_read && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => markAsRead(insight.id)}
                      >
                        Mark as Read
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default AIInsightsList;
