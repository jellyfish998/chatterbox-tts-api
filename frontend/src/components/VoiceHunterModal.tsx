import React, { useState } from 'react';
import { X, Globe, Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface VoiceHunterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtract: (url: string, startTime: number, duration: number, voiceName: string) => Promise<void>;
}

export default function VoiceHunterModal({ open, onOpenChange, onExtract }: VoiceHunterModalProps) {
  const [url, setUrl] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [duration, setDuration] = useState('10');
  const [voiceName, setVoiceName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  if (!open) return null;

  // Smart parser: Converts "1:15" or "01:15:30" or "75" into raw seconds
  const parseTime = (timeStr: string): number => {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':').reverse();
    let seconds = 0;
    for (let i = 0; i < parts.length; i++) {
      seconds += (parseInt(parts[i]) || 0) * Math.pow(60, i);
    }
    return seconds;
  };

  const handleExtract = async () => {
    if (!url || !voiceName) {
      alert("URL and Voice Name are required.");
      return;
    }

    setIsExtracting(true);
    try {
      const startSeconds = parseTime(timeInput);
      const durationSeconds = Number(duration) || 10;
      await onExtract(url, startSeconds, durationSeconds, voiceName);
      
      // Reset and close on success
      setUrl('');
      setTimeInput('');
      setVoiceName('');
      onOpenChange(false);
    } catch (err) {
      alert(`Extraction failed: ${err}`);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg p-6 relative">
        <button 
          onClick={() => onOpenChange(false)} 
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-6">
          <Globe className="w-5 h-5 text-red-500" />
          <h2 className="text-xl font-semibold">Voice Hunter</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">YouTube URL</label>
            <Input 
              placeholder="https://www.youtube.com/watch?v=..." 
              value={url} 
              onChange={(e) => setUrl(e.target.value)} 
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1 block">Start Time</label>
              <Input 
                placeholder="e.g., 1:15 or 75" 
                value={timeInput} 
                onChange={(e) => setTimeInput(e.target.value)} 
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1 block">Duration (s)</label>
              <Input 
                type="number"
                placeholder="10" 
                value={duration} 
                onChange={(e) => setDuration(e.target.value)} 
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">Save As (Character Name)</label>
            <Input 
              placeholder="e.g., Harley Quinn" 
              value={voiceName} 
              onChange={(e) => setVoiceName(e.target.value)} 
            />
          </div>

          <Button 
            onClick={handleExtract} 
            disabled={isExtracting || !url || !voiceName}
            className="w-full mt-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
          >
            {isExtracting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extracting & Isolating...</>
            ) : (
              'Hunt Voice'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}