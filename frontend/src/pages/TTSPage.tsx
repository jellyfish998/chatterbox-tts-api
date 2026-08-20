import React, { useState, useMemo } from 'react';
import { Volume2, User, Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  ApiEndpointSelector,
  TextInput,
  AdvancedSettings,
  AudioPlayer,
  LongTextHistory
} from '../components/tts';

import VoiceLibrary from '../components/VoiceLibrary';
import AudioHistory from '../components/AudioHistory';
import StatusHeader from '../components/StatusHeader';
import StatusProgressOverlay from '../components/StatusProgressOverlay';
import StatusStatisticsPanel from '../components/StatusStatisticsPanel';
import StreamingProgressComponent from '../components/tts/StreamingProgress';
import LongTextProgress from '../components/tts/LongTextProgress';
import LongTextJobs from '../components/tts/LongTextJobs';
import { createTTSService } from '../services/tts';
import { createLongTextTTSService } from '../services/longTextTTS';
import { useApiEndpoint } from '../hooks/useApiEndpoint';
import { useVoiceLibrary } from '../hooks/useVoiceLibrary';
import { useAudioHistory } from '../hooks/useAudioHistory';
import { useAdvancedSettings } from '../hooks/useAdvancedSettings';
import { useTextInput } from '../hooks/useTextInput';
import { useStatusMonitoring } from '../hooks/useStatusMonitoring';
import { useProgressSettings } from '../hooks/useProgressSettings';
import { useDefaultVoice } from '../hooks/useDefaultVoice';
import { useStreamingTTS } from '../hooks/useStreamingTTS';
import { useLongTextTTS } from '../hooks/useLongTextTTS';
import { useLongTextHistory } from '../hooks/useLongTextHistory';
import { useHistoryTab } from '../hooks/useHistoryTab';
import type { TTSRequest, LongTextRequest } from '../types';

interface CastMember {
  character: string;
  voice_comment?: string;
  celebrity?: string;
}

