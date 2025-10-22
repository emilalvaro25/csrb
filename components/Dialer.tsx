import React from 'react';
import { CallState, TranscriptEntry } from '../types';

interface DialerProps {
  callState: CallState;
  transcript: TranscriptEntry[];
  isOrbListening: boolean;
  startCall: () => void;
  endCall: () => void;
}

const Dialer: React.FC<DialerProps> = ({ callState, transcript, isOrbListening, startCall, endCall }) => {
  const transcriptRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  return (
    <aside className="bg-black/20 backdrop-blur-md border border-gray-800 rounded-2xl p-4 w-full max-w-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Live Conversation</div>
        </div>
        <span id="callState" className="inline-flex items-center rounded-md bg-gray-400/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-400/20">{callState}</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className={`w-10 h-10 border-2 rounded-full flex items-center justify-center transition-all ${isOrbListening ? 'border-blue-400' : 'border-gray-700'}`}>
           <div className={`w-6 h-6 bg-gray-700 rounded-full transition-all ${isOrbListening ? 'bg-blue-500 animate-pulse' : ''}`} aria-hidden="true"></div>
        </div>
        <div className="text-xs text-gray-400">Press Call to start a live conversation with the Gemini agent.</div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button id="callBtn" className="px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors" onClick={startCall} disabled={callState === CallState.Connected || callState === CallState.Connecting}>
          Call
        </button>
        <button id="endBtn" className="px-4 py-2 bg-gray-700 text-white rounded-full text-sm font-medium hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors" onClick={endCall} disabled={callState !== CallState.Connected}>
          End
        </button>
      </div>

      <div ref={transcriptRef} className="mt-4 p-3 bg-black/30 rounded-lg h-80 overflow-auto" id="miniTranscript" aria-live="polite">
        {transcript.length === 0 ? (
          <div className="text-sm text-gray-500">Transcript will appear here…</div>
        ) : (
          transcript.map((entry, index) => (
            <div key={index} className="mb-3 last:mb-0">
              <div className={`text-xs font-semibold uppercase tracking-wider ${entry.speaker === 'User' ? 'text-blue-400' : 'text-purple-400'}`}>
                {entry.speaker}
              </div>
              <div className="text-sm text-gray-200">{entry.text}</div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

export default Dialer;
