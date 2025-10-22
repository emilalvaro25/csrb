import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';
import { View, Template, TranscriptEntry, CallState, Greeting, Voice } from './types';
import { encode, decode, decodeAudioData } from './services/audioUtils';
import Dialer from './components/Dialer';

const GREETINGS: Record<Template, Greeting> = {
    airline: { text: 'Good afternoon, this is Turkish Airlines customer service. How can I assist you today?', lang: 'en-US', voice: 'Kore' },
    bank: { text: 'Hello, banking support here. How can I help with your account today?', lang: 'en-US', voice: 'Zephyr' },
    telecom: { text: 'Hi! Telecom helpdesk speaking. What seems to be the issue with your line?', lang: 'en-US', voice: 'Puck' },
    insurance: { text: 'You’ve reached insurance claims. I can guide you through the next steps.', lang: 'en-US', voice: 'Charon' },
    warm: { text: 'Thanks for reaching us today. I’m here to help—what happened on your end?', lang: 'en-US', voice: 'Kore' },
    calm: { text: 'I’ll go over the details step by step. What would you like to start with?', lang: 'en-US', voice: 'Fenrir' },
};

const SYSTEM_INSTRUCTIONS: Record<Template, string> = {
    airline: "You are a friendly, empathetic, and helpful customer support agent for Turkish Airlines. Keep your responses concise.",
    bank: "You are a professional and calm banking support agent. You must be clear and precise in your answers about financial matters.",
    telecom: "You are an energetic and savvy telecom helpdesk agent. You are good at troubleshooting technical issues.",
    insurance: "You are a reassuring and knowledgeable insurance claims agent. You guide users through stressful situations with calm and clarity.",
    warm: "You are a warm and empathetic agent. Your primary goal is to make the user feel heard and understood.",
    calm: "You are a calm expert. You speak clearly and explain complex topics step-by-step. You are patient and thorough.",
};


