
export enum View {
  Projects = 'projects',
  Agents = 'agents',
  Knowledge = 'knowledge',
  Models = 'models',
  Voices = 'voices',
  Chat = 'chat'
}

export type Template = 'airline' | 'bank' | 'telecom' | 'insurance' | 'warm' | 'calm';

export type TranscriptEntry = {
  speaker: 'User' | 'Agent' | 'System' | 'IVR';
  text: string;
};

export enum CallState {
  Idle = 'Idle',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Ended = 'Ended',
}

export type Voice = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export interface Greeting {
  text: string;
  lang: string;
  voice: Voice;
}
