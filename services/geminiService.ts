
import { GoogleGenAI, Type } from "@google/genai";
import { SongResponse } from "../types";

// Singleton pattern: reuse GoogleGenAI instance
let aiInstance: GoogleGenAI | null = null;

const getAIInstance = (): GoogleGenAI => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
            description: "Array of note names to play simultaneously (e.g., ['C4', 'E4', 'G4'] for a C major chord)." 
          },
          duration: { type: Type.NUMBER, description: "Duration in seconds until the next event" },
          velocity: { type: Type.NUMBER, description: "The volume/intensity of the notes from 0.0 (silent) to 1.0 (very loud). Use this for musical expression." },
        },
        required: ["keys", "duration", "velocity"],
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
    1. Structure: Ensure a clear distinction between a prominent melody (typically right hand, C4-C6) and a supporting accompaniment (typically left hand, C2-C4). 
    2. Melody: Create a singable, evolving melody line. Use motifs and vary them. Avoid repetitive single notes; use phrasing.
    3. Accompaniment: Use arpeggios, broken chords, or sophisticated rhythmic patterns rather than just block chords.
    4. Rhythm & Flow: Use a mix of note durations (e.g., 0.125s, 0.25s, 0.5s, 1s) to create momentum and "breathing" space. Incorporate syncopation where appropriate.
    5. Length: The piece must be substantial, containing between 60 to 120 musical events to ensure a full musical thought (intro, development, and resolution).
    6. Dynamics: Use the "velocity" field (0.0 to 1.0) to create crescendos, decrescendos, and to emphasize melodic notes over accompaniment.
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