export default function TTSPage() {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isClickedGenerating, setIsClickedGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);

  // API endpoint management
  const { apiBaseUrl, updateApiBaseUrl } = useApiEndpoint();

  // Text input management with persistence
  const { text, updateText, clearText, hasText } = useTextInput();
  
  // Audiobook State Management (Hoisted up from TextInput)
  const [isAudiobookMode, setIsAudiobookMode] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [castList, setCastList] = useState<CastMember[]>([]);
  const [chaptersData, setChaptersData] = useState<any[]>([]);
  const [voiceMapping, setVoiceMapping] = useState<Record<string, string>>({});
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  
  // Advanced settings management with persistence
  const {
    exaggeration,
    cfgWeight,
    temperature,
    updateExaggeration,
    updateCfgWeight,
    updateTemperature,
    resetToDefaults,
    isDefault
  } = useAdvancedSettings();

  // Progress settings and session tracking
  const {
    settings: progressSettings,
    updateSettings: updateProgressSettings,
    trackRequest,
    shouldShowProgress,
    dismissProgress,
    isLongTextRequest,
    sessionId
  } = useProgressSettings();

  // Streaming TTS management
  const {
    isStreaming,
    progress: streamingProgress,
    audioUrl: streamingAudioUrl,
    error: streamingError,
    audioInfo,
    isStreamingEnabled,
    toggleStreaming,
    streamingFormat,
    setStreamingFormat,
    startStreaming,
    stopStreaming,
    clearAudio: clearStreamingAudio
  } = useStreamingTTS({
    apiBaseUrl,
    sessionId
  });

  // Long text TTS management
  const {
    currentJob,
    progress: longTextProgress,
    isJobActive,
    error: longTextError,
    audioUrl: longTextAudioUrl,
    jobList,
    totalJobCount,
    isLoadingJobs,
    isSubmitting,
    submitJob,
    pauseJob,
    resumeJob,
    cancelJob,
    refetchJobs,
    estimateProcessingTime,
    shouldUseLongText,
    getStatusMessage
  } = useLongTextTTS({
    apiBaseUrl,
    sessionId
  });

  // Voice library management with backend health monitoring
  const {
    voices,
    selectedVoice,
    setSelectedVoice,
    addVoice,
    deleteVoice,
    renameVoice,
    refreshVoices,
    addAlias,
    removeAlias,
    isLoading: voicesLoading,
    isBackendReady: voicesBackendReady,
    error: voicesError
  } = useVoiceLibrary();

  // Audio history management
  const {
    audioHistory,
    addAudioRecord,
    deleteAudioRecord,
    renameAudioRecord,
    clearHistory,
    isLoading: historyLoading
  } = useAudioHistory();

  // Long text history management
  const {
    jobs: longTextJobs,
    totalCount: longTextTotalCount,
    currentPage: longTextCurrentPage,
    totalPages: longTextTotalPages,
    selectedJobs: longTextSelectedJobs,
    isLoadingHistory: isLoadingLongTextHistory,
    isLoadingStats: isLoadingLongTextStats,
    stats: longTextStats,
    settings: longTextHistorySettings,
    updateJob: updateLongTextJob,
    retryJob: retryLongTextJob,
    deleteJob: deleteLongTextJob,
    archiveJob: archiveLongTextJob,
    unarchiveJob: unarchiveLongTextJob,
    getAudioUrl: getLongTextAudioUrl,
    downloadAudio: downloadLongTextAudio,
    bulkDelete: bulkDeleteLongTextJobs,
    bulkArchive: bulkArchiveLongTextJobs,
    bulkUnarchive: bulkUnarchiveLongTextJobs,
    bulkRetry: bulkRetryLongTextJobs,
    toggleJobSelection: toggleLongTextJobSelection,
    selectAllJobs: selectAllLongTextJobs,
    clearSelection: clearLongTextSelection,
    goToPage: goToLongTextPage,
    nextPage: nextLongTextPage,
    prevPage: prevLongTextPage,
    searchJobs: searchLongTextJobs,
    updateSort: updateLongTextSort,
    clearHistory: clearLongTextHistory,
    refetchHistory: refetchLongTextHistory,
    updateSettings: updateLongTextHistorySettings
  } = useLongTextHistory({
    apiBaseUrl,
    sessionId
  });

  // Default voice management with backend health monitoring
  const {
    defaultVoice,
    updateDefaultVoice,
    clearDefaultVoice,
    isLoading: defaultVoiceLoading,
    isBackendReady: defaultVoiceBackendReady,
    healthStatus
  } = useDefaultVoice();

  // History tab selection with persistence
  const { historyTab, updateHistoryTab } = useHistoryTab();

  // Create TTS service with current API base URL and session ID
  const ttsService = useMemo(() => createTTSService(apiBaseUrl, sessionId), [apiBaseUrl, sessionId]);

  // Status monitoring with real-time updates
  const {
    progress,
    statistics,
    isProcessing,
    hasError: statusHasError,
    isLoadingStats
  } = useStatusMonitoring(apiBaseUrl);

  const { data: health, isLoading: isLoadingHealth } = useQuery({
    queryKey: ['health', apiBaseUrl],
    queryFn: ttsService.getHealth,
    refetchInterval: 3000, 
    retry: true,
    retryDelay: 1000
  });

  // Fetch API info (including version) periodically
  const { data: apiInfo } = useQuery({
    queryKey: ['apiInfo', apiBaseUrl],
    queryFn: async () => {
      const response = await fetch(`${apiBaseUrl}/info`);
      if (!response.ok) throw new Error('Failed to fetch API info');
      return response.json();
    },
    refetchInterval: 60000, 
    retry: false
  });

  // Standard (non-streaming) generation mutation
  const generateMutation = useMutation({
    mutationFn: ttsService.generateSpeech,
    onMutate: (variables) => {
      if (variables.session_id) {
        trackRequest(variables.session_id);
      }
    },
    onSuccess: async (audioBlob) => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);

      try {
        await addAudioRecord(
          audioBlob,
          {
            text,
            exaggeration,
            cfgWeight,
            temperature,
            voiceId: selectedVoice?.id,
            voiceName: selectedVoice?.name || defaultVoice || "Default"
          }
        );
      } catch (error) {
        console.error('Failed to save audio record:', error);
      }
    },
    onError: (error) => {
      console.error('TTS generation failed:', error);
      alert('Failed to generate speech. Please try again.');
    }
  });


  // --- AUDIOBOOK FILE PROCESSING ---
  const handleAudiobookFilesSelected = async (files: FileList) => {
    setIsProcessingFiles(true);
    try {
      const fileData: Record<string, any> = {};
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.name.endsWith('.json')) continue; 
        
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = (e) => reject(e);
          reader.readAsText(file);
        });
        
        try {
          fileData[file.name] = JSON.parse(content);
        } catch (err) {
          console.error(`Failed to parse ${file.name}:`, err);
        }
      }

      if (!fileData['index.json']) {
        throw new Error("Missing 'index.json'. Please select the entire script folder including index.json and all chapter files.");
      }

      const index = fileData['index.json'];
      if (index.title) {
        setProjectTitle(index.title);
      }

      const chapters = [];
      if (index.chapters && Array.isArray(index.chapters)) {
        for (const chapMeta of index.chapters) {
          const chapData = fileData[chapMeta.file];
          if (chapData) {
            chapters.push({
              title: chapData.scene_title || chapMeta.scene_title || chapMeta.file,
              script_lines: chapData.script_lines || []
            });
          }
        }
      }

      const newCastList = index.cast || [];
      const newMapping: Record<string, string> = {};

      newCastList.forEach((member: CastMember) => {
        const match = voices.find(v => v.name.toLowerCase() === member.character.toLowerCase());
        newMapping[member.character] = match ? match.name : "";
      });

      setCastList(newCastList);
      setChaptersData(chapters);
      setVoiceMapping(newMapping);

    } catch (err: any) {
      alert(err.message || "Failed to process audiobook batch.");
    } finally {
      setIsProcessingFiles(false);
    }
  };

  const handleGenerate = async () => {
    
    // --- AUDIOBOOK GENERATION ROUTE ---
    if (isAudiobookMode) {
        if (chaptersData.length === 0) {
            alert("No chapters loaded. Please upload a valid script batch first.");
            return;
        }

        setIsClickedGenerating(true);
        try {
          const batchPayload = {
            chapters: chaptersData,
            mapping_dict: voiceMapping
          };

          const res = await fetch('/v1/audiobook/generate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(batchPayload)
          });
          
          if (!res.ok) {
            throw new Error(`Server returned ${res.status}: ${await res.text()}`);
          }
          
          alert("Audiobook batch submitted! Check your Docker terminal to watch the engine process the chapters.");
        } catch (e: any) {
          alert("Submission failed: " + (e.message || e));
        } finally {
          setIsClickedGenerating(false);
        }
        return;
    }

    // --- STANDARD TTS GENERATION ROUTE ---
    if (!text.trim()) {
      alert('Please enter some text to convert to speech.');
      return;
    }

    setIsClickedGenerating(true);

    if (shouldUseLongText(text)) {
      setTimeout(() => {
        setIsClickedGenerating(false);
      }, 8000);

      const longTextRequest: LongTextRequest = {
        text,
        voice: selectedVoice?.name,
        exaggeration,
        cfg_weight: cfgWeight,
        temperature,
        language: 'en',
        output_format: 'mp3',
        session_id: sessionId
      };

      if (selectedVoice?.file) {
        longTextRequest.voice_file = selectedVoice.file;
      }

      try {
        trackRequest(sessionId, 'long-text');
        submitJob(longTextRequest);
      } catch (error) {
        console.error('Long text TTS failed:', error);
        alert('Failed to start long text processing. Please try again.');
      }
      return;
    } else {
      setTimeout(() => {
        setIsClickedGenerating(false);
      }, 4000);
    }

    const requestData: TTSRequest = {
      input: text,
      exaggeration,
      cfg_weight: cfgWeight,
      temperature,
      session_id: sessionId
    };

    if (selectedVoice) {
      requestData.voice = selectedVoice.name;
      if (selectedVoice.file) {
        requestData.voice_file = selectedVoice.file;
      }
    }

    trackRequest(sessionId);

    if (isStreamingEnabled) {
      try {
        await startStreaming(requestData);

        if (streamingAudioUrl) {
          try {
            const response = await fetch(streamingAudioUrl);
            const audioBlob = await response.blob();

            await addAudioRecord(
              audioBlob,
              {
                text,
                exaggeration,
                cfgWeight,
                temperature,
                voiceId: selectedVoice?.id,
                voiceName: selectedVoice?.name || defaultVoice || "Default"
              }
            );
          } catch (error) {
            console.error('Failed to save streaming audio to history:', error);
          }
        }
      } catch (error) {
        console.error('Streaming failed:', error);
        alert('Failed to stream speech. Please try again.');
      }
    } else {
      generateMutation.mutate(requestData);
    }
  };


  const isBackendReady = voicesBackendReady && defaultVoiceBackendReady;
  const isInitializing = healthStatus === 'initializing' || health?.status === 'initializing';
  const isGenerating = isClickedGenerating || generateMutation.isPending || isStreaming || isSubmitting || isJobActive;
  const currentAudioUrl = longTextAudioUrl || streamingAudioUrl || audioUrl;
  const isLongText = shouldUseLongText(text);
  const estimatedTime = isLongText ? estimateProcessingTime(text.length) : null;

  return (
    <>
      <div className="container mx-auto px-4 py-8 flex flex-col items-center justify-center gap-4">
        {/* Status Header */}
        <div className="flex justify-between items-start w-full max-w-6xl mx-auto relative">
          <div className="flex-1">
            <StatusHeader
              health={health}
              progress={progress}
              statistics={statistics}
              isLoadingHealth={isLoadingHealth}
              hasErrors={statusHasError}
              apiVersion={apiInfo?.version || apiInfo?.api_version}
              progressSettings={{
                onlyShowMyRequests: progressSettings.onlyShowMyRequests,
                onToggleOnlyMyRequests: () => updateProgressSettings({
                  onlyShowMyRequests: !progressSettings.onlyShowMyRequests
                })
              }}
              defaultVoiceSettings={{
                defaultVoice,
                voices,
                onSetDefaultVoice: updateDefaultVoice,
                onClearDefaultVoice: clearDefaultVoice,
                isLoading: voicesLoading || defaultVoiceLoading
              }}
            />
          </div>
        </div>
     
        {/* Backend Loading State */}
        {(isInitializing || !isBackendReady) && (
          <div className="w-full max-w-2xl mx-auto">
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span className="text-sm font-medium text-primary">
                  {isInitializing ? 'Backend initializing...' : 'Loading voice library...'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {isInitializing
                  ? 'TTS model is starting up. Voice library will load once ready.'
                  : 'Connecting to voice library and loading default settings.'
                }
              </p>
            </div>
          </div>
        )}

        <div className="w-full max-w-3xl mx-auto flex flex-col items-center justify-center gap-4">

          <div className="flex flex-col items-center justify-center gap-2 w-full">
            <button
              onClick={() => setShowStatistics(!showStatistics)}
              className="px-3 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-full transition-colors duration-300"
            >
              {showStatistics ? 'Hide Stats' : 'Show Stats'}
            </button>
            {/* Statistics Panel */}
            {showStatistics && (
              <StatusStatisticsPanel
                statistics={statistics}
                isLoading={isLoadingStats}
                hasError={statusHasError}
              />
            )}
          </div>

          <div className="max-w-3xl mx-auto gap-4 flex flex-col w-full">
            {/* API Endpoint Selector */}
            <div className="">
              <ApiEndpointSelector
                apiBaseUrl={apiBaseUrl}
                onUrlChange={updateApiBaseUrl}
              />
            </div>

            {/* Text Input */}
            <TextInput
              value={text}
              onChange={updateText} 
              onClear={() => {
                  clearText();
                  setCastList([]);
                  setChaptersData([]);
              }}
              hasText={hasText || chaptersData.length > 0}             
              isStreamingEnabled={isStreamingEnabled}  
              onToggleStreaming={toggleStreaming}      
              isAudiobookMode={isAudiobookMode}
              onToggleAudiobookMode={() => {
                setIsAudiobookMode(!isAudiobookMode);
                if (!isAudiobookMode && isStreamingEnabled) {
                  toggleStreaming(); 
                }
              }}
              onFilesSelected={handleAudiobookFilesSelected}
            />

            {/* --- AUDIOBOOK CHARACTER MAPPING UI --- */}
            {isAudiobookMode && (
                <div className="flex flex-col gap-4 w-full">
                    
                    {/* Project Title Input */}
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <label className="block text-sm font-medium text-foreground mb-2">Project Title</label>
                        <Input 
                        placeholder="Auto-filled from index.json" 
                        value={projectTitle} 
                        onChange={(e) => setProjectTitle(e.target.value)} 
                        className="text-sm h-10 w-full"
                        />
                    </div>

                    {/* Character Voice Mapping */}
                    {castList.length > 0 ? (
                    <div className="p-4 rounded-lg border border-border bg-card">
                        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground">
                        <User className="w-4 h-4 text-primary" />
                        Character Voice Mapping
                        </h3>
                        <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                        {castList.map((cast) => (
                            <div key={cast.character} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-3 bg-muted/30 rounded-md border border-border/50">
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm text-foreground">{cast.character}</div>
                                {cast.celebrity && (
                                <div className="text-xs text-muted-foreground mt-1 truncate">
                                    <span className="font-medium">Sounds like:</span> {cast.celebrity}
                                </div>
                                )}
                                {cast.voice_comment && (
                                <div className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                                    {cast.voice_comment}
                                </div>
                                )}
                            </div>
                            
                            <div className="w-full md:w-56 shrink-0">
                                <select
                                value={voiceMapping[cast.character] || ""}
                                onChange={(e) => setVoiceMapping({ ...voiceMapping, [cast.character]: e.target.value })}
                                className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background text-foreground hover:border-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                                >
                                <option value="" disabled>Select a voice...</option>
                                {voices.map(v => (
                                    <option key={v.id} value={v.name}>{v.name}</option>
                                ))}
                                </select>
                            </div>
                            </div>
                        ))}
                        </div>
                    </div>
                    ) : (
                        isProcessingFiles ? (
                            <div className="flex items-center justify-center p-8 bg-card rounded-lg border border-border">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : null
                    )}
                </div>
            )}


            {/* Long Text Detection */}
            {isLongText && !isAudiobookMode && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                      Long Text Detected ({text.length.toLocaleString()} characters)
                    </h4>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                      This text will be processed using long text TTS mode. Your text will be intelligently split into chunks and processed in the background.
                    </p>
                    {estimatedTime && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        Estimated processing time: ~{Math.ceil(estimatedTime / 60)} minutes
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Streaming Progress */}
            {(isStreaming || streamingProgress || streamingAudioUrl || streamingError) && !isAudiobookMode && (
              <StreamingProgressComponent
                isStreaming={isStreaming}
                progress={streamingProgress}
                audioUrl={streamingAudioUrl}
                error={streamingError}
                audioInfo={audioInfo}
                onStop={stopStreaming}
                onClear={clearStreamingAudio}
              />
            )}

            {/* Long Text Progress */}
            {(isJobActive || currentJob || longTextError) && (
              <LongTextProgress
                job={currentJob}
                progress={longTextProgress}
                isJobActive={isJobActive}
                audioUrl={longTextAudioUrl}
                error={longTextError}
                onPause={pauseJob}
                onResume={resumeJob}
                onCancel={cancelJob}
                onDownload={(url) => {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `chatterbox-long-text-${Date.now()}.mp3`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                isPausing={false}
                isResuming={false}
                isCancelling={false}
              />
            )}

            {/* Voice Library */}
            <VoiceLibrary
              voices={voices}
              selectedVoice={selectedVoice}
              onVoiceSelect={setSelectedVoice}
              onAddVoice={addVoice}
              onDeleteVoice={deleteVoice}
              onRenameVoice={renameVoice}
              onRefresh={refreshVoices}
              isLoading={voicesLoading}
              defaultVoice={defaultVoice}
              onSetDefaultVoice={updateDefaultVoice}
              onClearDefaultVoice={clearDefaultVoice}
              onAddAlias={addAlias}
              onRemoveAlias={removeAlias}
            />

            {/* Voice Library Error Display */}
            {voicesError && !voicesLoading && (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm text-destructive mb-2">
                  Failed to load voice library: {voicesError.message || 'Unknown error'}
                </p>
                <button
                  onClick={refreshVoices}
                  className="text-xs text-primary hover:text-primary/80 underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Advanced Settings */}
            {!isAudiobookMode && (
                <AdvancedSettings
                showAdvanced={showAdvanced}
                onToggle={() => setShowAdvanced(!showAdvanced)}
                exaggeration={exaggeration}
                onExaggerationChange={updateExaggeration}
                cfgWeight={cfgWeight}
                onCfgWeightChange={updateCfgWeight}
                temperature={temperature}
                onTemperatureChange={updateTemperature}
                onResetToDefaults={resetToDefaults}
                isDefault={isDefault}
                />
            )}

            {/* Current Voice Indicator */}
            {selectedVoice && !isAudiobookMode && (
              <div className="text-center text-sm text-muted-foreground">
                Using voice: <span className="font-medium text-foreground">{selectedVoice.name}</span>
                {defaultVoice === selectedVoice.name && (
                  <span className="ml-2 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-2 py-1 rounded">
                    Default
                  </span>
                )}
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || (isAudiobookMode ? chaptersData.length === 0 : !hasText)}
              className="w-full py-6 px-6 text-xl [&_svg]:size-6 [&_svg:not([class*='size-'])]:size-6 flex gap-4 mt-4"
            >
              <Volume2 className="w-5 h-5 mr-2" />
              {isGenerating ? (isStreaming ? 'Streaming...' : 'Generating...') : (isAudiobookMode ? 'Generate Audiobook Batch' : 'Generate Speech')}
            </Button>

            {/* Audio Player - Only show for non-streaming audio or completed streaming */}
            {currentAudioUrl && !isStreaming && !isAudiobookMode && (
              <AudioPlayer audioUrl={currentAudioUrl} />
            )}
          </div>
        </div>

        {/* Active Jobs Monitor */}
        {jobList.length > 0 && (
          <div className="w-full max-w-3xl mx-auto mt-8">
            <LongTextJobs
              jobs={jobList}
              totalCount={totalJobCount}
              isLoading={isLoadingJobs}
              onRefresh={refetchJobs}
              onDownload={async (jobId) => {
                try {
                  const service = createLongTextTTSService(apiBaseUrl, sessionId);
                  const audioBlob = await service.downloadJobAudio(jobId);
                  const audioUrl = URL.createObjectURL(audioBlob);

                  const link = document.createElement('a');
                  link.href = audioUrl;
                  link.download = `chatterbox-long-text-${jobId.slice(-8)}.mp3`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);

                  URL.revokeObjectURL(audioUrl);
                } catch (error) {
                  console.error('Failed to download job:', error);
                  alert('Failed to download audio file');
                }
              }}
              onResume={resumeJob}
              onPause={pauseJob}
              onCancel={cancelJob}
            />
          </div>
        )}

        {/* History Section with Tabs */}
        {!isAudiobookMode && (
            <div className="w-full max-w-3xl mx-auto mt-8">
            {/* History Tabs */}
            <div className="flex border-b border-border mb-4">
                <button
                onClick={() => updateHistoryTab('regular')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${historyTab === 'regular'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                Regular TTS ({audioHistory.length})
                </button>
                <button
                onClick={() => updateHistoryTab('longtext')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${historyTab === 'longtext'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                Long Text ({longTextTotalCount})
                </button>
            </div>

            {/* History Content */}
            {historyTab === 'regular' ? (
                <AudioHistory
                audioHistory={audioHistory}
                onDeleteAudioRecord={deleteAudioRecord}
                onRenameAudioRecord={renameAudioRecord}
                onClearHistory={clearHistory}
                onRestoreSettings={(settings) => {
                    updateExaggeration(settings.exaggeration);
                    updateCfgWeight(settings.cfgWeight);
                    updateTemperature(settings.temperature);
                }}
                onRestoreText={updateText}
                isLoading={historyLoading}
                />
            ) : (
                <LongTextHistory
                jobs={longTextJobs}
                totalCount={longTextTotalCount}
                currentPage={longTextCurrentPage}
                totalPages={longTextTotalPages}
                selectedJobs={longTextSelectedJobs}
                isLoading={isLoadingLongTextHistory}
                isLoadingStats={isLoadingLongTextStats}
                stats={longTextStats}
                onUpdateJob={updateLongTextJob}
                onRetryJob={retryLongTextJob}
                onDeleteJob={deleteLongTextJob}
                onArchiveJob={archiveLongTextJob}
                onUnarchiveJob={unarchiveLongTextJob}
                onDownloadAudio={downloadLongTextAudio}
                onGetAudioUrl={getLongTextAudioUrl}
                onBulkDelete={bulkDeleteLongTextJobs}
                onBulkArchive={bulkArchiveLongTextJobs}
                onBulkUnarchive={bulkUnarchiveLongTextJobs}
                onBulkRetry={bulkRetryLongTextJobs}
                onToggleJobSelection={toggleLongTextJobSelection}
                onSelectAllJobs={selectAllLongTextJobs}
                onClearSelection={clearLongTextSelection}
                onGoToPage={goToLongTextPage}
                onNextPage={nextLongTextPage}
                onPrevPage={prevLongTextPage}
                onSearch={searchLongTextJobs}
                onUpdateSort={updateLongTextSort}
                onClearHistory={clearLongTextHistory}
                showArchived={longTextHistorySettings.showArchived}
                onToggleArchived={() => {
                    updateLongTextHistorySettings({ showArchived: !longTextHistorySettings.showArchived });
                }}
                currentSort={longTextHistorySettings.sort}
                onRestoreSettings={(settings) => {
                    updateExaggeration(settings.exaggeration);
                    updateCfgWeight(settings.cfgWeight);
                    updateTemperature(settings.temperature);
                }}
                onRestoreText={updateText}
                />
            )}
            </div>
        )}
      </div>

      {/* Progress Overlay */}
      {shouldShowProgress(progress?.request_id) && progress && (
        <StatusProgressOverlay
          progress={progress}
          isVisible={shouldShowProgress(progress?.request_id)}
          onDismiss={dismissProgress}
          isLongText={isLongTextRequest(progress?.request_id)}
        />
      )}
    </>
  );
}