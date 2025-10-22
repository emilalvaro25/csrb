
export type TranscriptEntry = {
  speaker: 'User' | 'Agent';
  text: string;
};

export enum CallState {
  Idle = 'Idle',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Ended = 'Ended',
}