const App: React.FC = () => {
    const [view, setView] = useState<View>(View.Projects);
    const [selectedTemplate, setSelectedTemplate] = useState<Template>('airline');
    
    const [callState, setCallState] = useState<CallState>(CallState.Idle);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [isOrbListening, setIsOrbListening] = useState(false);
    
    const [lastCallTranscript, setLastCallTranscript] = useState<TranscriptEntry[] | null>(null);
    const [summary, setSummary] = useState<string>('');
    const [isSummarizing, setIsSummarizing] = useState<boolean>(false);

    const ai = useRef<GoogleGenAI | null>(null);
    const sessionPromise = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContext = useRef<AudioContext | null>(null);
    const outputAudioContext = useRef<AudioContext | null>(null);
    const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSource = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const nextStartTime = useRef(0);
    const audioSources = useRef(new Set<AudioBufferSourceNode>());
    const currentInputTranscription = useRef('');
    const currentOutputTranscription = useRef('');
    
    useEffect(() => {
        ai.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }, []);

    const addTranscriptEntry = (speaker: TranscriptEntry['speaker'], text: string) => {
        setTranscript(prev => [...prev, { speaker, text }]);
    };
    
    const generateSummary = async (transcriptToSummarize: TranscriptEntry[]) => {
        if (!ai.current || transcriptToSummarize.length === 0) return;

        setIsSummarizing(true);
        setSummary('');

        const formattedTranscript = transcriptToSummarize
            .map(entry => `${entry.speaker}: ${entry.text}`)
            .join('\n');

        const prompt = `Please provide a concise summary of the following customer service call transcript. Identify the main issue, the resolution, and any key moments. Format the output nicely using markdown.\n\nTranscript:\n${formattedTranscript}`;

        try {
            const response = await ai.current.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            setSummary(response.text);
        } catch (error) {
            console.error("Failed to generate summary:", error);
            setSummary("Could not generate a summary for this call.");
        } finally {
            setIsSummarizing(false);
        }
    };


    const previewVoice = useCallback(async (template: Template) => {
        if (!ai.current) return;
        const greeting = GREETINGS[template];
        addTranscriptEntry('System', `Previewing voice: ${greeting.voice}`);

        try {
            const response = await ai.current.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greeting.text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: greeting.voice },
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                if (!outputAudioContext.current) {
                    outputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                }
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext.current, 24000, 1);
                const source = outputAudioContext.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.current.destination);
                source.start();
            }
        } catch (error) {
            console.error("TTS generation failed:", error);
            addTranscriptEntry('System', "Error: Could not generate voice preview.");
        }
    }, []);

    const startCall = useCallback(async () => {
        if (!ai.current || callState !== CallState.Idle) return;

        setCallState(CallState.Connecting);
        setTranscript([]);
        addTranscriptEntry('System', 'Initializing session...');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            inputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            sessionPromise.current = ai.current.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setCallState(CallState.Connected);
                        setIsOrbListening(true);
                        addTranscriptEntry('System', 'Connection opened. You can start speaking.');

                        mediaStreamSource.current = inputAudioContext.current!.createMediaStreamSource(stream);
                        scriptProcessor.current = inputAudioContext.current!.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            if (sessionPromise.current) {
                                sessionPromise.current.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        };
                        mediaStreamSource.current.connect(scriptProcessor.current);
                        scriptProcessor.current.connect(inputAudioContext.current!.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            currentInputTranscription.current += text;
                        }
                        if (message.serverContent?.outputTranscription) {
                             const text = message.serverContent.outputTranscription.text;
                            currentOutputTranscription.current += text;
                        }

                        if(message.serverContent?.turnComplete) {
                            const finalInput = currentInputTranscription.current.trim();
                            const finalOutput = currentOutputTranscription.current.trim();
                            if (finalInput) {
                                setTranscript(prev => [...prev, { speaker: 'User', text: finalInput }]);
                            }
                            if (finalOutput) {
                                setTranscript(prev => [...prev, { speaker: 'Agent', text: finalOutput }]);
                            }
                            currentInputTranscription.current = '';
                            currentOutputTranscription.current = '';
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                             setIsOrbListening(false);
                            nextStartTime.current = Math.max(nextStartTime.current, outputAudioContext.current!.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext.current!, 24000, 1);
                            const source = outputAudioContext.current!.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAudioContext.current!.destination);
                            
                            source.onended = () => {
                                audioSources.current.delete(source);
                                if (audioSources.current.size === 0) {
                                    setIsOrbListening(true);
                                }
                            };

                            source.start(nextStartTime.current);
                            nextStartTime.current += audioBuffer.duration;
                            audioSources.current.add(source);
                        }
                        
                        if (message.serverContent?.interrupted) {
                            for (const source of audioSources.current.values()) {
                                source.stop();
                            }
                            audioSources.current.clear();
                            nextStartTime.current = 0;
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        addTranscriptEntry('System', `Error: ${e.message}`);
                        endCall();
                    },
                    onclose: () => {
                       addTranscriptEntry('System', 'Session closed.');
                       endCall();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: GREETINGS[selectedTemplate].voice } },
                    },
                    systemInstruction: SYSTEM_INSTRUCTIONS[selectedTemplate],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });
        } catch (error) {
            console.error('Failed to start call:', error);
            addTranscriptEntry('System', 'Error: Could not get microphone access.');
            setCallState(CallState.Idle);
        }
    }, [ai, callState, selectedTemplate]);

    const endCall = useCallback(() => {
        if (sessionPromise.current) {
            sessionPromise.current.then(session => session.close());
            sessionPromise.current = null;
        }

        scriptProcessor.current?.disconnect();
        mediaStreamSource.current?.disconnect();
        inputAudioContext.current?.close();
        outputAudioContext.current?.close();

        scriptProcessor.current = null;
        mediaStreamSource.current = null;
        inputAudioContext.current = null;
        outputAudioContext.current = null;

        for (const source of audioSources.current.values()) {
            source.stop();
        }
        audioSources.current.clear();
        
        if (transcript.length > 2) { 
            const finalTranscript = [...transcript];
            setLastCallTranscript(finalTranscript);
            generateSummary(finalTranscript);
        }

        setTranscript([]);
        setIsOrbListening(false);
        setCallState(CallState.Ended);
        setTimeout(() => setCallState(CallState.Idle), 2000);
    }, [transcript]);

    const handleSelectTemplate = (template: Template) => {
        setSelectedTemplate(template);
    };

    const handleCloseSummary = () => {
        setLastCallTranscript(null);
        setSummary('');
    };

    return (
      <div className="min-h-dvh">
        <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
             <img alt="Eburon Logo" className="h-8 w-auto" src="https://eburon.vercel.app/logo-dark.png" />
             <div className="flex items-center gap-3">
               <div className="font-semibold tracking-wide">Eburon Labs — CSR Studio</div>
               <span className="badge hidden sm:inline">Gemini Live Audio Demo</span>
             </div>
             <div className="ml-auto flex items-center gap-3">
               <div className="hidden sm:flex items-center gap-2">
                 <span className="text-xs text-[var(--muted)]">Status</span>
                 <span className={`dot ${callState === CallState.Connected ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'}`} aria-hidden="true"></span>
                 <span className="text-xs text-[var(--muted)]">{callState === CallState.Connected ? 'Live' : 'Idle'}</span>
               </div>
             </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
          <main id="main" className="space-y-4">
            {lastCallTranscript ? (
                <section className="card p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">Call Recording & Summary</h2>
                        <button className="btn text-sm" onClick={handleCloseSummary}>Close & Start New</button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <h3 className="font-semibold">AI-Generated Summary</h3>
                            <div className="p-3 kbd h-80 overflow-auto scroll-slim">
                                {isSummarizing ? (
                                    <div className="text-sm text-[var(--muted)]">Generating summary...</div>
                                ) : (
                                    <div className="text-sm whitespace-pre-wrap">{summary}</div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                             <h3 className="font-semibold">Full Transcript</h3>
                             <div className="p-3 kbd h-80 overflow-auto scroll-slim">
                                {lastCallTranscript.map((entry, index) => (
                                    <div key={index} className="mb-2">
                                        <div className={`text-[10px] uppercase tracking-wide ${entry.speaker === 'User' ? 'text-[var(--teal)]' : 'text-[var(--gold)]'}`}>
                                            {entry.speaker}
                                        </div>
                                        <div className="text-sm">{entry.text}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            ) : (
                <section id="view-projects" className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="card p-4">
                            <div className="text-xs text-[var(--muted)] mb-2">Calls handled (Today)</div>
                            <div className="text-3xl font-semibold">128</div>
                            <div className="mt-3 h-16 rounded bg-gradient-to-r from-[rgba(25,194,255,.18)] to-[rgba(246,196,83,.18)] ring-anim"></div>
                        </div>
                        <div className="card p-4">
                            <div className="text-xs text-[var(--muted)] mb-2">Avg turn latency</div>
                            <div className="text-3xl font-semibold">~0.8s</div>
                            <div className="mt-3 h-16 rounded bg-[rgba(25,194,255,.12)]"></div>
                        </div>
                        <div className="card p-4">
                            <div className="text-xs text-[var(--muted)] mb-2">Model</div>
                            <div className="text-3xl font-semibold">Gemini Live</div>
                            <div className="mt-3 h-16 rounded bg-[rgba(246,196,83,.12)]"></div>
                        </div>
                    </div>

                    <div className="card p-4">
                        <div className="text-sm font-semibold">Templates • Pre-created CSR Variants</div>
                        <div className="text-xs text-[var(--muted)] mb-3">Select a variant to configure the AI agent's personality and voice.</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {(Object.keys(GREETINGS) as Template[]).map(key => (
                            <div key={key} className={`p-3 kbd cursor-pointer ${selectedTemplate === key ? 'border-[var(--teal)]' : 'hover:border-[var(--teal)]/40'}`} onClick={() => handleSelectTemplate(key)}>
                            <div className="text-lg">
                                { {airline: '✈', bank: '🏦', telecom: '📱', insurance: '🚗', warm: '😊', calm: '🧘'}[key] }
                            </div>
                            <div className="font-medium mt-1 h-10">{GREETINGS[key].text.split('.')[0]}</div>
                            <div className="text-xs text-[var(--muted)]">{SYSTEM_INSTRUCTIONS[key].split('.')[0]}</div>
                            <div className="mt-2 flex gap-2">
                                <button className="btn text-xs w-full" onClick={(e) => { e.stopPropagation(); previewVoice(key); }}>Preview Voice</button>
                            </div>
                            </div>
                        ))}
                        </div>
                    </div>
                </section>
            )}
          </main>
          <Dialer 
            callState={callState}
            selectedTemplate={selectedTemplate}
            transcript={transcript}
            isOrbListening={isOrbListening}
            startCall={startCall}
            endCall={endCall}
          />
        </div>
      </div>
    );
};

export default App;
