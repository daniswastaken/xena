/**
 * Voice input: renderer captures mic PCM -> WAV base64 -> gateway STT chain
 * (Gemini inline audio primary, 9Router gpt-audio secondary).
 */
export { transcribeAudio } from "@xena/inference-gateway";
