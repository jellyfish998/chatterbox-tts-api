import React, { useRef } from 'react';
import { X, Zap, Volume2, BookOpen, FileText, UploadCloud } from 'lucide-react';
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
  onIndexSelected?: (file: File) => void;
  onChaptersSelected?: (files: FileList) => void;
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
  onIndexSelected,
  onChaptersSelected
}: TextInputProps) {
  
  const indexInputRef = useRef<HTMLInputElement>(null);
  const chaptersInputRef = useRef<HTMLInputElement>(null);

  return (
    <Card className="">
      <CardContent>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground">
            {isAudiobookMode ? "Audiobook Batch Settings" : "Text to Convert"}
          </label>
          <div className="flex items-center gap-2">
            
            {/* Hidden inputs for Index and Chapters */}
            <input 
              type="file" 
              ref={indexInputRef} 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onIndexSelected) onIndexSelected(file);
                if (indexInputRef.current) indexInputRef.current.value = '';
              }} 
              accept=".json" 
              className="hidden" 
            />

            <input 
              type="file" 
              ref={chaptersInputRef} 
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0 && onChaptersSelected) onChaptersSelected(files);
                if (chaptersInputRef.current) chaptersInputRef.current.value = '';
              }} 
              accept=".json" 
              multiple 
              className="hidden" 
            />

            {/* Audiobook Dual Buttons */}
            {isAudiobookMode ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => indexInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-colors duration-200 font-medium"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  Upload index.json
                </button>
                <button
                  onClick={() => chaptersInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition-colors duration-200 font-medium"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  Upload Chapters
                </button>
              </div>
            ) : (
              <button
                onClick={() => chaptersInputRef.current?.click()}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition-colors duration-200"
              >
                <UploadCloud className="w-3 h-3" />
                Upload Script
              </button>
            )}

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

        {/* Hidden textarea when in audiobook mode to save space */}
        {!isAudiobookMode && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            className="w-full h-32 p-3 bg-transparent border-0 focus:ring-0 resize-none text-foreground placeholder:text-muted-foreground"
          />
        )}
      </CardContent>
    </Card>
  );
}