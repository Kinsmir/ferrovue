export type Mood = "calm" | "loud" | "<q>&\"x'";

export type MoodChoice = Mood | "";

export const NEXT_MOOD: Record<Mood, Mood> = { calm: "loud", loud: "<q>&\"x'", "<q>&\"x'": "calm" };

export const MOOD_PREVIEW: Record<MoodChoice, Mood> = { "": "<q>&\"x'", calm: "calm", loud: "loud", "<q>&\"x'": "<q>&\"x'" };

export const MOOD_LABEL: Record<MoodChoice, string> = { "": "<none> & \"all\"", calm: "Calm", loud: "Loud", "<q>&\"x'": "Odd 'one'" };

export const PLAIN_MOOD = { calm: "<q>&\"x'", loud: "calm", "<q>&\"x'": "loud" } as const;

export const SOME_MOOD: Partial<Record<Mood, Mood>> = { calm: "loud" };
