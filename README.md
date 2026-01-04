<div align="center">

# 🎹 ZenPiano

**An elegant AI-powered virtual piano application**

🌐 **[Live Demo](https://fffishes7.github.io/ZenPiano/)**

> 🎹 **AI Feature:** You can now set your own Gemini API Key directly in the web interface by clicking the settings (⚙️) icon next to the "AI Composer" title.

[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite)](https://vitejs.dev/)
[![Tone.js](https://img.shields.io/badge/Tone.js-14.x-F734D3)](https://tonejs.github.io/)

</div>

## ✨ Features

- 🎵 **AI Composition** - Generate piano pieces automatically from text descriptions using Google Gemini AI
- 🎹 **Virtual Piano** - Full-size piano keyboard with mouse click and keyboard input support
- 📁 **MIDI Import** - Drag and drop or upload MIDI files for playback
- 🌊 **Waterfall View** - Visualize notes falling animation, similar to rhythm games
- 🎚️ **Playback Controls** - Complete controls for play, pause, and stop
- 📱 **Responsive Design** - Works on desktop and mobile devices

## 🚀 Quick Start

### Requirements

- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/FFFishes7/ZenPiano.git
   cd ZenPiano
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key**
   
   There are two ways to provide an API key for the AI Composition feature:

   **Method 1: Direct UI Input (Recommended)**
   Click the settings (⚙️) icon next to the "AI Composer" title in the application and paste your API key. It will be stored locally in your browser.

   **Method 2: Environment Variable**
   Set your Gemini API Key in the `.env.local` file:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser at** `http://localhost:5173`

## 🎮 Usage

### Keyboard Playing
Play the piano directly using your computer keyboard, with key mappings covering the central octave range.

### AI Composition
Describe the music style you want in the input box, for example:
- "A gentle lullaby"
- "An upbeat jazz melody"
- "A melancholic classical piano piece"

### MIDI Playback
Drag and drop `.mid` or `.midi` files onto the application window to automatically load and play.

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI Framework |
| TypeScript | Type Safety |
| Vite | Build Tool |
| Tone.js | Audio Synthesis Engine |
| @tonejs/midi | MIDI File Parsing |
| @google/genai | Gemini AI API |
| Tailwind CSS | Styling Framework |

## 📄 License

MIT License

---

<div align="center">

Made with ❤️ and 🎵

Built with [Google AI Studio](https://aistudio.google.com/) & [Claude](https://claude.ai/)

</div>