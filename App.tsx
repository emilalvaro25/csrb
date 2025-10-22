import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';
import Dialer from './components/Dialer';
import { CallState, TranscriptEntry } from './types';
import { encode, decode, decodeAudioData } from './services/audioUtils';

const App: React.FC = () => {
  const [showDialer, setShowDialer] = useState(false);
  const [callState, setCallState] = useState<CallState>(CallState.Idle);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isOrbListening, setIsOrbListening] = useState(false);

  const sessionRef = useRef<LiveSession | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTime = useRef(0);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  const cleanup = () => {
    sessionRef.current?.close();
    sessionRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    
    inputAudioContextRef.current?.close();
    inputAudioContextRef.current = null;
    
    outputAudioContextRef.current?.close();
    outputAudioContextRef.current = null;

    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
  };
  
  const endCall = () => {
    if (callState === CallState.Connected) {
      setCallState(CallState.Ended);
      cleanup();
      setTimeout(() => {
        setCallState(CallState.Idle);
        setShowDialer(false);
        setTranscript([]);
      }, 1500);
    }
  };

  const startCall = async () => {
    if (callState !== CallState.Idle) return;

    setCallState(CallState.Connecting);
    setTranscript([]);
    setIsOrbListening(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // FIX: Cast window to `any` to support `webkitAudioContext` for Safari compatibility.
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputNodeRef.current = outputAudioContextRef.current.createGain();
      outputNodeRef.current.connect(outputAudioContextRef.current.destination);
      nextStartTime.current = 0;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'You are a helpful and friendly agent for Eburon.'
        },
        callbacks: {
          onopen: () => {
            setCallState(CallState.Connected);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (event) => {
              const inputData = event.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscriptionRef.current += text;
              setTranscript(prev => {
                const last = prev[prev.length - 1];
                if (last?.speaker === 'User') {
                  return [...prev.slice(0, -1), { ...last, text: currentInputTranscriptionRef.current }];
                }
                return [...prev, { speaker: 'User', text: currentInputTranscriptionRef.current }];
              });
            } else if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscriptionRef.current += text;
              setTranscript(prev => {
                const last = prev[prev.length - 1];
                if (last?.speaker === 'Agent') {
                  return [...prev.slice(0, -1), { ...last, text: currentOutputTranscriptionRef.current }];
                }
                return [...prev, { speaker: 'Agent', text: currentOutputTranscriptionRef.current }];
              });
            }

            if (message.serverContent?.turnComplete) {
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }
            
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              nextStartTime.current = Math.max(nextStartTime.current, outputAudioContextRef.current!.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current!, 24000, 1);
              const source = outputAudioContextRef.current!.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current!);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTime.current);
              nextStartTime.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => source.stop());
              sourcesRef.current.clear();
              nextStartTime.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            setIsOrbListening(false);
            endCall();
          },
          onclose: () => {
            console.log('Session closed.');
            setIsOrbListening(false);
            cleanup();
          },
        },
      });
      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error('Failed to start call', error);
      setCallState(CallState.Idle);
      setIsOrbListening(false);
    }
  };

  useEffect(() => {
    return () => cleanup();
  }, []);

  return (
    <div className="bg-black text-white min-h-screen flex flex-col font-sans">
      <header className="absolute top-0 left-0 right-0 z-10">
        <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center">
          <div className="text-xl font-medium tracking-wider">Eburon</div>
        </nav>
      </header>
      
      <main className="flex-grow flex flex-col md:flex-row items-center justify-center md:justify-around text-center md:text-left px-4">
        <div className="flex flex-col items-center md:items-start max-w-2xl">
          <h1 className="text-6xl md:text-8xl font-medium leading-tight tracking-tighter">
            <span className="text-pale-yellow">Welcome to</span><br />
            <span className="text-white">the </span>
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text">Eburon</span>
            <span className="text-white"> era</span>
          </h1>
          {!showDialer && (
            <button 
              onClick={() => setShowDialer(true)}
              className="mt-8 px-6 py-3 border border-gray-700 rounded-full text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2">
              Start Live Conversation
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          )}
        </div>
        
        {showDialer && (
          <div className="mt-8 md:mt-0">
            <Dialer 
              callState={callState} 
              transcript={transcript}
              isOrbListening={isOrbListening}
              startCall={startCall}
              endCall={endCall}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;