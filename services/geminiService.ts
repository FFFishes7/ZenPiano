
import { GoogleGenAI, Type } from "@google/genai";
import { SongResponse } from "../types";

const STORAGE_KEY = 'gemini_api_key';

// Singleton pattern: reuse GoogleGenAI instance
let aiInstance: GoogleGenAI | null = null;

export const setStoredApiKey = (key: string) => {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  // Reset instance to force re-initialization with new key
  aiInstance = null;
};

export const getStoredApiKey = (): string => {
  return localStorage.getItem(STORAGE_KEY) || '';
};

const getAIInstance = (): GoogleGenAI => {
  if (!aiInstance) {
    const apiKey = getStoredApiKey() || process.env.API_KEY;
    if (!apiKey) {
      throw new Error("Missing API Key. Please set your Gemini API Key in the settings.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

// Following @google/genai guidelines: Use Type instead of SchemaType and use object literal for schema
const songSchema = {
  type: Type.OBJECT,
  properties: {
    songName: { type: Type.STRING, description: "Name of the song" },
    tempo: { type: Type.NUMBER, description: "Tempo in BPM (usually 60-120)" },
    description: { type: Type.STRING, description: "Short description of the musical piece" },
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          keys: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Array of note names to play simultaneously (e.g., ['C4', 'E4', 'G4'])." 
          },
          duration: { type: Type.NUMBER, description: "The actual sustain time of these notes in seconds. If duration > timeDelta, notes will overlap with the next event (creating legato/polyphony)." },
          timeDelta: { type: Type.NUMBER, description: "Time in seconds to wait before the NEXT event starts. Set this smaller than 'duration' to create overlapping notes." },
          velocity: { type: Type.NUMBER, description: "Volume (0.0-1.0)." },
        },
        required: ["keys", "duration", "velocity", "timeDelta"],
      },
    },
  },
  required: ["songName", "tempo", "events", "description"],
};

export const generateSong = async (topic: string): Promise<SongResponse> => {
  // Reuse GoogleGenAI instance
  const ai = getAIInstance();
  
  // Use gemini-3-flash-preview as requested by user
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Compose a complete, professionally structured, and emotionally resonant piano piece based on the theme: "${topic}".
    
    Musical Guidelines:
    1. **Tempo & Mood**: Choose a BPM that perfectly fits the emotional theme (e.g., 60-80 for melancholic, 110-140 for energetic).
    2. **Structure**: Create a clear musical narrative (Intro -> Theme -> Development -> Climax -> Outro).
    3. **Polyphony & Texture**: 
       - Use the 'timeDelta' and 'duration' fields to create rich textures.
       - **Legato/Sustain**: Make 'duration' > 'timeDelta' to let notes ring out while new ones begin. This is CRITICAL for a real piano sound.
       - **Counterpoint**: Have a long bass note (e.g., duration 2.0s) while the right hand plays faster melody notes (timeDelta 0.25s) over it.
    4. **Melody**: Create a singable, evolving melody line. Use motifs and vary them.
    5. Accompaniment: Use arpeggios, broken chords, or sophisticated rhythmic patterns.
    6. **Length & Planning**: Target duration is **60-90 seconds**. Plan your event count based on your chosen BPM:
       - **Slow (60-80 BPM)**: Generate ~60-80 events.
       - **Medium (90-110 BPM)**: Generate ~100-140 events.
       - **Fast (120+ BPM)**: Generate ~160-220 events.
       Ensure the piece has a logical conclusion within these limits.
    7. **Playability (CRITICAL)**:
       - This is for a SINGLE human pianist (2 hands, 10 fingers).
       - **Max Simultaneous Keys**: Do not press more than 4-5 keys per hand at once.
       - **Hand Span**: Ensure intervals within one hand fit within a 10th (approx. 1.3 octaves).
       - **No Impossible Overlaps**: Do not trigger a note that is already being held by the same hand unless re-striking it.
    8. Dynamics: Use 'velocity' to create phrasing (crescendos/decrescendos).
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: songSchema,
        systemInstruction: "You are a world-class piano composer and concert pianist. Your music is known for its beautiful melodies, complex textures, and deep emotional impact. Generate expressive MIDI-like JSON data.",
      },
    });

    if (!response.text) {
      throw new Error("AI returned an empty response. Please try a different prompt.");
    }

    let cleanText = response.text.trim();
    
    // Robust Cleaning: Remove Markdown code blocks if present
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '');

    // Locate the JSON object bounds
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error("Invalid music data format received.");
    }
    
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);

    try {
      return JSON.parse(cleanText) as SongResponse;
    } catch (e) {
      console.error("JSON Parse Error:", cleanText);
      throw new Error("Failed to parse the composed music data.");
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    
    // Provide more specific error messages if possible
    const errorMessage = error.message || "";
    if (errorMessage.includes("API key")) {
      throw new Error("Invalid API key configuration.");
    } else if (errorMessage.includes("model not found")) {
      throw new Error("AI model configuration error.");
    } else if (errorMessage.includes("quota") || errorMessage.includes("429")) {
      throw new Error("Rate limit exceeded. Please wait a moment.");
    }
    
    throw new Error(error.message || "Failed to compose song. Please try again.");
  }
};
