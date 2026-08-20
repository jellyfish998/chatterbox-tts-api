import React, { useRef } from 'react';
import { X, Zap, Volume2, BookOpen, FileText, UploadCloud } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { Card, CardContent } from '../ui/card';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  hasText: boolean;
  maxLength?: number;
  placeholder?: string;
  isStreamingEnabled?: boolean;
  onToggleStreaming?: () => void;
  isAudiobookMode?: boolean;
  onToggleAudiobookMode?: () => void;
  onFilesSelected?: (files: FileList) => void; // <--- NEW PROP
}

export default function TextInput({
  value,
  onChange,
  onClear,
  hasText,
  maxLength = 3000,
  placeholder = "Enter the text you want to convert to speech...",
  isStreamingEnabled = false,
  onToggleStreaming,
  isAudiobookMode = false,
  onToggleAudiobookMode,
  onFilesSelected
}: TextInputProps) {
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!isAudiobookMode) {
      // Standard Mode: Just read the first file as plain text
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onChange(event.target.result as string);
        }
      };
      reader.readAsText(file);
    } else {
      // Audiobook Mode: Pass the files up to TTSPage to handle the heavy lifting
      if (onFilesSelected) {
          onFilesSelected(files);
      }
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className="">
      <CardContent>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground">
            {isAudiobookMode ? "Audiobook Batch Settings" : "Text to Convert"}
          </label>
          <div className="flex items-center gap-2">
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".txt,.json" 
              multiple 
              className="hidden" 
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition-colors duration-200"
            >
              <UploadCloud className="w-3 h-3" />
              {isAudiobookMode ? "Upload Script Batch" : "Upload Script"}
            </button>

            {onToggleAudiobookMode && (
              <button
                onClick={onToggleAudiobookMode}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors duration-200 ${isAudiobookMode
                  ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30 dark:text-blue-400'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 border border-border'
                  }`}
              >
                {isAudiobookMode ? <BookOpen className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {isAudiobookMode ? 'Audiobook Mode' : 'Standard Mode'}
              </button>
            )}

            {onToggleStreaming && !isAudiobookMode && (
              <button
                onClick={onToggleStreaming}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors duration-200 ${isStreamingEnabled
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 border border-border'
                  }`}
              >
                {isStreamingEnabled ? <Zap className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                {isStreamingEnabled ? 'Streaming' : 'Standard'}
              </button>
            )}
            
            {hasText && (
              <button
                onClick={onClear}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive duration-300"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* The Textarea is completely hidden in Audiobook mode to prevent user meddling */}
        {!isAudiobookMode && (
            <>
                <Textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-32 font-mono text-sm"
                placeholder={placeholder}
                />
                <div className="text-right text-sm text-muted-foreground mt-1">
                {value.length}/{maxLength} characters
                </div>
            </>
        )}
      </CardContent>
    </Card>
  );
}