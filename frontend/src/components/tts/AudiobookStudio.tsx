import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { useLongTextTTS } from '../../hooks/useLongTextTTS';

type AudiobookStudioProps = {
  apiBaseUrl: string;
  sessionId?: string;
};

export function AudiobookStudio({ apiBaseUrl, sessionId }: AudiobookStudioProps) {
  // Pass the required props into the hook
  const { extractYoutubeVoice, submitAudiobookJob } = useLongTextTTS({ apiBaseUrl, sessionId });
  
  const [ytUrl, setYtUrl] = useState('');
  const [ytStart, setYtStart] = useState(0);
  const [ytDuration, setYtDuration] = useState(10);
  const [ytVoiceName, setYtVoiceName] = useState('');
  
  const [projectTitle, setProjectTitle] = useState('');
  const [scriptJson, setScriptJson] = useState('');

  const handleExtract = async () => {
    try {
      await extractYoutubeVoice(ytUrl, ytStart, ytDuration, ytVoiceName);
      alert(`Successfully extracted and saved voice: ${ytVoiceName}`);
    } catch (err) {
      alert(`Extraction failed: ${err}`);
    }
  };

  const handleGenerate = async () => {
    try {
      const parsedJson = JSON.parse(scriptJson);
      await submitAudiobookJob({
        project_title: projectTitle,
        json_payload: parsedJson
      });
      alert('Audiobook batch job submitted successfully! Check the Active Jobs panel.');
    } catch (err) {
      alert(`Submission failed: Ensure valid JSON. ${err}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Voice Hunter: YouTube Extraction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="YouTube URL" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          <div className="flex gap-4">
            <Input type="number" placeholder="Start Time (s)" value={ytStart} onChange={(e) => setYtStart(Number(e.target.value))} />
            <Input type="number" placeholder="Duration (s)" value={ytDuration} onChange={(e) => setYtDuration(Number(e.target.value))} />
          </div>
          <Input placeholder="Save As (Voice Name)" value={ytVoiceName} onChange={(e) => setYtVoiceName(e.target.value)} />
          <Button onClick={handleExtract}>Extract & Save Voice</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audiobook Batch Generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Project Title" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} />
          <Textarea 
            placeholder="Paste your formatted JSON script here..." 
            rows={10} 
            value={scriptJson} 
            onChange={(e) => setScriptJson(e.target.value)} 
          />
          <Button onClick={handleGenerate} variant="default">Start Batch Generation</Button>
        </CardContent>
      </Card>
    </div>
  );
}