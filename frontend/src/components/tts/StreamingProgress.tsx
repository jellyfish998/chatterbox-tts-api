import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Loader2, StopCircle, Trash2 } from 'lucide-react';

interface StreamingProgressProps {
  isStreaming: boolean;
  progress: any | null; 
  audioUrl: string | null;
  error: string | null;
  audioInfo: any | null;
  onStop: () => void;
  onClear: () => void;
}

export default function StreamingProgress({
  isStreaming,
  progress,
  audioUrl,
  error,
  audioInfo,
  onStop,
  onClear
}: StreamingProgressProps) {
  
  if (!isStreaming && !progress && !audioUrl && !error) return null;

  return (
    <Card className="w-full mt-4 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            {isStreaming && <Loader2 className="w-4 h-4 animate-spin" />}
            {isStreaming ? "Streaming Audio..." : "Stream Complete"}
          </div>
          <div className="flex gap-2">
            {isStreaming && (
              <Button variant="destructive" size="sm" onClick={onStop}>
                <StopCircle className="w-4 h-4 mr-1" /> Stop
              </Button>
            )}
            {!isStreaming && (audioUrl || error) && (
              <Button variant="outline" size="sm" onClick={onClear}>
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {progress && (
          <div className="text-xs text-muted-foreground flex gap-4">
            <span>Chunks: {progress.chunksReceived || 0}</span>
            <span>Bytes: {progress.totalBytes || 0}</span>
          </div>
        )}
        
        {audioUrl && (
          <audio controls className="w-full mt-4" src={audioUrl} />
        )}
        
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}