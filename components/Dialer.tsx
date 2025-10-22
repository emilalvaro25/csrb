
import React from 'react';
import { CallState, Template, TranscriptEntry } from '../types';

interface DialerProps {
  callState: CallState;
  selectedTemplate: Template;
  transcript: TranscriptEntry[];
  isOrbListening: boolean;
  startCall: () => void;
  endCall: () => void;
}

const templateLabels: Record<Template, string> = {
  airline: 'Turkish Airlines CSR',
  bank: 'Banking Support',
  telecom: 'Telecom Helpdesk',
  insurance: 'Insurance Claims',
  warm: 'Warm Empathy',
  calm: 'Calm Expert',
};

const Dialer: React.FC<DialerProps> = ({ callState, selectedTemplate, transcript, isOrbListening, startCall, endCall }) => {
  const transcriptRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  return (
    <aside className="card glow p-3 h-max sticky top-[68px] md:top-[72px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Dialer • Live Conversation</div>
          <div id="selTemplate" className="text-xs text-[var(--muted)]">
            Selected: {templateLabels[selectedTemplate]}
          </div>
        </div>
        <span id="callState" className="badge">{callState}</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className={`orb ${isOrbListening ? 'listening' : ''}`} aria-hidden="true"></div>
        <div className="text-xs text-[var(--muted)]">Press Call to start a live conversation with the Gemini agent.</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button id="callBtn" className="btn btn-cta" onClick={startCall} disabled={callState === CallState.Connected || callState === CallState.Connecting}>
          Call
        </button>
        <button id="endBtn" className="btn" onClick={endCall} disabled={callState !== CallState.Connected}>
          End
        </button>
      </div>

      <div ref={transcriptRef} className="mt-3 p-3 kbd h-80 overflow-auto scroll-slim" id="miniTranscript" aria-live="polite">
        {transcript.length === 0 ? (
          <div className="text-xs text-[var(--muted)]">Transcript will appear here…</div>
        ) : (
          transcript.map((entry, index) => (
            <div key={index} className="mb-2">
              <div className={`text-[10px] uppercase tracking-wide ${entry.speaker === 'User' ? 'text-[var(--teal)]' : 'text-[var(--gold)]'}`}>
                {entry.speaker}
              </div>
              <div className="text-sm">{entry.text}</div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

export default Dialer;
